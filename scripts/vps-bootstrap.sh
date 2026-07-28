#!/usr/bin/env bash
# =============================================================================
#  vps-bootstrap.sh — chuẩn bị VPS (Rocky Linux 9) để chạy Lisa Travel Agent.
#
#  CHẠY TRÊN VPS, không phải máy dev:
#      ssh -p 2222 zah19-team35@118.102.2.135
#      git clone <repo> ~/lisa && cd ~/lisa
#      bash scripts/vps-bootstrap.sh
#
#  Idempotent — chạy lại bao nhiêu lần cũng được, không hỏng gì.
#
#  Script làm 6 việc:
#    1. Đổi timezone → Asia/Ho_Chi_Minh   (VPS đang là America/New_York!)
#    2. Cài Docker CE + compose v2 (repo CentOS 9 của Docker), enable + start
#    3. Cài rsync (deploy.sh cần rsync ở CẢ HAI đầu)
#    4. Tạo /opt/lisa/{media,recap,certs} đúng owner cho container node (uid 1000)
#    5. Cài /etc/nginx/conf.d/lisa.conf rồi RELOAD nginx — chỉ khi `nginx -t` PASS
#    6. Mở 80/443 trên firewalld (nếu firewalld đang chạy)
#
#  ⛔ NGUYÊN TẮC AN TOÀN — nginx là của BTC, đang phục vụ các team khác:
#     KHÔNG stop, KHÔNG restart, KHÔNG sửa/xoá star.123c.vn.conf.
#     Chỉ THÊM 1 file conf + reload nóng. Nếu `nginx -t` fail, script tự khôi
#     phục nguyên trạng rồi DỪNG — không bao giờ reload một config sai.
#
#  Biến môi trường tuỳ chọn:
#     LISA_NGINX_CONF=/duong/dan/lisa.conf   chỉ định file conf nguồn
#     LISA_SKIP_NGINX=1                      bỏ qua hẳn bước nginx
#     LISA_TZ=Asia/Ho_Chi_Minh               đổi timezone đích
# =============================================================================
set -euo pipefail

# ---- Hằng số ---------------------------------------------------------------
DEPLOY_DIR=/opt/lisa
TARGET_TZ="${LISA_TZ:-Asia/Ho_Chi_Minh}"
NGINX_DEST=/etc/nginx/conf.d/lisa.conf
NGINX_BTC_CONF=/etc/nginx/conf.d/star.123c.vn.conf
CERT_PEM=/etc/nginx/certs/123c.vn.pem
CERT_KEY_GUESS=/etc/nginx/certs/123c.vn.key
BACKUP_DIR="$DEPLOY_DIR/backup/nginx"
TS="$(date +%Y%m%d-%H%M%S)"

# ---- Màu -------------------------------------------------------------------
if [ -t 1 ]; then
  C_RED=$'\033[0;31m'; C_GRN=$'\033[0;32m'; C_YEL=$'\033[0;33m'
  C_CYN=$'\033[1;36m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YEL=""; C_CYN=""; C_DIM=""; C_OFF=""
fi
step() { printf '\n%s==> %s%s\n' "$C_CYN" "$*" "$C_OFF"; }
ok()   { printf '   %s[OK]%s   %s\n'   "$C_GRN" "$C_OFF" "$*"; }
warn() { printf '   %s[WARN]%s %s\n'   "$C_YEL" "$C_OFF" "$*"; }
info() { printf '   %s%s%s\n'          "$C_DIM" "$*" "$C_OFF"; }
die()  { printf '\n%s[FAIL]%s %s\n\n'  "$C_RED" "$C_OFF" "$*" >&2; exit 1; }

# ---- sudo ------------------------------------------------------------------
SUDO=""
if [ "$(id -u)" != 0 ]; then
  command -v sudo >/dev/null || die "Không phải root và không có sudo."
  SUDO="sudo"
fi

# User sở hữu /opt/lisa. Container api chạy user `node` = uid 1000; user
# zah19-team35 trên VPS cũng uid 1000 → trùng nhau nên cả 2 phía cùng ghi được.
TARGET_USER="${SUDO_USER:-$(id -un)}"
APP_UID="$(id -u "$TARGET_USER" 2>/dev/null || echo 1000)"
APP_GID="$(id -g "$TARGET_USER" 2>/dev/null || echo 1000)"

# ---- Kiểm tra distro -------------------------------------------------------
. /etc/os-release
case "${ID:-}:${ID_LIKE:-}" in
  rocky:*|almalinux:*|centos:*|rhel:*|*rhel*|*fedora*) : ;;
  *) die "Script này viết cho RHEL-family (VPS là Rocky Linux 9.4). Phát hiện: ${PRETTY_NAME:-?}" ;;
esac

printf '%s' "$C_CYN"
cat <<'BANNER'
  _     _             ____              _       _
 | |   (_)___  __ _  | __ )  ___   ___ | |_ ___| |_ _ __ __ _ _ __
 | |   | / __|/ _` | |  _ \ / _ \ / _ \| __/ __| __| '__/ _` | '_ \
 | |___| \__ \ (_| | | |_) | (_) | (_) | |_\__ \ |_| | | (_| | |_) |
 |_____|_|___/\__,_| |____/ \___/ \___/ \__|___/\__|_|  \__,_| .__/
                                                             |_|
BANNER
printf '%s' "$C_OFF"
info "host: $(hostname) · os: ${PRETTY_NAME:-?} · user: $TARGET_USER (uid $APP_UID)"

# =============================================================================
# 1. TIMEZONE
# =============================================================================
step "1/6 · Timezone → $TARGET_TZ"
CUR_TZ="$(timedatectl show -p Timezone --value 2>/dev/null || echo unknown)"
if [ "$CUR_TZ" = "$TARGET_TZ" ]; then
  ok "đã đúng ($CUR_TZ)"
else
  info "hiện tại: $CUR_TZ → đang đổi..."
  $SUDO timedatectl set-timezone "$TARGET_TZ"
  NEW_TZ="$(timedatectl show -p Timezone --value)"
  [ "$NEW_TZ" = "$TARGET_TZ" ] || die "Đổi timezone thất bại (vẫn là $NEW_TZ)."
  ok "$CUR_TZ → $NEW_TZ"
fi
$SUDO timedatectl set-ntp true >/dev/null 2>&1 || true
info "$(timedatectl | sed -n '1,3p' | tr '\n' '|' | sed 's/|/ | /g')"
if [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = "yes" ]; then
  ok "đồng hồ đã đồng bộ NTP"
else
  warn "NTP chưa đồng bộ — token/JWT/TLS có thể lỗi. Kiểm tra: systemctl status chronyd"
fi

# =============================================================================
# 2. DOCKER CE + COMPOSE V2
# =============================================================================
step "2/6 · Docker CE + compose plugin"
if command -v docker >/dev/null 2>&1; then
  ok "docker đã cài: $(docker --version)"
else
  info "cài dnf-plugins-core + thêm repo docker-ce của CentOS 9..."
  $SUDO dnf -y install dnf-plugins-core >/dev/null
  if [ -f /etc/yum.repos.d/docker-ce.repo ]; then
    ok "repo docker-ce đã có sẵn"
  else
    # dnf4 (Rocky 9) dùng `--add-repo`. Nếu vì lý do gì đó fail thì tải thẳng file repo.
    $SUDO dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo \
      || $SUDO curl -fsSL https://download.docker.com/linux/centos/docker-ce.repo \
              -o /etc/yum.repos.d/docker-ce.repo
    ok "đã thêm repo docker-ce"
  fi
  info "dnf install docker-ce... (vài phút)"
  $SUDO dnf -y install docker-ce docker-ce-cli containerd.io \
                       docker-buildx-plugin docker-compose-plugin
  ok "đã cài: $(docker --version)"
fi

# Trên RHEL-family docker KHÔNG tự chạy sau khi cài
$SUDO systemctl enable --now docker >/dev/null 2>&1 || die "Không start được dịch vụ docker."
$SUDO systemctl is-active --quiet docker || die "docker.service không ở trạng thái active."
ok "docker.service: active + enabled"

$SUDO docker compose version >/dev/null 2>&1 \
  || die "Thiếu compose plugin v2. Chạy: sudo dnf -y install docker-compose-plugin"
ok "$($SUDO docker compose version)"

# Cho user chạy docker không cần sudo (cần logout/login mới có hiệu lực)
if [ "$TARGET_USER" != root ]; then
  $SUDO groupadd -f docker
  if id -nG "$TARGET_USER" | tr ' ' '\n' | grep -qx docker; then
    ok "$TARGET_USER đã ở trong group docker"
  else
    $SUDO usermod -aG docker "$TARGET_USER"
    warn "đã thêm $TARGET_USER vào group docker — LOGOUT/LOGIN lại mới dùng được docker không cần sudo"
  fi
fi

# =============================================================================
# 3. GÓI PHỤ TRỢ (rsync bắt buộc cho deploy.sh)
# =============================================================================
step "3/6 · Gói phụ trợ: rsync, tar, git, curl"
MISSING=()
for p in rsync tar git curl; do command -v "$p" >/dev/null 2>&1 || MISSING+=("$p"); done
if [ "${#MISSING[@]}" -eq 0 ]; then
  ok "đã có đủ"
else
  info "cài: ${MISSING[*]}"
  $SUDO dnf -y install "${MISSING[@]}" >/dev/null
  ok "đã cài ${MISSING[*]}"
fi
command -v rsync >/dev/null || die "rsync vẫn chưa có — deploy.sh sẽ không chạy được."

# =============================================================================
# 4. THƯ MỤC /opt/lisa
# =============================================================================
step "4/6 · Thư mục $DEPLOY_DIR"
[ "$APP_UID" = 1000 ] || warn "uid của $TARGET_USER là $APP_UID (≠1000). Container api chạy uid 1000 → nếu ghi file lỗi quyền, chown lại: sudo chown -R 1000:1000 $DEPLOY_DIR/media $DEPLOY_DIR/recap"

# 755 cho media/recap: nginx (chạy user `nginx`) phải đọc được để serve /media/ và /trip/
$SUDO install -d -o "$APP_UID" -g "$APP_GID" -m 755 "$DEPLOY_DIR"
$SUDO install -d -o "$APP_UID" -g "$APP_GID" -m 755 "$DEPLOY_DIR/media"
$SUDO install -d -o "$APP_UID" -g "$APP_GID" -m 755 "$DEPLOY_DIR/recap"
# certs/ chỉ để chứa key riêng nếu về sau cần — không cho người khác đọc
$SUDO install -d -o "$APP_UID" -g "$APP_GID" -m 750 "$DEPLOY_DIR/certs"
$SUDO install -d -o "$APP_UID" -g "$APP_GID" -m 755 "$BACKUP_DIR"
ok "$DEPLOY_DIR/{media,recap,certs} · owner ${APP_UID}:${APP_GID}"

if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = Enforcing ]; then
  warn "SELinux Enforcing (lúc scan là Permissive)."
  info "  → thêm cờ ':z' cho bind mount trong docker-compose.yml"
  info "  → cho nginx đọc media: sudo chcon -R -t httpd_sys_content_t $DEPLOY_DIR/media $DEPLOY_DIR/recap"
  info "  → cho nginx proxy ra loopback: sudo setsebool -P httpd_can_network_connect on"
else
  ok "SELinux không Enforcing — không cần xử lý thêm"
fi

# =============================================================================
# 5. NGINX — bước rủi ro nhất, làm thật cẩn thận
# =============================================================================
step "5/6 · nginx vhost zah-35.123c.vn"

if [ "${LISA_SKIP_NGINX:-0}" = 1 ]; then
  warn "LISA_SKIP_NGINX=1 → bỏ qua bước nginx"
elif ! command -v nginx >/dev/null 2>&1; then
  warn "Không thấy nginx trên máy này → bỏ qua. (Theo scan thì BTC đã cài sẵn nginx?)"
else
  # --- 5.1 Tìm file conf nguồn ---------------------------------------------
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  SRC=""
  for c in "${LISA_NGINX_CONF:-}" \
           "$SCRIPT_DIR/../infra/nginx/lisa.conf" \
           "$DEPLOY_DIR/nginx/lisa.conf" \
           "$SCRIPT_DIR/lisa.conf"; do
    if [ -n "$c" ] && [ -f "$c" ]; then
      SRC="$c"
      break
    fi
  done

  if [ -z "$SRC" ]; then
    warn "Không tìm thấy infra/nginx/lisa.conf → BỎ QUA bước nginx."
    info "  Cách khắc phục: chạy script từ trong repo đã clone, hoặc:"
    info "    LISA_NGINX_CONF=/duong/dan/lisa.conf bash scripts/vps-bootstrap.sh"
  else
    info "nguồn: $SRC"

    # --- 5.2 Xác định đường dẫn PRIVATE KEY --------------------------------
    # Chỉ chắc chắn có $CERT_PEM. Key có thể: (a) file .key riêng,
    # (b) nằm chung trong file .pem. Ưu tiên đọc chính conf của BTC.
    SSL_KEY=""
    if $SUDO test -r "$NGINX_BTC_CONF"; then
      # awk: lấy tham số của directive ssl_certificate_key đầu tiên, bỏ ; và dấu nháy
      SSL_KEY="$($SUDO awk '$1=="ssl_certificate_key"{gsub(/[";'"'"']/,"",$2); print $2; exit}' \
                 "$NGINX_BTC_CONF" 2>/dev/null || true)"
      if [ -n "$SSL_KEY" ]; then
        info "key lấy từ conf BTC: $SSL_KEY"
      fi
    fi
    if [ -z "$SSL_KEY" ] && $SUDO test -f "$CERT_KEY_GUESS"; then
      SSL_KEY="$CERT_KEY_GUESS"
      info "key: tìm thấy file rời $SSL_KEY"
    fi
    if [ -z "$SSL_KEY" ]; then
      SSL_KEY="$CERT_PEM"
      info "key: không có file .key rời → coi $CERT_PEM là file combined (cert+key)"
    fi
    $SUDO test -f "$CERT_PEM"  || warn "KHÔNG thấy $CERT_PEM — nginx -t sẽ fail. Kiểm tra: sudo ls -l /etc/nginx/certs/"
    $SUDO test -f "$SSL_KEY"   || warn "KHÔNG thấy key $SSL_KEY — nginx -t sẽ fail."

    # --- 5.3 Dựng file conf sẽ cài -----------------------------------------
    STAGE="$(mktemp)"
    trap 'rm -f "$STAGE"' EXIT
    sed -E "s|^([[:space:]]*)ssl_certificate_key[[:space:]]+[^;]+;|\1ssl_certificate_key ${SSL_KEY};|" \
        "$SRC" > "$STAGE"
    grep -q "ssl_certificate_key ${SSL_KEY};" "$STAGE" \
      || die "Không patch được dòng ssl_certificate_key trong $SRC (file có bị sửa cấu trúc không?)."

    # --- 5.4 Không đổi gì thì không reload ---------------------------------
    if $SUDO test -f "$NGINX_DEST" && $SUDO cmp -s "$STAGE" "$NGINX_DEST"; then
      ok "$NGINX_DEST đã đúng nội dung — không cần reload"
    else
      # Backup bản cũ (đuôi không phải .conf nên nginx không nạp nhầm)
      RESTORE=""
      if $SUDO test -f "$NGINX_DEST"; then
        RESTORE="$BACKUP_DIR/lisa.conf.$TS.bak"
        $SUDO cp -p "$NGINX_DEST" "$RESTORE"
        info "đã backup bản cũ: $RESTORE"
      fi

      $SUDO install -o root -g root -m 644 "$STAGE" "$NGINX_DEST"
      info "đã ghi $NGINX_DEST — đang kiểm tra cú pháp..."

      # --- 5.5 nginx -t. FAIL → khôi phục nguyên trạng rồi dừng ------------
      if TEST_OUT="$($SUDO nginx -t 2>&1)"; then
        printf '%s\n' "$TEST_OUT" | sed 's/^/       /'
        ok "nginx -t PASS"
        # RELOAD (nạp nóng), TUYỆT ĐỐI không restart/stop — BTC đang dùng nginx này
        if $SUDO systemctl reload nginx; then
          ok "đã reload nginx (không gián đoạn kết nối đang có)"
        else
          die "reload nginx thất bại. Xem: sudo systemctl status nginx; sudo journalctl -xeu nginx"
        fi
      else
        printf '%s\n' "$TEST_OUT" | sed 's/^/       /' >&2
        # Khôi phục: có backup thì trả lại, không thì xoá file mình vừa thêm
        if [ -n "$RESTORE" ]; then
          $SUDO cp -p "$RESTORE" "$NGINX_DEST"
          info "đã khôi phục $NGINX_DEST từ backup"
        else
          $SUDO rm -f "$NGINX_DEST"
          info "đã xoá $NGINX_DEST vừa thêm"
        fi
        if $SUDO nginx -t >/dev/null 2>&1; then
          info "config nginx đã trở lại trạng thái tốt — BTC KHÔNG bị ảnh hưởng (chưa hề reload)"
        else
          printf '%s\n' "$C_RED   ⚠ nginx -t vẫn FAIL sau khi khôi phục → lỗi có sẵn từ trước, KHÔNG do script.$C_OFF" >&2
        fi
        die "$(cat <<EOF
nginx -t FAIL → đã dừng, KHÔNG reload gì cả.
Xử lý theo thứ tự:
  1. Đọc kỹ output ở trên (dòng "[emerg]" cho biết file + số dòng).
  2. Hay gặp nhất là sai đường dẫn cert/key. Kiểm tra:
       sudo ls -l /etc/nginx/certs/
       sudo grep -n ssl_certificate $NGINX_BTC_CONF
     rồi chạy lại với đường dẫn đúng, ví dụ:
       sudo sed -i 's|ssl_certificate_key .*;|ssl_certificate_key /duong/dan/that.key;|' $SRC
       bash scripts/vps-bootstrap.sh
  3. Muốn bỏ qua nginx để làm tiếp phần docker: LISA_SKIP_NGINX=1 bash scripts/vps-bootstrap.sh
EOF
)"
      fi
    fi
    if $SUDO test -f "$NGINX_BTC_CONF"; then
      ok "conf của BTC ($NGINX_BTC_CONF) còn nguyên, không bị đụng"
    fi
    rm -f "$STAGE"
    trap - EXIT
  fi
fi

# =============================================================================
# 6. FIREWALL
# =============================================================================
step "6/6 · firewalld"
SSH_PORT="$($SUDO sshd -T 2>/dev/null | awk '/^port /{print $2; exit}' || true)"
SSH_PORT="${SSH_PORT:-2222}"
if command -v firewall-cmd >/dev/null 2>&1 && $SUDO systemctl is-active --quiet firewalld; then
  # Mở SSH TRƯỚC để chắc chắn không tự khoá mình ra ngoài
  $SUDO firewall-cmd --permanent --add-port="${SSH_PORT}/tcp" >/dev/null
  $SUDO firewall-cmd --permanent --add-service=http  >/dev/null
  $SUDO firewall-cmd --permanent --add-service=https >/dev/null
  $SUDO firewall-cmd --reload >/dev/null
  ok "firewalld: mở 80, 443, ${SSH_PORT} (reload không rớt kết nối SSH hiện tại)"
  info "$($SUDO firewall-cmd --list-all | tr '\n' ' ' | cut -c1-200)"
else
  ok "firewalld không chạy → không cần mở port ở tầng OS"
  info "Nhớ kiểm tra thêm firewall/security-group ở panel nhà cung cấp (script không thấy được)."
fi

# =============================================================================
# CHECKLIST CUỐI
# =============================================================================
printf '\n%s================ CHECKLIST ================%s\n' "$C_CYN" "$C_OFF"
printf '  %-22s %s\n' "docker"        "$(docker --version 2>/dev/null || echo 'CHƯA CÓ')"
printf '  %-22s %s\n' "docker compose" "$($SUDO docker compose version --short 2>/dev/null || echo 'CHƯA CÓ')"
printf '  %-22s %s\n' "docker.service" "$(systemctl is-active docker 2>/dev/null) / $(systemctl is-enabled docker 2>/dev/null)"
printf '  %-22s %s\n' "rsync"         "$(rsync --version 2>/dev/null | head -1 || echo 'CHƯA CÓ')"
printf '  %-22s %s\n' "timezone"      "$(timedatectl show -p Timezone --value 2>/dev/null)  ($(date '+%Y-%m-%d %H:%M:%S %Z'))"
printf '  %-22s %s\n' "nginx -t"      "$($SUDO nginx -t 2>&1 | tail -1)"
printf '  %-22s %s\n' "nginx conf"    "$($SUDO test -f "$NGINX_DEST" && echo "$NGINX_DEST đã cài" || echo 'CHƯA cài lisa.conf')"
printf '  %-22s %s\n' "$DEPLOY_DIR"   "$(ls -ld "$DEPLOY_DIR" 2>/dev/null | awk '{print $1, $3":"$4}')"
echo "  cổng đang nghe:"
$SUDO ss -tulpn 2>/dev/null | awk 'NR==1 || /:(80|443|3000|5432|'"$SSH_PORT"')\s/' | sed 's/^/    /'

cat <<MSG

${C_GRN}Bootstrap xong.${C_OFF} Việc tiếp theo (xem docs/setup/07-deploy-1-ngay.md):

  1. Tạo secret trên VPS:
       cd $DEPLOY_DIR && cp .env.example .env && vi .env
     (file .env.example sẽ có sau bước rsync ở dưới — hoặc copy tay từ repo)

  2. TỪ MÁY DEV, đẩy infra lên rồi khởi động:
       VPS_HOST=118.102.2.135 VPS_USER=$TARGET_USER VPS_PORT=$SSH_PORT bash scripts/deploy.sh

  3. Trỏ webhook Zalo về:
       https://zah-35.123c.vn/zalo/webhook

${C_DIM}Nếu vừa được thêm vào group docker thì logout/login lại trước khi chạy lệnh docker.${C_OFF}
MSG
