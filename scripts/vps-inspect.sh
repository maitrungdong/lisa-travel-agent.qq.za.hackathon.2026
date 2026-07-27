#!/usr/bin/env bash
# Recon VPS: in ra mọi thứ cần biết về máy BTC cấp + verdict "đủ chạy Lisa chưa".
# CHỈ ĐỌC — không cài, không sửa, không mở port. An toàn chạy nhiều lần.
#
# Dùng:  scp scripts/vps-inspect.sh user@VPS:/tmp/ && ssh user@VPS 'bash /tmp/vps-inspect.sh'
# Hoặc:  ssh user@VPS 'bash -s' < scripts/vps-inspect.sh | tee vps-report.txt

set -u   # cố tình KHÔNG dùng pipefail: script chỉ báo cáo, `cmd | head -1` gây SIGPIPE là bình thường
export LC_ALL=C

have() { command -v "$1" >/dev/null 2>&1; }
h()    { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
kv()   { printf '  %-26s %s\n' "$1" "${2:-?}"; }
ok()   { printf '  \033[0;32m[OK]\033[0m   %s\n' "$*"; }
warn() { printf '  \033[0;33m[WARN]\033[0m %s\n' "$*"; WARNS=$((WARNS+1)); }
bad()  { printf '  \033[0;31m[FAIL]\033[0m %s\n' "$*"; FAILS=$((FAILS+1)); }
WARNS=0; FAILS=0

# sudo không cần password?
SUDO=""
if [ "$(id -u)" = 0 ]; then SUDO=""
elif sudo -n true 2>/dev/null; then SUDO="sudo -n"
else SUDO="SKIP"; fi

h "1. Danh tính & quyền"
kv "hostname"    "$(hostname -f 2>/dev/null || hostname)"
kv "user"        "$(id -un) (uid=$(id -u))"
kv "groups"      "$(id -Gn)"
kv "uptime"      "$(uptime -p 2>/dev/null || uptime)"
kv "shell"       "$SHELL"
if [ "$SUDO" = "SKIP" ]; then
  warn "Không có sudo passwordless — vài mục dưới sẽ thiếu. Xin BTC quyền sudo (bootstrap cần root)."
else
  ok "Có quyền root/sudo"
fi

h "2. OS & nền tảng ảo hóa"
. /etc/os-release 2>/dev/null || true
kv "OS"          "${PRETTY_NAME:-unknown}"
kv "kernel"      "$(uname -r)"
kv "arch"        "$(uname -m)"
VIRT="$(systemd-detect-virt 2>/dev/null | head -1)"; VIRT="${VIRT:-unknown}"  # exit code 1 khi 'none' → không dùng ||
kv "virtualization" "$VIRT"
kv "cgroup"      "$( [ -f /sys/fs/cgroup/cgroup.controllers ] && echo v2 || echo v1 )"
kv "init"        "$(ps -p 1 -o comm= 2>/dev/null)"
PKG="?"; for m in apt-get dnf yum zypper apk pacman; do have "$m" && { PKG="$m"; break; }; done
kv "package manager" "$PKG"
SEL="$(getenforce 2>/dev/null || echo 'không có SELinux')"
kv "SELinux"     "$SEL"
[ "$SEL" = Enforcing ] && warn "SELinux Enforcing → bind mount Docker cần cờ ':z' (infra/docker-compose.yml đã có)"
case "${ID:-}${VERSION_ID:-}" in
  ubuntu22*|ubuntu24*|debian12*|debian13*) ok "Distro Docker hỗ trợ trực tiếp (get.docker.com)" ;;
  rocky9*|almalinux9*|rhel9*|centos9*) ok "RHEL-family 9 — bootstrap dùng repo docker-ce của CentOS + firewalld" ;;
  *) warn "Distro lạ (${PRETTY_NAME:-?}) — kiểm tra Docker có repo cho bản này" ;;
esac
case "$VIRT" in
  openvz|lxc|lxc-libvirt) warn "Container-based VPS ($VIRT) — Docker/overlayfs/nested cgroup hay lỗi. Hỏi BTC xem có bản KVM." ;;
  kvm|vmware|microsoft|xen|amazon|qemu|none) ok "Nền tảng $VIRT chạy Docker bình thường" ;;
esac
[ "$(uname -m)" = x86_64 ] || warn "Arch $(uname -m) — image multi-arch mới chạy được; build CI phải khớp arch"

h "3. CPU / RAM / Swap / Disk"
kv "vCPU"        "$(nproc)"
kv "CPU model"   "$(awk -F: '/model name/{print $2; exit}' /proc/cpuinfo | sed 's/^ *//')"
MEM_MB=$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo)
SWAP_MB=$(awk '/SwapTotal/{printf "%d", $2/1024}' /proc/meminfo)
kv "RAM total"   "${MEM_MB} MB"
kv "RAM avail"   "$(awk '/MemAvailable/{printf "%d MB", $2/1024}' /proc/meminfo)"
kv "Swap"        "${SWAP_MB} MB"
DISK_AVAIL_GB=$(df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9')
kv "Disk / avail" "${DISK_AVAIL_GB:-?} GB / total $(df -BG --output=size / 2>/dev/null | tail -1 | tr -d ' ')"
df -h / /var 2>/dev/null | sed 's/^/    /'
[ "${MEM_MB:-0}" -ge 1900 ] && ok "RAM ≥ 2GB" || warn "RAM chỉ ${MEM_MB}MB — postgres+api+openclaw+caddy sẽ chật, cần swap"
[ "${SWAP_MB:-0}" -ge 512 ] && ok "Có swap ${SWAP_MB}MB" || warn "Không có swap — nên tạo 2GB swapfile trước khi build/pull image"
[ "${DISK_AVAIL_GB:-0}" -ge 15 ] && ok "Disk trống ${DISK_AVAIL_GB}GB" || warn "Disk trống ${DISK_AVAIL_GB:-?}GB — 4 image + pgdata cần ~10-15GB"
[ "$(nproc)" -ge 2 ] && ok "$(nproc) vCPU" || warn "1 vCPU — build trên VPS sẽ rất chậm (may là CI build image, VPS chỉ pull)"

h "4. Mạng & IP"
kv "IP nội bộ"   "$(hostname -I 2>/dev/null | tr -s ' ')"
ip -brief addr 2>/dev/null | sed 's/^/    /'
kv "default route" "$(ip route show default 2>/dev/null | head -1)"
PUBIP=""
for u in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
  PUBIP="$(curl -4 -fsS --max-time 6 "$u" 2>/dev/null | tr -d '\r\n')" && [ -n "$PUBIP" ] && break
done
kv "IP public (v4)" "${PUBIP:-KHÔNG lấy được}"
kv "IPv6"        "$(curl -6 -fsS --max-time 5 https://api64.ipify.org 2>/dev/null || echo 'không có / không route')"
if hostname -I 2>/dev/null | grep -qw "${PUBIP:-__none__}"; then
  ok "IP public gán trực tiếp lên NIC (không NAT)"
elif [ -n "$PUBIP" ]; then
  warn "IP public $PUBIP khác IP trên NIC → VPS sau NAT/floating IP. Port forward phải cấu hình ở panel BTC."
fi
kv "DNS resolver" "$(awk '/^nameserver/{printf "%s ", $2}' /etc/resolv.conf 2>/dev/null)"
kv "MTU eth"     "$(ip -o link show 2>/dev/null | awk '/state UP/{print $2, $5}' | tr '\n' ' ')"

h "5. Port đang lắng nghe (ai chiếm 80/443?)"
if have ss; then
  # shellcheck disable=SC2086
  ${SUDO/SKIP/} ss -tulpn 2>/dev/null | sed 's/^/    /'
else
  netstat -tulpn 2>/dev/null | sed 's/^/    /'
fi
listening() { ss -tuln 2>/dev/null | awk '{print $5}' | grep -qE "(^|:|\.)$1\$"; }
for p in 80 443 5432 18789 3000; do
  if listening "$p"; then warn "Port $p ĐANG bị chiếm — xem process ở trên, phải stop/disable trước khi compose up"
  else ok "Port $p trống"; fi
done
for svc in apache2 nginx httpd caddy postgresql mysql mysqld; do
  if have systemctl && systemctl is-enabled "$svc" >/dev/null 2>&1; then
    warn "Service '$svc' đã enabled sẵn (BTC cài image có sẵn?) → xung đột port/tài nguyên"
  fi
done
# nginx/httpd cài sẵn thì phải biết nó đang phục vụ gì trước khi tắt
for web in nginx httpd; do
  if have systemctl && systemctl is-active --quiet "$web" 2>/dev/null; then
    echo "    --- $web đang chạy, config:"
    ${SUDO/SKIP/} nginx -T 2>/dev/null | grep -E '^\s*(server_name|listen|proxy_pass|root|ssl_certificate) ' | sed 's/^/      /' | head -25
    ls /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/* 2>/dev/null | sed 's/^/      file: /'
    ls -d /etc/letsencrypt/live/*/ 2>/dev/null | sed 's/^/      cert LE: /'
  fi
done

h "6. Firewall"
if [ "$SUDO" != "SKIP" ] && have ufw; then
  $SUDO ufw status verbose 2>/dev/null | sed 's/^/    /'
elif have ufw; then kv "ufw" "có cài (cần sudo để xem status)"
else kv "ufw" "chưa cài"; fi
if [ "$SUDO" != "SKIP" ]; then
  RULES=$($SUDO iptables -S 2>/dev/null | wc -l)
  kv "iptables rules" "$RULES dòng"
  $SUDO iptables -S 2>/dev/null | grep -E 'DROP|REJECT|dport (22|80|443)' | head -15 | sed 's/^/    /'
fi
have firewalld && kv "firewalld" "có (Ubuntu thường không dùng)"
echo "    LƯU Ý: nhiều nhà cung cấp còn 1 lớp firewall/security-group ở panel web — script không thấy được."

h "7. Software có sẵn"
for c in docker git curl wget rsync node npm python3 nginx caddy ufw fail2ban unattended-upgrade jq nano; do
  if have "$c"; then kv "$c" "$($c --version 2>/dev/null | head -1 || echo present)"; else kv "$c" "-"; fi
done
if have docker; then
  kv "docker compose" "$(docker compose version 2>/dev/null | head -1 || echo 'KHÔNG có plugin v2')"
  if docker info >/dev/null 2>&1; then
    ok "docker daemon chạy được với user hiện tại"
    kv "storage driver" "$(docker info --format '{{.Driver}}' 2>/dev/null)"
    kv "containers"     "$(docker ps -q 2>/dev/null | wc -l) đang chạy"
    docker ps --format '    {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null
  else
    warn "docker có nhưng user chưa vào group docker / daemon chưa chạy (thử: sudo docker info)"
  fi
else
  kv "docker" "chưa cài → vps-bootstrap.sh sẽ cài"
fi

h "8. Egress — VPS có ra internet được các host mình cần?"
egress() { # host port label
  if timeout 6 bash -c ">/dev/tcp/$1/$2" 2>/dev/null; then ok "$3 ($1:$2)"; else bad "$3 ($1:$2) KHÔNG kết nối được"; fi
}
egress ghcr.io 443                 "GHCR (pull image API)"
egress registry-1.docker.io 443    "Docker Hub (postgres, caddy, openclaw base)"
egress get.docker.com 443          "Script cài Docker"
egress api.anthropic.com 443       "Claude API"
egress bot.zaloplatforms.com 443   "Zalo Bot Platform"
egress github.com 443              "GitHub"
egress acme-v02.api.letsencrypt.org 443 "Let's Encrypt (Caddy xin cert)"
egress archive.ubuntu.com 80       "APT repo"
kv "DNS lookup test" "$(getent hosts ghcr.io >/dev/null 2>&1 && echo OK || echo 'FAIL — DNS lỗi')"
kv "Latency api.anthropic.com" "$(ping -c2 -W2 api.anthropic.com 2>/dev/null | awk -F/ '/rtt|round-trip/{print $5" ms"}' || echo 'ping bị chặn')"

h "9. Thời gian & locale"
have timedatectl && timedatectl 2>/dev/null | sed 's/^/    /' || kv "date" "$(date)"
echo "    (Postgres + JWT + Let's Encrypt cần đồng hồ đúng → NTP phải 'active')"

h "10. SSH & bảo mật"
if [ "$SUDO" != "SKIP" ]; then
  $SUDO sshd -T 2>/dev/null | grep -E '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|maxauthtries)' | sed 's/^/    /'
fi
kv "authorized_keys" "$( [ -f "$HOME/.ssh/authorized_keys" ] && wc -l < "$HOME/.ssh/authorized_keys" || echo 0 ) key"
kv "sudo users"  "$(getent group sudo 2>/dev/null | cut -d: -f4)"
kv "login gần đây" "$(last -n 3 2>/dev/null | head -3 | tr '\n' '|')"

h "11. Ước lượng tài nguyên stack Lisa"
cat <<'EST'
    postgres:16-alpine   ~150 MB RAM   ~250 MB disk
    api (NestJS)         ~200 MB RAM   ~300 MB disk
    openclaw + Claude    ~400-800 MB   ~1.5 GB disk
    caddy:2-alpine       ~30 MB RAM    ~50 MB disk
    ---------------------------------------------------
    Tổng thực tế         ~1.0-1.3 GB RAM, ~8-12 GB disk (kèm layer + pgdata + log)
EST

h "KẾT LUẬN"
printf '  FAIL: %s   WARN: %s\n' "$FAILS" "$WARNS"
if [ "$FAILS" -gt 0 ]; then
  echo "  → Có mục FAIL (thường là egress bị chặn). Không bootstrap được cho tới khi xử lý — hỏi BTC."
elif [ "$WARNS" -gt 0 ]; then
  echo "  → Chạy được nhưng xem lại các WARN (RAM/swap/disk/port bị chiếm) trước khi deploy."
else
  echo "  → VPS sạch và đủ điều kiện. Bước tiếp: bash scripts/vps-bootstrap.sh"
fi
echo
echo "  Chưa test được từ bên trong (làm từ MÁY DEV — xem docs/setup/06-verify-vps.md §4):"
echo "   • Inbound 80/443 từ internet có tới VPS không"
echo "   • DNS A record api.<domain> đã trỏ về ${PUBIP:-<IP VPS>} chưa"
