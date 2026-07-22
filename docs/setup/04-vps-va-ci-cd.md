# VPS & CI/CD full flow

## 1. Setup VPS (làm 1 lần)

Yêu cầu: VPS Ubuntu ≥ 2GB RAM, domain đã trỏ `A` record (`api.<domain>`) về IP VPS.

```bash
# 1. Trên VPS: cài Docker, mở firewall, tạo /opt/lisa
bash scripts/vps-bootstrap.sh   # scp lên rồi chạy

# 2. Từ máy dev: đẩy infra lần đầu
rsync -avz infra/ user@vps:/opt/lisa/

# 3. Trên VPS: điền secret rồi khởi động
cd /opt/lisa
cp .env.example .env && nano .env   # DOMAIN, POSTGRES_PASSWORD, API_IMAGE,
                                    # AGENT_API_KEY, ZALO_BOT_TOKEN, ANTHROPIC_API_KEY
docker compose up -d

# 4. Onboard OpenClaw (1 lần — chọn Anthropic; kênh Zalo đọc token từ env)
docker compose run --rm --entrypoint node openclaw dist/index.js onboard --mode local --no-install-daemon

# 5. Tạo schema DB (từ máy dev, qua SSH tunnel)
ssh -L 5432:127.0.0.1:5432 user@vps        # giữ tunnel mở
DATABASE_URL=postgres://lisa:<password>@localhost:5432/lisa pnpm db:push
```

Control UI của OpenClaw **không expose ra internet** — truy cập qua tunnel:
`ssh -L 18789:127.0.0.1:18789 user@vps` → mở `http://127.0.0.1:18789`.

Persona Lisa: `infra/openclaw/workspace/AGENTS.md` (nhiệm vụ + cách gọi API) và `SOUL.md` (giọng điệu) — sửa trong repo, push lên `main` là workflow tự sync + restart openclaw.

## 2. GitHub Environments, secrets & variables

Tạo 3 Environments: `development`, `testing`, `production` (production bật **required reviewers**).

| Secret | Env | Dùng cho |
|---|---|---|
| `ZALO_APP_ID`, `ZMP_TOKEN` | cả 3 | Deploy mini app (`zmp-cli`) |
| `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_PORT` (optional) | development | SSH deploy API + infra |
| `GHCR_PULL_TOKEN` | development | VPS pull image private từ GHCR (PAT scope `read:packages`; bỏ qua nếu package public) |

| Variable | Dùng cho |
|---|---|
| `API_BASE_URL` | Smoke test sau deploy (vd `https://api.<domain>`) |
| `VITE_API_BASE_URL` | Inject vào build mini app |

SSH key riêng cho deploy: `ssh-keygen -t ed25519 -f deploy_key` → public key vào `~/.ssh/authorized_keys` trên VPS, private key vào secret `VPS_SSH_KEY`.

## 3. Flow tự động sau khi setup

| Sự kiện | Workflow | Kết quả |
|---|---|---|
| PR / push `main` | `ci.yml` | lint + typecheck + test + build cả 2 app |
| Push `main` (đổi `apps/miniapp`) | `cd-development.yml` | Deploy bản DEVELOPMENT lên Zalo — quét QR xem ngay |
| Push `main` (đổi `apps/api`) | `deploy-api.yml` | Build image → GHCR → SSH VPS `compose pull && up -d api` → smoke test `/health` |
| Push `main` (đổi `infra/`) | `deploy-infra.yml` | Rsync compose/Caddyfile/persona → `compose up -d` + restart openclaw |
| Tag `v*` | `release.yml` | Verify → deploy bản TESTING lên Zalo (gửi xét duyệt được) + GitHub Release |
| Thứ Hai hàng tuần | `zmp-token-health.yml` | Canh hạn `ZMP_TOKEN`, sắp hết hạn thì mở issue |

Rollback API: re-run `deploy-api.yml` ở commit cũ (image pin theo SHA).

## 4. Checklist demo hackathon

- [ ] Add bot Lisa vào nhóm Zalo của team, @Lisa để lên kế hoạch.
- [ ] Lisa tạo trip qua `POST /trips` → mở mini app thấy chuyến đi, lịch trình, chi phí.
- [ ] Sửa `AGENTS.md` → push → Lisa đổi hành vi (demo "agentic ops").
- [ ] `git tag v0.1.0 && git push --tags` → bản TESTING để đưa Zalo xét duyệt.

## Nguồn

- [OpenClaw Zalo channel](https://docs.openclaw.ai/channels/zalo) · [OpenClaw Docker](https://docs.openclaw.ai/install/docker) · [Zalo ClawBot](https://docs.openclaw.ai/channels/zaloclawbot)
- [Zalo Mini App docs](https://mini.zalo.me/documents/) · [bot.zaloplatforms.com](https://bot.zaloplatforms.com)
