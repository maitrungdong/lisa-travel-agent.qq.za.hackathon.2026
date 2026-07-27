#!/usr/bin/env bash
# =============================================================================
#  deploy-miniapp.sh — build & deploy Zalo Mini App bằng MỘT lệnh.
#
#  Chạy TỪ MÁY DEV (macOS/Linux), không phải VPS:
#      bash scripts/deploy-miniapp.sh
#      bash scripts/deploy-miniapp.sh --testing -m "bản demo chung kết"
#
#  Script lo trọn 6 bước hay quên:
#    1. Lấy PUBLIC_BASE_URL từ VPS (hoặc từ tham số) → VITE_API_BASE_URL
#    2. Kiểm tra API còn sống trước khi tốn công build
#    3. Xoá www/ rồi build sạch  ← quên bước này là deploy nhầm bundle cũ
#    4. Đồng bộ app-config.json theo asset thực tế
#    5. zmp deploy --passive --existing
#    6. In link mở app
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

while [ $# -gt 0 ]; do
  case "$1" in
    --testing) STATUS_FLAG="--testing"; shift ;;
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
step "1/6 · Xác định URL API"

if [ -z "${API_BASE:-}" ]; then
  echo "  hỏi VPS $VPS_USER@$VPS_HOST:$VPS_PORT ..."
  API_BASE="$(ssh -p "$VPS_PORT" -o ConnectTimeout=10 "$VPS_USER@$VPS_HOST" \
    "grep '^PUBLIC_BASE_URL=' /opt/lisa/.env | tail -1 | cut -d= -f2-" 2>/dev/null || true)"
fi

API_BASE="$(printf '%s' "$API_BASE" | tr -d '[:space:]' | sed 's:/*$::')"
[ -n "$API_BASE" ] || die "Không lấy được PUBLIC_BASE_URL. Truyền tay: --base https://xxx"
ok "API_BASE = $API_BASE"

# ---------------------------------------------------------------------------
step "2/6 · Kiểm tra API còn sống"

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
step "3/6 · Ghi VITE_API_BASE_URL"

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
step "4/6 · Build sạch"

# rm -rf là CHỦ Ý: build chồng lên bundle cũ dễ để lại file thừa mà
# sync-app-config khai vào listSyncJS → Zalo nạp file rác.
rm -rf www
cd "$ROOT"
pnpm --filter miniapp build
cd "$MINIAPP"
[ -d www ] && [ -n "$(ls -A www 2>/dev/null)" ] || die "Build không sinh ra www/."
ok "$(find www -type f | wc -l | tr -d ' ') file trong www/"

# ---------------------------------------------------------------------------
step "5/6 · Đồng bộ app-config.json"

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
step "6/6 · Deploy lên Zalo"

command -v zmp >/dev/null 2>&1 || die "Chưa cài zmp-cli. Chạy: npm install -g zmp-cli@4.0.3"

# shellcheck disable=SC2086
zmp deploy --passive --existing --outputDir www --desc "$DESC" $STATUS_FLAG

APP_ID="$(grep '^APP_ID=' .env | tail -1 | cut -d= -f2-)"
APP_URL="https://zalo.me/s/${APP_ID}/"

printf '\n%s✅ Deploy xong%s\n' "$C_GRN" "$C_OFF"
printf '   App   : %s\n' "$APP_URL"
printf '   API   : %s\n' "$API_BASE"
printf '   Ghi chú: %s\n' "$DESC"

# QR ngay trong terminal — quét bằng camera điện thoại là mở app, khỏi gõ URL.
#
# Thông tin quan trọng (URL app, API) đã in Ở TRÊN rồi. QR chỉ là tiện thêm, nên
# nó không bao giờ được phép chặn hay làm hỏng deploy: có timeout, nuốt lỗi,
# và luôn có URL dạng chữ để dùng thay.
printf '\n%s   Quét QR bằng điện thoại:%s\n\n' "$C_CYN" "$C_OFF"

qr_bin=""
if [ -x "$ROOT/node_modules/.bin/qrcode-terminal" ]; then
  qr_bin="$ROOT/node_modules/.bin/qrcode-terminal"     # đã cài sẵn → nhanh, offline
fi

run_qr() {
  if [ -n "$qr_bin" ]; then
    "$qr_bin" "$APP_URL"
  # npx phải tải gói lần đầu; giới hạn 25s để mạng chậm không treo terminal
  elif command -v timeout >/dev/null 2>&1; then
    timeout 25 npx --yes qrcode-terminal@0.12.0 "$APP_URL"
  elif command -v gtimeout >/dev/null 2>&1; then        # coreutils trên macOS
    gtimeout 25 npx --yes qrcode-terminal@0.12.0 "$APP_URL"
  else
    npx --yes qrcode-terminal@0.12.0 "$APP_URL"
  fi
}

run_qr 2>/dev/null || printf '   (bỏ qua QR — mở thẳng: %s)\n' "$APP_URL"

printf '\n   openChat chỉ chạy trong app Zalo thật — test màn Handoff bằng ĐIỆN THOẠI.\n\n'
