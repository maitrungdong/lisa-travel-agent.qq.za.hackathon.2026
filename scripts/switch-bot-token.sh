#!/usr/bin/env bash
#
#  switch-bot-token.sh — đổi bot Zalo (Lisa → Zino) ở mọi nơi lưu token.
#
#  LƯU Ý QUAN TRỌNG: không workflow nào trong .github/workflows đọc ZALO_BOT_TOKEN.
#  Token chỉ sống ở /opt/<deploy>/.env trên VPS và .env ở máy dev. Script vẫn set
#  secret trên GitHub (nếu repo đang có) để hai bên không lệch nhau.
#
#  Dùng:
#      bash scripts/switch-bot-token.sh                 # xem hiện trạng, không đổi gì
#      TOKEN='<token>' bash scripts/switch-bot-token.sh --apply
#
#  Biến môi trường:
#      TOKEN        token bot mới (bắt buộc khi --apply)
#      REPO         owner/repo — mặc định lấy từ git remote
#      DEPLOY_DIR   thư mục trên VPS (mặc định /opt/zino)
#      SKIP_GH=1    bỏ qua phần GitHub secrets
#      SKIP_VPS=1   bỏ qua phần SSH vào VPS
#
set -euo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/zino}"
ENVIRONMENTS=(development production)

c()  { printf '\033[1;36m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✔\033[0m %s\n' "$*"; }
w()  { printf '  \033[33m!\033[0m %s\n' "$*"; }
die(){ printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }
mask(){ printf '%s' "$1" | sed -E 's/^(.{8}).*(.{4})$/\1…\2/'; }

REPO="${REPO:-$(git -C "$ROOT" remote get-url origin 2>/dev/null \
  | sed -E 's#.*github\.com[:/]##; s#\.git$##' || true)}"

if [ "$APPLY" = 1 ]; then
  [ -n "${TOKEN:-}" ] || die "Thiếu TOKEN. Chạy: TOKEN='...' bash $0 --apply"
  case "$TOKEN" in
    *:*) ;;
    *) die "TOKEN không đúng dạng '<id>:<secret>'";;
  esac
fi

# ────────────────────────────────────────────────────────────────────────────
c "1. GitHub — environment secrets"
# ────────────────────────────────────────────────────────────────────────────
if [ "${SKIP_GH:-0}" = 1 ]; then
  w "SKIP_GH=1 → bỏ qua"
elif ! command -v gh >/dev/null 2>&1; then
  w "chưa cài gh CLI → bỏ qua (https://cli.github.com)"
elif [ -z "$REPO" ]; then
  w "không xác định được repo → đặt REPO=owner/repo rồi chạy lại"
else
  echo "  repo: $REPO"
  gh auth status >/dev/null 2>&1 || die "gh chưa đăng nhập — chạy: gh auth login"

  for env in "${ENVIRONMENTS[@]}"; do
    if ! gh api "repos/$REPO/environments/$env" >/dev/null 2>&1; then
      w "environment '$env' không tồn tại → bỏ qua"
      continue
    fi
    has=$(gh secret list --env "$env" --repo "$REPO" 2>/dev/null \
          | awk '$1=="ZALO_BOT_TOKEN"{print "yes"}')
    if [ "$APPLY" = 1 ]; then
      gh secret set ZALO_BOT_TOKEN --env "$env" --repo "$REPO" --body "$TOKEN"
      ok "$env · ZALO_BOT_TOKEN = $(mask "$TOKEN")"
    elif [ "$has" = yes ]; then
      echo "  $env · ZALO_BOT_TOKEN đang tồn tại (chạy --apply để ghi đè)"
    else
      echo "  $env · chưa có ZALO_BOT_TOKEN"
    fi
  done
fi

# ────────────────────────────────────────────────────────────────────────────
c "2. .env ở máy dev"
# ────────────────────────────────────────────────────────────────────────────
for f in "$ROOT/.env" "$ROOT/infra/openclaw-local/.env"; do
  [ -f "$f" ] || { w "$(basename "$(dirname "$f")")/.env không có → bỏ qua"; continue; }
  cur=$(grep -E '^ZALO_BOT_TOKEN=' "$f" | head -1 | cut -d= -f2- || true)
  if [ "$APPLY" = 1 ]; then
    if grep -qE '^ZALO_BOT_TOKEN=' "$f"; then
      # sed -i khác nhau giữa macOS và GNU
      sed -i.bak "s|^ZALO_BOT_TOKEN=.*|ZALO_BOT_TOKEN=$TOKEN|" "$f" && rm -f "$f.bak"
    else
      printf 'ZALO_BOT_TOKEN=%s\n' "$TOKEN" >> "$f"
    fi
    ok "${f#"$ROOT"/} → $(mask "$TOKEN")"
  else
    echo "  ${f#"$ROOT"/} · $( [ -n "$cur" ] && mask "$cur" || echo 'chưa set')"
  fi
done

# ────────────────────────────────────────────────────────────────────────────
c "3. VPS — $DEPLOY_DIR/.env (đây mới là chỗ bot thật đọc token)"
# ────────────────────────────────────────────────────────────────────────────
if [ "${SKIP_VPS:-0}" = 1 ]; then
  w "SKIP_VPS=1 → bỏ qua"
else
  cat <<EOF
  Chạy tay (cần SSH vào VPS):

    ssh <VPS_USER>@<VPS_HOST> bash -s <<'REMOTE'
      cd $DEPLOY_DIR
      cp .env .env.bak.\$(date +%s)
      sed -i "s|^ZALO_BOT_TOKEN=.*|ZALO_BOT_TOKEN=\$TOKEN|" .env
      grep -c '^ZALO_BOT_TOKEN=' .env
      docker compose up -d api
      docker compose logs --tail=50 api
    REMOTE
EOF
fi

c "4. Kiểm tra token"
cat <<'EOF'
    curl -s -X POST "https://bot-api.zaloplatforms.com/bot$TOKEN/getMe" \
      -H 'Content-Type: application/json' -d '{}'
EOF

[ "$APPLY" = 1 ] || c "→ Chạy lại với --apply để thực sự ghi."
