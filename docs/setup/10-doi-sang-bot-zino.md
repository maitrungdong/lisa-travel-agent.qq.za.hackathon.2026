# Đổi từ bot Lisa sang bot Zino (làm 1 lần)

Tài liệu này liệt kê **những việc phải làm bằng tay** — phần trong repo đã được đổi sẵn.

- Tên: **Zino** — *Zalo Intelligent Needs, Trợ lý nhu cầu*
- Bot Zalo: token mới (bot Lisa cũ **ngừng dùng**)
- Chuyên môn vẫn là du lịch, chỉ đổi định vị + tên

---

## 0. Repo đã đổi sẵn những gì

| Mục | Trước | Sau |
|---|---|---|
| Thư mục project | `projects/lisa-travel-agent/` | `projects/zino-travel-agent/` |
| Persona agent | `Lisa` | `Zino` (`infra/openclaw/workspace/AGENTS.md`, `SOUL.md`, `apps/api/src/agent/prompt.ts`) |
| Tên account OpenClaw | `"name": "Lisa"` | `"name": "Zino"` (`infra/openclaw/openclaw.json`) |
| Biến môi trường | `LISA_*` | `ZINO_*` (`ZINO_API_BASE_URL`, `ZINO_MODEL`, `ZINO_SKIP_NGINX`…) |
| Thư mục VPS | `/opt/lisa` | `/opt/zino` |
| nginx conf | `infra/nginx/lisa.conf` | `infra/nginx/zino.conf` (đích: `/etc/nginx/conf.d/zino.conf`) |
| Docker compose project | `lisa`, `lisa-local` | `zino`, `zino-local` |
| Postgres user/db | `lisa` | `zino` |
| Mini App | "Lisa – Trợ lý du lịch" | "Zino – Trợ lý nhu cầu" |
| `ZALO_BOT_TOKEN` trong `.env` local | token cũ | **token mới** (đã điền) |
| `credentials/zalo-default-allowFrom.json` | id user cũ | đã reset về rỗng (backup `.old-bot.bak`) |

---

## 1. Cấu hình bot trên Zalo

Vào [bot.zaloplatforms.com](https://bot.zaloplatforms.com) → chọn bot mới:

| Trường | Giá trị |
|---|---|
| Tên hiển thị | `Zino` (hoặc `ZINO - Trợ lý nhu cầu`) |
| Giới thiệu / mô tả | `Zalo Intelligent Needs - Trợ lý nhu cầu.` |
| Avatar | logo Zino |
| Quyền | **bật cho phép thêm bot vào nhóm** |

Sau đó:

- **Tắt / xoá bot Lisa cũ** để hai con không cùng long-poll giành tin nhắn.
- Kiểm tra token sống — Zalo Bot API đặt token trong **path**, gọi bằng **POST** với body JSON rỗng
  (xem `apps/api/src/zalo/zalo.client.ts`):

```bash
TOKEN='<token Zino>'
curl -s -X POST "https://bot-api.zaloplatforms.com/bot$TOKEN/getMe" \
  -H 'Content-Type: application/json' -d '{}'
```

Kỳ vọng `{"ok":true,"result":{...}}`. Nếu `ok:false` → đọc `error_code`/`description`:
token sai hoặc đã revoke. Base URL đổi được qua `ZALO_BOT_API_BASE`.

> ⚠️ Token bot đã được dán vào chat và commit vào `.env` local. `.env` nằm trong `.gitignore` nên không lên git, nhưng sau hackathon nên **revoke và tạo token mới** trên bot.zaloplatforms.com.

---

## 2. GitHub

1. **Đổi tên repo**: Settings → Repository name → `zino-travel-agent.qq.za.hackathon.2026`.
   `IMAGE_NAME` trong `deploy-api.yml` lấy từ `${{ github.repository }}` nên image GHCR tự đổi theo — không phải sửa workflow.
2. Cập nhật remote ở máy dev:

```bash
cd projects/zino-travel-agent
git remote set-url origin https://github.com/maitrungdong/zino-travel-agent.qq.za.hackathon.2026.git
git remote -v
```

3. Secrets — **không workflow nào đọc `ZALO_BOT_TOKEN`** (đã kiểm: workflows chỉ dùng
   `VPS_*`, `ZALO_APP_ID`, `ZMP_TOKEN`, `GHCR_PULL_TOKEN`, `GITHUB_TOKEN`). Token bot chỉ
   sống ở `/opt/zino/.env` trên VPS và `.env` máy dev. Nếu trước đây bạn vẫn tạo secret này
   cho gọn thì đồng bộ luôn bằng [`scripts/switch-bot-token.sh`](../../scripts/switch-bot-token.sh).
4. `.env` ở root project đang trỏ `API_IMAGE=ghcr.io/maitrungdong/zino-travel-agent.qq.za.hackathon.2026/api:latest` — chỉ đúng **sau khi** đã đổi tên repo và build lại. Đồng bộ tự động theo tên repo hiện tại:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
TAG=${TAG:-latest}
sed -i.bak "s|^API_IMAGE=.*|API_IMAGE=ghcr.io/$REPO/api:$TAG|" .env && rm -f .env.bak
grep '^API_IMAGE=' .env
```

---

## 3. VPS — đổi `/opt/lisa` → `/opt/zino`

Compose project name đổi từ `lisa` sang `zino` ⇒ volume `lisa_pgdata` **không** được dùng lại. Phải dump/restore, nếu không sẽ mất toàn bộ dữ liệu chuyến đi.

```bash
# 3.1 Backup DB cũ
cd /opt/lisa
docker compose exec -T postgres pg_dump -U lisa -d lisa --no-owner --no-acl > ~/zino-data.sql
ls -lh ~/zino-data.sql          # phải > 0 byte

# 3.2 Tắt stack cũ
docker compose down

# 3.3 Đổi thư mục
sudo mv /opt/lisa /opt/zino
sudo chown -R 1000:1000 /opt/zino

# 3.4 Sửa .env (file này KHÔNG nằm trong git, phải sửa tay)
cd /opt/zino && vi .env
#   ZALO_BOT_TOKEN=<token Zino mới>
#   MEDIA_HOST_DIR / RECAP_HOST_DIR nếu có ghi tường minh /opt/lisa → /opt/zino
#   API_IMAGE=ghcr.io/maitrungdong/zino-travel-agent.qq.za.hackathon.2026/api:<tag>

# 3.5 Dựng postgres mới (volume zino_pgdata, user/db = zino) rồi nạp dữ liệu
docker compose up -d postgres
docker compose exec -T postgres pg_isready -U zino -d zino
docker compose exec -T postgres psql -U zino -d zino < ~/zino-data.sql

# 3.6 Bật cả stack
docker compose up -d
docker compose ps
```

### nginx

```bash
sudo mv /etc/nginx/conf.d/lisa.conf /etc/nginx/conf.d/zino.conf
# hoặc cài lại từ repo: sudo cp infra/nginx/zino.conf /etc/nginx/conf.d/zino.conf
sudo nginx -t && sudo systemctl reload nginx
curl -s https://<DOMAIN>/healthz     # kỳ vọng: "Zino Travel Agent - OK"
```

### Dọn rác sau khi chắc chắn chạy ổn

```bash
docker volume rm lisa_pgdata
rm ~/zino-data.sql
```

> **Muốn tránh rủi ro DB?** Mở `infra/docker-compose.yml`, đổi ngược 4 chỗ `POSTGRES_USER`, `POSTGRES_DB`, `pg_isready -U ... -d ...`, `DATABASE_URL` về `lisa`, và giữ `name: lisa` ở đầu file. Khi đó bước 3.1/3.5 bỏ qua được, volume cũ dùng tiếp bình thường.

---

## 4. Chạy local (OpenClaw trên máy dev)

```bash
cd projects/zino-travel-agent/infra/openclaw-local
docker compose -p lisa-local down      # tắt con Lisa cũ trước!
docker compose up -d
docker compose logs -f openclaw
```

`state/openclaw.json` và `state/workspace/{AGENTS,SOUL}.md` đã đổi sang Zino. Nếu muốn khởi tạo sạch hoàn toàn cho bot mới:

```bash
mv state state.lisa.bak && cp -r ../openclaw state
docker compose run --rm --entrypoint node openclaw dist/index.js onboard --mode local --no-install-daemon
```

---

## 5. Ghép lại quyền (bắt buộc — bot mới ⇒ user id mới)

Bot mới cấp id người dùng khác bot cũ, nên danh sách cũ vô nghĩa:

- `state/credentials/zalo-default-allowFrom.json` — đã reset về `[]`.
- `state/openclaw.json` → `commands.ownerAllowFrom` vẫn còn `zalo:facc138ccbd922877bc8` (id thời Lisa). Sau khi ghép lại, thay bằng id mới.

Cách làm:

1. Nhắn tin riêng cho bot Zino → bot trả về **pairing code**.
2. Duyệt:

```bash
docker compose exec openclaw node dist/index.js pairing approve zalo <CODE>
```

3. Lấy id vừa được duyệt trong `state/credentials/zalo-default-allowFrom.json`, dán vào `commands.ownerAllowFrom` dạng `zalo:<id>`, rồi restart.
4. Add bot Zino vào nhóm Zalo và @mention thử.

---

## 6. Cột `created_by`

Default của `trip_events.created_by` đổi `'lisa'` → `'zino'` (`schema.ts` + migration `0000`). Với DB đã chạy, chạy thêm:

```sql
ALTER TABLE trip_events ALTER COLUMN created_by SET DEFAULT 'zino';
UPDATE trip_events SET created_by = 'zino' WHERE created_by = 'lisa';
```

---

## 7. Checklist nghiệm thu

- [ ] `getMe` trả về đúng bot Zino
- [ ] Bot Lisa cũ đã tắt / không còn poll
- [ ] Repo GitHub đã đổi tên, remote local trỏ đúng, secret `ZALO_BOT_TOKEN` đã cập nhật
- [ ] `/opt/zino` chạy, `docker compose ps` xanh, DB có đủ dữ liệu cũ
- [ ] `https://<DOMAIN>/healthz` trả `Zino Travel Agent - OK`
- [ ] Nhắn riêng → nhận pairing code → duyệt được
- [ ] @Zino trong nhóm → trả lời, tự xưng là Zino
- [ ] Mini App hiển thị "Zino – Trợ lý nhu cầu"
- [ ] `grep -rni lisa` trong repo (trừ `node_modules`, `state/`, `.git`) không còn kết quả
