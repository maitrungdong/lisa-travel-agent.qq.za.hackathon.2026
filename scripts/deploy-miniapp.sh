#!/usr/bin/env bash
# =============================================================================
#  deploy-miniapp.sh — build & deploy Zalo Mini App bằng MỘT lệnh.
#
#  Chạy TỪ MÁY DEV (macOS/Linux), không phải VPS:
#      bash scripts/deploy-miniapp.sh
#      bash scripts/deploy-miniapp.sh --testing -m "bản demo chung kết"
#
#  Script lo trọn 7 bước hay quên:
#    1. Lấy PUBLIC_BASE_URL từ VPS (hoặc từ tham số) → VITE_API_BASE_URL
#    2. Kiểm tra API còn sống trước khi tốn công build
#    3. Xoá www/ rồi build sạch  ← quên bước này là deploy nhầm bundle cũ
#    4. Đồng bộ app-config.json theo asset thực tế
#    5. zmp deploy --passive --existing
#    6. In link mở app
#    7. Đẩy URL entry point vừa nhận lên VPS (ZINO_MINIAPP_URL) rồi restart api
#       — link bản testing gắn theo TỪNG PHIÊN BẢN, quên bước này là link Zino
#       gửi vào nhóm vẫn mở bản cũ mà không có lỗi nào báo.
#       Bỏ qua bằng: --no-sync-env
#
#  Vì sao phải build lại mỗi lần đổi URL API: VITE_API_BASE_URL được NHÚNG CỨNG
#  vào bundle lúc build. Sửa .env rồi deploy luôn thì app vẫn gọi URL cũ, và
#  không có lỗi nào báo — chỉ là màn hình trống.
#
#  Biến môi trường (đều có mặc định hợp lý):
#    VPS_HOST   mặc định 118.102.2.135
#    VPS_USER   mặc định zah19-team35
#    VPS_PORT   mặc định 2222
#    API_BASE   ghi đè hẳn, bỏ qua bước hỏi VPS
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
MINIAPP="$ROOT/apps/miniapp"

VPS_HOST="${VPS_HOST:-118.102.2.135}"
VPS_USER="${VPS_USER:-zah19-team35}"
VPS_PORT="${VPS_PORT:-2222}"

DESC="deploy $(date '+%d/%m %H:%M')"
STATUS_FLAG=""
# Mặc định BẬT: link bản testing gắn theo từng phiên bản, deploy xong mà quên
# cập nhật là link Zino gửi vào nhóm vẫn mở bản cũ — im lặng, không lỗi nào báo.
SYNC_ENV=1

while [ $# -gt 0 ]; do
  case "$1" in
    --testing) STATUS_FLAG="--testing"; shift ;;
    --no-sync-env) SYNC_ENV=0; shift ;;
    -m|--desc) DESC="$2"; shift 2 ;;
    --base)    API_BASE="$2"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Tham số lạ: $1" >&2; exit 1 ;;
  esac
done

C_GRN=$'\033[0;32m'; C_YEL=$'\033[0;33m'; C_RED=$'\033[0;31m'; C_CYN=$'\033[1;36m'; C_OFF=$'\033[0m'
step() { printf '\n%s==> %s%s\n' "$C_CYN" "$*" "$C_OFF"; }
ok()   { printf '  %s[OK]%s   %s\n' "$C_GRN" "$C_OFF" "$*"; }
warn() { printf '  %s[WARN]%s %s\n' "$C_YEL" "$C_OFF" "$*"; }
die()  { printf '\n  %s[LỖI]%s %s\n\n' "$C_RED" "$C_OFF" "$*"; exit 1; }

# ---------------------------------------------------------------------------
step "1/7 · Xác định URL API"

if [ -z "${API_BASE:-}" ]; then
  echo "  hỏi VPS $VPS_USER@$VPS_HOST:$VPS_PORT ..."
  API_BASE="$(ssh -p "$VPS_PORT" -o ConnectTimeout=10 "$VPS_USER@$VPS_HOST" \
    "grep '^PUBLIC_BASE_URL=' /opt/zino/.env | tail -1 | cut -d= -f2-" 2>/dev/null || true)"
fi

API_BASE="$(printf '%s' "$API_BASE" | tr -d '[:space:]' | sed 's:/*$::')"
[ -n "$API_BASE" ] || die "Không lấy được PUBLIC_BASE_URL. Truyền tay: --base https://xxx"
ok "API_BASE = $API_BASE"

# ---------------------------------------------------------------------------
step "2/7 · Kiểm tra API còn sống"

# Build mất ~30s — hỏng ở đây thì dừng sớm, đừng để deploy xong mới biết.
if curl -fsS --max-time 12 "$API_BASE/api/health" >/dev/null 2>&1; then
  ok "$API_BASE/api/health phản hồi"
else
  warn "$API_BASE/api/health KHÔNG phản hồi."
  warn "Nếu dùng Cloudflare Tunnel, nhiều khả năng tunnel đã chết và URL đã đổi."
  printf '  Vẫn tiếp tục? [y/N] '
  read -r answer < /dev/tty
  case "$answer" in [yY]*) ;; *) die "Dừng lại. Kiểm tra API trước." ;; esac
fi

# ---------------------------------------------------------------------------
step "3/7 · Ghi VITE_API_BASE_URL"

cd "$MINIAPP"
touch .env
# Giữ nguyên APP_ID / ZMP_TOKEN và các biến khác, chỉ thay đúng dòng cần thay.
grep -v '^VITE_API_BASE_URL=' .env > .env.tmp 2>/dev/null || true
echo "VITE_API_BASE_URL=$API_BASE/api" >> .env.tmp
mv .env.tmp .env
chmod 600 .env
ok "VITE_API_BASE_URL=$API_BASE/api"

grep -q '^APP_ID=' .env    || die "Thiếu APP_ID trong apps/miniapp/.env — chạy 'zmp login' trước."
grep -q '^ZMP_TOKEN=' .env || die "Thiếu ZMP_TOKEN trong apps/miniapp/.env — chạy 'zmp login' trước."
ok "credential zmp đã có"

# ---------------------------------------------------------------------------
step "4/7 · Build sạch"

# rm -rf là CHỦ Ý: build chồng lên bundle cũ dễ để lại file thừa mà
# sync-app-config khai vào listSyncJS → Zalo nạp file rác.
rm -rf www
cd "$ROOT"
pnpm --filter miniapp build
cd "$MINIAPP"
[ -d www ] && [ -n "$(ls -A www 2>/dev/null)" ] || die "Build không sinh ra www/."
ok "$(find www -type f | wc -l | tr -d ' ') file trong www/"

# ---------------------------------------------------------------------------
step "5/7 · Đồng bộ app-config.json"

node "$ROOT/scripts/sync-app-config.mjs"

# Xác minh mọi file khai trong config đều tồn tại thật — sai một tên là màn trắng
node -e '
const {readFileSync, existsSync} = require("fs");
const c = JSON.parse(readFileSync("app-config.json","utf8"));
const missing = [...(c.listSyncJS??[]), ...(c.listCSS??[]), ...(c.listAsyncJS??[])]
  .filter(f => !existsSync("www/" + f));
if (missing.length) { console.error("Khai báo trỏ vào file không tồn tại: " + missing.join(", ")); process.exit(1); }
' || die "app-config.json không khớp với www/"
ok "app-config.json khớp với asset thực tế"

# ---------------------------------------------------------------------------
step "6/7 · Deploy lên Zalo"

command -v zmp >/dev/null 2>&1 || die "Chưa cài zmp-cli. Chạy: npm install -g zmp-cli@4.0.3"

# Ghi lại output để bước 7 rút được URL entry point Zalo vừa cấp. `tee` để
# người dùng vẫn thấy QR và log ngay tại đây, không mất gì.
DEPLOY_LOG="$(mktemp)"
trap 'rm -f "$DEPLOY_LOG"' EXIT

# shellcheck disable=SC2086
zmp deploy --passive --existing --outputDir www --desc "$DESC" $STATUS_FLAG 2>&1 | tee "$DEPLOY_LOG"

APP_ID="$(grep '^APP_ID=' .env | tail -1 | cut -d= -f2-)"
APP_URL="https://zalo.me/s/${APP_ID}/"

printf '\n%s✅ Deploy xong%s\n' "$C_GRN" "$C_OFF"
printf '   API   : %s\n' "$API_BASE"
printf '   Ghi chú: %s\n' "$DESC"

# ---------------------------------------------------------------------------
# KHÔNG tự vẽ QR ở đây nữa.
#
# Bản cũ vẽ QR từ https://zalo.me/s/<APP_ID>/ — đó là entry point của bản ĐÃ
# PHÁT HÀNH. Quét nó khi mới deploy bản development/testing thì Zalo báo
# "Ứng dụng trong giai đoạn phát triển, thử lại sau", và người quét sẽ tưởng
# deploy hỏng.
#
# `zmp deploy` đã in sẵn QR entry point ĐÚNG ở ngay trên (mục "View app at:").
# Vẽ thêm một QR thứ hai chỉ tạo ra hai mã cạnh nhau, một đúng một sai — kiểu
# nhầm lẫn tệ nhất có thể bày ra giữa lúc demo.
# ---------------------------------------------------------------------------
printf '\n%s   Quét QR ở mục "View app at:" phía trên%s — đó là entry point Zalo trả về.\n' "$C_CYN" "$C_OFF"
printf '   (Link %s chỉ dùng được sau khi bản chính thức được phát hành.)\n' "$APP_URL"
printf '\n   Bản testing còn nằm ở mini.zalo.me/developers → Quản lý phiên bản, lấy QR lại được.\n'
printf '   openChat chỉ chạy trong app Zalo thật — test màn Handoff bằng ĐIỆN THOẠI.\n\n'

# ---------------------------------------------------------------------------
step "7/7 · Đồng bộ ZINO_MINIAPP_URL lên VPS"

# VÌ SAO TỰ ĐỘNG: link bản testing GẮN THEO TỪNG PHIÊN BẢN
# (…?env=TESTING&version=29). Deploy bản mới xong mà quên sửa biến trên VPS thì
# link Zino gửi vào nhóm vẫn mở bản CŨ — không lỗi nào báo, không log nào kêu,
# chỉ có người dùng thấy app thiếu tính năng vừa làm. Đúng loại việc thủ công
# mà con người sẽ quên đúng vào hôm quan trọng nhất.

if [ "$SYNC_ENV" -eq 0 ]; then
  warn "Bỏ qua đồng bộ (--no-sync-env). Nhớ tự sửa ZINO_MINIAPP_URL trên VPS."
  exit 0
fi

# Ưu tiên URL Zalo THỰC SỰ in ra. Tự dựng chuỗi là đoán, mà đoán sai ở đây thì
# ra một link trông hợp lý nhưng mở vào bản khác.
MINIAPP_URL="$(sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' "$DEPLOY_LOG" \
  | grep -oE 'https://zalo\.me/s/[^[:space:]"]+' | tail -1 || true)"

# Đường lui: dựng từ APP_ID + số version trong log. Chỉ dùng cho bản testing —
# bản chính thức thì không có tham số version nào cả.
if [ -z "$MINIAPP_URL" ] && [ -n "$STATUS_FLAG" ]; then
  VER="$(sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' "$DEPLOY_LOG" \
    | grep -oiE 'version:?[[:space:]]*[0-9]+' | grep -oE '[0-9]+' | tail -1 || true)"
  [ -n "$VER" ] && MINIAPP_URL="https://zalo.me/s/${APP_ID}/?env=TESTING&version=${VER}"
fi

if [ -z "$MINIAPP_URL" ]; then
  warn "Không rút được URL từ output của zmp."
  warn "Lấy tay ở mục \"View app at:\" phía trên rồi chạy:"
  printf '    ssh -p %s %s@%s\n' "$VPS_PORT" "$VPS_USER" "$VPS_HOST"
  printf '    cd /opt/zino && sed -i "/^ZINO_MINIAPP_URL=/d" .env\n'
  printf '    echo '"'"'ZINO_MINIAPP_URL=<URL>'"'"' >> .env && docker compose up -d api\n\n'
  exit 0
fi

ok "URL entry point: $MINIAPP_URL"

# Đẩy giá trị qua STDIN, KHÔNG nhét vào dòng lệnh ssh.
#
# URL chứa `&` và `?`. Đi qua dòng lệnh là bị shell phía xa diễn giải: `&` cắt
# lệnh làm đôi và phần sau `&` biến mất khỏi biến. Lỗi này ra một URL trông gần
# đúng — mất mỗi `&version=29` — nên rất khó nhận ra bằng mắt.
if printf '%s' "$MINIAPP_URL" | ssh -p "$VPS_PORT" -o ConnectTimeout=10 "$VPS_USER@$VPS_HOST" '
    set -e
    url="$(cat)"
    cd /opt/zino
    cp .env .env.bak.$(date +%s)
    sed -i "/^ZINO_MINIAPP_URL=/d" .env
    printf "ZINO_MINIAPP_URL=%s\n" "$url" >> .env
    docker compose up -d api >/dev/null 2>&1
  ' 2>/dev/null; then
  ok "đã ghi vào /opt/zino/.env và restart api"
else
  warn "Không ghi được lên VPS (mạng? ssh key?). Link Zino gửi sẽ vẫn là bản CŨ."
  warn "Sửa tay theo hướng dẫn ở trên."
  exit 0
fi

# Không tin vào việc "lệnh chạy không lỗi" — hỏi lại chính container xem nó
# nạp được giá trị nào. .env đúng mà container chưa nạp lại là chuyện hay gặp.
ACTUAL="$(ssh -p "$VPS_PORT" -o ConnectTimeout=10 "$VPS_USER@$VPS_HOST" \
  'cd /opt/zino && docker compose exec -T api printenv ZINO_MINIAPP_URL' 2>/dev/null | tr -d '\r' || true)"

if [ "$ACTUAL" = "$MINIAPP_URL" ]; then
  ok "container api đã nạp đúng giá trị"
else
  warn "Container đang thấy: ${ACTUAL:-<rỗng>}"
  warn "Khác với giá trị vừa ghi. Kiểm tay: ssh ... 'cd /opt/zino && grep ZINO_MINIAPP_URL .env'"
fi

printf '\n%s   Link Zino sẽ gửi vào nhóm: %s#/?trip=<id>%s\n\n' "$C_CYN" "$MINIAPP_URL" "$C_OFF"
