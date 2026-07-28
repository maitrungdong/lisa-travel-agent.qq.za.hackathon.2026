#!/usr/bin/env bash
# =============================================================================
#  deploy-api-local.sh — deploy API lên VPS TỪ MÁY DEV, không qua GitHub Actions.
#
#      bash scripts/deploy-api-local.sh
#      bash scripts/deploy-api-local.sh --no-verify     # bỏ qua typecheck/test
#
#  Dùng khi: CI hỏng, hết quota Actions, hoặc cần đẩy nhanh một bản vá giữa demo.
#
#  CÁCH LÀM: đẩy source apps/api lên VPS rồi BUILD NGAY TRÊN VPS.
#
#  Vì sao không build ở máy rồi push image:
#    • VPS là x86_64 (Rocky 9), Mac M-series là arm64. Build ở máy phải nhớ
#      --platform linux/amd64; quên là container khởi động rồi chết ngay với
#      "exec format error" — lỗi chỉ lộ ra sau khi đã đẩy xong.
#    • Qua GHCR thì cần thêm PAT write:packages; `docker save | ssh docker load`
#      thì đẩy ~200MB qua mạng hội trường.
#    • Source apps/api chỉ vài trăm KB, VPS có 4 vCPU — build tại chỗ ~1 phút.
#
#  Biến môi trường (đều có mặc định):
#    VPS_HOST   mặc định 118.102.2.135
#    VPS_USER   mặc định zah19-team35
#    VPS_PORT   mặc định 2222
#    REMOTE_DIR mặc định /opt/zino
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

VPS_HOST="${VPS_HOST:-118.102.2.135}"
VPS_USER="${VPS_USER:-zah19-team35}"
VPS_PORT="${VPS_PORT:-2222}"
REMOTE_DIR="${REMOTE_DIR:-/opt/zino}"
VERIFY=1

DIRTY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --no-verify) VERIFY=0; shift ;;
    --dirty)     DIRTY=1; shift ;;
    -h|--help)   sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "Tham số lạ: $1" >&2; exit 1 ;;
  esac
done

C_GRN=$'\033[0;32m'; C_YEL=$'\033[0;33m'; C_RED=$'\033[0;31m'; C_CYN=$'\033[1;36m'; C_OFF=$'\033[0m'
step() { printf '\n%s==> %s%s\n' "$C_CYN" "$*" "$C_OFF"; }
ok()   { printf '  %s[OK]%s   %s\n' "$C_GRN" "$C_OFF" "$*"; }
warn() { printf '  %s[WARN]%s %s\n' "$C_YEL" "$C_OFF" "$*"; }
die()  { printf '\n  %s[LỖI]%s %s\n\n' "$C_RED" "$C_OFF" "$*"; exit 1; }

SSH="ssh -p $VPS_PORT -o ConnectTimeout=10 $VPS_USER@$VPS_HOST"

# Tag theo commit + giờ: mỗi lần deploy là một tag khác nhau, nếu không
# `docker compose up -d` thấy image trùng tên sẽ không tạo lại container.
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
TAG="zino-api:local-${SHA}-$(date +%H%M%S)"

# ---------------------------------------------------------------------------
step "1/6 · Kiểm tra trước khi tốn công"

git diff --quiet -- apps/api || warn "apps/api còn thay đổi CHƯA COMMIT — vẫn deploy, nhưng tag $SHA sẽ không khớp với thứ đang chạy"

$SSH "command -v docker >/dev/null" || die "Không SSH được hoặc VPS chưa có docker: $VPS_USER@$VPS_HOST:$VPS_PORT"
ok "SSH tới $VPS_HOST OK"

$SSH "[ -f $REMOTE_DIR/.env ]" || die "$REMOTE_DIR/.env không tồn tại — chạy vps-bootstrap.sh trước"
ok "$REMOTE_DIR/.env có sẵn"

# ---------------------------------------------------------------------------
step "2/6 · Typecheck + test ở máy"

if [ "$VERIFY" = 1 ]; then
  pnpm --filter api typecheck || die "Typecheck trượt — sửa xong hãy deploy"
  pnpm test || die "Test trượt — sửa xong hãy deploy"
  ok "typecheck + test sạch"
else
  warn "bỏ qua kiểm tra (--no-verify)"
fi

# ---------------------------------------------------------------------------
step "3/6 · Đẩy source lên VPS"

# ---------------------------------------------------------------------------
# MẶC ĐỊNH ĐẨY TỪ COMMIT (git archive HEAD), KHÔNG phải thư mục làm việc.
#
# Bản đầu tar thẳng working tree. Nghe thì tiện, nhưng repo này có nhiều phiên
# làm việc song song — và nó đã cắn thật: một file đang sửa dở của người khác
# (v7.service.ts) đi vào image rồi làm chết `tsc` giữa lúc deploy, trong khi
# thay đổi của mình không liên quan gì.
#
# Đẩy từ HEAD được hai thứ cùng lúc: image LUÔN khớp với một commit (truy được,
# rollback được), và WIP của người khác không bao giờ lọt vào production.
#
# Cần deploy code chưa commit thì phải nói rõ ý định: --dirty
# ---------------------------------------------------------------------------

# tar qua ssh thay vì rsync: Rocky tối giản có thể không cài sẵn rsync, còn tar
# thì luôn có. Loại node_modules/dist — Dockerfile tự cài và tự build.
$SSH "rm -rf $REMOTE_DIR/build/api && mkdir -p $REMOTE_DIR/build/api"

if [ "$DIRTY" = 1 ]; then
  warn "đẩy THƯ MỤC LÀM VIỆC (--dirty) — gồm cả file chưa commit của mọi người"
  tar czf - -C "$ROOT/apps" \
      --exclude=api/node_modules --exclude=api/dist --exclude=api/.env \
      api | $SSH "tar xzf - -C $REMOTE_DIR/build"
else
  git -C "$ROOT" rev-parse --verify HEAD >/dev/null 2>&1 ||
    die "Không có commit nào để deploy. Commit trước, hoặc dùng --dirty nếu thật sự cần."

  # `HEAD:apps/api` xuất thẳng nội dung thư mục con, khỏi phải strip prefix
  git -C "$ROOT" archive HEAD:apps/api | $SSH "tar xf - -C $REMOTE_DIR/build/api" ||
    die "git archive thất bại"

  # Nói rõ cái gì KHÔNG được deploy — im lặng ở đây là kiểu bất ngờ tệ nhất:
  # sửa xong, deploy xong, mở app vẫn thấy hành vi cũ.
  UNCOMMITTED="$(git -C "$ROOT" status --porcelain apps/api | head -20)"
  if [ -n "$UNCOMMITTED" ]; then
    warn "các thay đổi sau CHƯA COMMIT nên KHÔNG có trong bản deploy này:"
    printf '%s\n' "$UNCOMMITTED" | sed 's/^/           /'
    warn "muốn deploy chúng: commit rồi chạy lại, hoặc dùng --dirty"
  fi
fi

# tar giữ nguyên mode của máy dev. Thư mục làm việc 0600 → file vào image cũng
# 0600 thuộc root, mà container chạy USER node → EACCES lúc đọc bootstrap.sql,
# container crash-loop. Dockerfile đã tự chmod, đây là lớp chắn thứ hai cho
# trường hợp build bằng Dockerfile cũ.
$SSH "chmod -R a+rX $REMOTE_DIR/build/api"
ok "source apps/api đã lên $REMOTE_DIR/build/api (đã chuẩn hoá quyền đọc)"

# ---------------------------------------------------------------------------
step "4/6 · Build image trên VPS"

$SSH "cd $REMOTE_DIR/build/api && docker build -t '$TAG' ." || die "Build thất bại — xem log phía trên"
ok "đã build $TAG"

# ---------------------------------------------------------------------------
step "5/6 · Đổi API_IMAGE rồi khởi động lại"

# KHÔNG `docker compose pull api`: tag local không có trên registry nào, pull
# sẽ fail. Image vừa build nằm sẵn trong docker daemon của VPS.
$SSH "cd $REMOTE_DIR && \
      cp .env .env.bak.\$(date +%s) && \
      sed -i 's|^API_IMAGE=.*|API_IMAGE=$TAG|' .env && \
      docker compose up -d api" || die "docker compose up thất bại"
ok "container api đã chạy với $TAG"

# ---------------------------------------------------------------------------
step "6/6 · Đợi healthcheck rồi thử endpoint"

BASE="$($SSH "grep '^PUBLIC_BASE_URL=' $REMOTE_DIR/.env | tail -1 | cut -d= -f2-" | tr -d '\r')"
BASE="${BASE:-https://zah-35.123c.vn}"

for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --max-time 10 "$BASE/api/health" >/dev/null 2>&1; then
    ok "$BASE/api/health trả lời"
    break
  fi
  [ "$i" = 10 ] && die "API không lên sau ~100s. Xem log: $SSH 'cd $REMOTE_DIR && docker compose logs --tail=80 api'"
  printf '  đợi API khởi động (%s/10)...\n' "$i"
  sleep 10
done

# Endpoint mới — nếu 404 thì image đang chạy vẫn là bản cũ, deploy chưa ăn.
TRIP_ID="$(curl -fsS --max-time 10 "$BASE/api/trips" 2>/dev/null | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)"
if [ -n "$TRIP_ID" ]; then
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/api/trips/$TRIP_ID/recap")"
  if [ "$CODE" = "200" ]; then
    ok "GET /api/trips/$TRIP_ID/recap → 200"
  else
    warn "GET /api/trips/$TRIP_ID/recap → $CODE (bản đang chạy chưa có endpoint recap?)"
  fi
else
  warn "chưa có chuyến đi nào trong DB — bỏ qua bước thử recap"
fi

printf '\n%s✔ Xong.%s\n' "$C_GRN" "$C_OFF"
printf '  Trang tổng kết : %s/api/trips/<id>/recap.html\n' "$BASE"
printf '  Log            : %s "cd %s && docker compose logs -f api"\n' "$SSH" "$REMOTE_DIR"
printf '\n  %sLưu ý:%s .env trên VPS giờ trỏ API_IMAGE vào tag local.\n' "$C_YEL" "$C_OFF"
printf '  Lần chạy deploy-api.yml kế tiếp sẽ ghi đè lại bằng image GHCR — đó là hành vi đúng.\n\n'
