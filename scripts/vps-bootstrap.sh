#!/usr/bin/env bash
# Bootstrap VPS Ubuntu trống → sẵn sàng chạy hệ thống Lisa.
# Chạy 1 lần trên VPS: bash vps-bootstrap.sh
set -euo pipefail

DEPLOY_DIR=/opt/lisa

echo "==> Cài Docker + Compose"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Firewall: chỉ mở SSH + HTTP/HTTPS"
if command -v ufw >/dev/null; then
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
fi

echo "==> Tạo thư mục deploy $DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"

# OpenClaw image chạy user uid 1000 — mount config phải đúng owner
mkdir -p "$DEPLOY_DIR/openclaw"
chown -R 1000:1000 "$DEPLOY_DIR/openclaw" || true

cat <<'MSG'

Xong. Tiếp theo:
  1. Copy thư mục infra/ của repo lên VPS:
       rsync -avz infra/ user@vps:/opt/lisa/
     (workflow deploy-infra.yml sẽ tự làm việc này về sau)
  2. Trên VPS:
       cd /opt/lisa
       cp .env.example .env && nano .env   # điền DOMAIN, token, key
       docker compose up -d
  3. Tạo schema DB lần đầu (từ máy dev, qua SSH tunnel):
       ssh -L 5432:127.0.0.1:5432 user@vps   # giữ tunnel mở
       DATABASE_URL=postgres://lisa:<password>@localhost:5432/lisa pnpm db:push
  4. Onboard OpenClaw (1 lần, chọn Anthropic + kênh Zalo):
       docker compose run --rm --entrypoint node openclaw dist/index.js onboard --mode local --no-install-daemon
MSG
