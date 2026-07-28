# Bật CI/CD — deploy tự động

> Sau khi cấu hình xong: **push vào `main` là Mini App tự lên Zalo**, và
> `apps/api/**` đổi thì API tự build image rồi deploy lên VPS.

---

## Bức tranh

| Workflow | Kích hoạt | Làm gì |
|---|---|---|
| `ci.yml` | mọi PR + push `main` | lint, typecheck, test |
| `cd-development.yml` | push `main` (đổi `apps/miniapp/**`) | deploy Mini App bản **development** (ghi đè, không đánh số) |
| `release.yml` | tag `v*.*.*` | deploy Mini App bản **testing** (đánh số, gửi xét duyệt được) |
| `deploy-api.yml` | push `main` (đổi `apps/api/**`) | build image → GHCR → SSH lên VPS deploy |
| `deploy-infra.yml` | push `main` (đổi `infra/**`) | rsync infra lên VPS |
| `zmp-token-health.yml` | định kỳ | cảnh báo trước khi `ZMP_TOKEN` hết hạn |

---

## Bước 1 — Tạo GitHub Environment

Repo → **Settings → Environments** → tạo hai môi trường: `development` và `production`.

Với `production`, bật **Required reviewers** (thêm chính bạn) — deploy bản testing
sẽ phải bấm duyệt, tránh lỡ tay lúc 2h sáng.

## Bước 2 — Nạp secrets & variables

Nhanh nhất bằng `gh` CLI (chạy tại thư mục repo):

```bash
gh auth login    # nếu chưa đăng nhập
```

**Secrets cho Mini App** — đặt ở cả hai environment:

```bash
for ENV in development production; do
  gh secret set ZALO_APP_ID --env "$ENV" --body "126962352654603209"
  gh secret set ZMP_TOKEN   --env "$ENV" --body "$(grep '^ZMP_TOKEN=' apps/miniapp/.env | cut -d= -f2-)"
done
```

**Variables cho Mini App** — `vars.*` hiện rõ trong log, chỉ đặt giá trị công khai:

```bash
API_BASE=$(ssh -p 2222 zah19-team35@118.102.2.135 \
  "grep '^PUBLIC_BASE_URL=' /opt/zino/.env | tail -1 | cut -d= -f2-")

gh variable set API_BASE_URL --env development --body "$API_BASE/api"
gh variable set API_BASE_URL --env production  --body "$API_BASE/api"
gh variable set MINIAPP_URL  --env development --body "https://zalo.me/s/126962352654603209/"
gh variable set MINIAPP_URL  --env production  --body "https://zalo.me/s/126962352654603209/"
gh variable set MAX_BUNDLE_MB --env development --body "8"
```

> ⚠️ `VITE_*` bị **nhúng vào bundle client** — ai tải app cũng đọc được.
> Tuyệt đối không đặt API key, mật khẩu DB, ZaloPay key ở đây. Secret phải nằm ở backend.

**Secrets cho API/VPS** — đặt ở repo level (dùng chung mọi environment):

```bash
gh secret set VPS_HOST --body "118.102.2.135"
gh secret set VPS_USER --body "zah19-team35"
gh secret set VPS_PORT --body "2222"
gh secret set VPS_SSH_KEY < ~/.ssh/id_ed25519        # private key, KHÔNG phải .pub
gh secret set GHCR_PULL_TOKEN --body "<PAT có scope read:packages>"
```

Chưa có SSH key thì tạo và cài lên VPS trước:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/zino_vps -N ""
ssh-copy-id -i ~/.ssh/zino_vps.pub -p 2222 zah19-team35@118.102.2.135
gh secret set VPS_SSH_KEY < ~/.ssh/zino_vps
```

## Bước 3 — Kiểm tra đã đủ chưa

```bash
gh secret list --env development
gh variable list --env development
gh secret list
```

Danh sách phải có:

| Nơi đặt | Tên | Loại |
|---|---|---|
| env `development` + `production` | `ZALO_APP_ID`, `ZMP_TOKEN` | secret |
| env `development` + `production` | `API_BASE_URL`, `MINIAPP_URL` | variable |
| repo | `VPS_HOST`, `VPS_USER`, `VPS_PORT`, `VPS_SSH_KEY`, `GHCR_PULL_TOKEN` | secret |

## Bước 4 — Chạy thử

Deploy tay trước khi tin vào trigger tự động:

```bash
gh workflow run "Deploy Mini App (reusable)" \
  -f environment=development \
  -f version-status=development \
  -f description="test CI"

gh run watch
```

Xanh thì mở `https://zalo.me/s/126962352654603209/` kiểm tra.

## Bước 5 — Ra bản chính thức

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Tag `v*` kích hoạt `release.yml` → deploy bản **testing** (được đánh số, hiện trong
Quản lý phiên bản trên developers.zalo.me, gửi xét duyệt được).

---

## Lưu ý vận hành

**`ZMP_TOKEN` hết hạn** là nguyên nhân hỏng CI phổ biến nhất. Có sẵn
`zmp-token-health.yml` cảnh báo trước. Hết hạn thì lấy lại và nạp:

```bash
cd apps/miniapp && zmp login
gh secret set ZMP_TOKEN --env development --body "$(grep '^ZMP_TOKEN=' .env | cut -d= -f2-)"
gh secret set ZMP_TOKEN --env production  --body "$(grep '^ZMP_TOKEN=' .env | cut -d= -f2-)"
```

**Đổi URL API** (tunnel chết, hoặc BTC trỏ DNS xong) thì phải cập nhật `API_BASE_URL`
**rồi deploy lại** — URL nằm cứng trong bundle, sửa variable không đủ:

```bash
gh variable set API_BASE_URL --env development --body "https://zah-35.123c.vn/api"
gh workflow run "Deploy Mini App (reusable)" -f environment=development -f version-status=development -f description="đổi sang domain BTC"
```

**Trong ngày demo, đừng dựa vào CI.** Dùng `bash scripts/deploy-miniapp.sh` — nhanh
hơn, thấy lỗi ngay tại máy, không phụ thuộc GitHub Actions còn sống hay không.
CI là để về sau, không phải để cứu hoả.
