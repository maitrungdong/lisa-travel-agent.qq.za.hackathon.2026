# Runbook — đưa Lisa lên VPS trong 1 ngày

> Làm tuần tự từ trên xuống. Mỗi bước có lệnh verify — **đừng sang bước sau khi bước
> trước chưa xanh**. Tổng thời gian ~60–90 phút nếu không vướng gì.

Thông tin cố định:

| | |
|---|---|
| VPS | `118.102.2.135`, SSH **cổng 2222**, user `zah19-team35` |
| Domain | `https://zah19-team35.123c.vn` (wildcard `*.123c.vn` chỉ phủ 1 cấp) |
| Webhook | `https://zah19-team35.123c.vn/zalo/webhook` |
| Bot | `Bot Đông Kiếm Em` — `can_join_groups: true` ✅ |

---

## Bước 0 — Chuẩn bị ở máy dev (5 phút)

```bash
# (ở máy dev, trong monorepo thì là projects/lisa-travel-agent)

# Sinh 3 khoá bí mật, chép ra chỗ nào đó, lát nữa dán vào .env trên VPS
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
echo "AGENT_API_KEY=$(openssl rand -hex 16)"
echo "ZALO_WEBHOOK_SECRET=$(openssl rand -hex 16)"
```

Chuẩn bị sẵn 2 thứ nữa: **`ZALO_BOT_TOKEN`** (Zalo Bot Manager → bot → API Token) và
**`ANTHROPIC_API_KEY`** (console.anthropic.com → API Keys).

---

## Bước 1 — Bootstrap VPS (15 phút)

```bash
ssh -p 2222 zah19-team35@118.102.2.135

git clone https://github.com/maitrungdong/lisa-travel-agent.qq.za.hackathon.2026 ~/lisa
cd ~/lisa
bash scripts/vps-bootstrap.sh
```

> ⚠️ `lisa-travel-agent` là repo ĐỘC LẬP, không phải thư mục con của monorepo.
> Sau khi clone, gốc repo nằm thẳng ở `~/lisa` — **không có** `~/lisa/projects/...`.

Script làm 6 việc: đổi timezone → `Asia/Ho_Chi_Minh`, cài Docker CE, cài rsync,
tạo `/opt/lisa/{media,recap}`, cài `lisa.conf` vào nginx rồi **reload nóng**, mở firewalld.

> ⛔ **Rủi ro lớn nhất ở đây là nginx.** nginx là của BTC, đang phục vụ các team khác.
> Script chỉ THÊM 1 file conf và chỉ reload khi `nginx -t` pass; fail thì tự khôi phục
> rồi dừng. **Không bao giờ tự tay `systemctl restart nginx`.**

**Verify:**

```bash
timedatectl | grep "Time zone"        # phải là Asia/Ho_Chi_Minh
docker --version && docker compose version
sudo nginx -t                          # syntax is ok / test is successful
ls -ld /opt/lisa/media /opt/lisa/recap # owner 1000:1000
```

---

## Bước 2 — Cấu hình & khởi động (10 phút)

```bash
sudo mkdir -p /opt/lisa && sudo chown $USER /opt/lisa
cp ~/lisa/infra/docker-compose.yml ~/lisa/infra/.env.example /opt/lisa/
```

Build image tại chỗ — không cần GHCR, không cần đăng nhập registry:

```bash
cd ~/lisa/apps/api && docker build -t lisa-api:local .
```

Rồi tạo `.env` bằng heredoc. **Không dùng vi/nano** — dán 1 khối, ít sai hơn:

```bash
cd /opt/lisa
cat > .env <<'EOF'
POSTGRES_PASSWORD=
API_IMAGE=lisa-api:local
AGENT_API_KEY=
ZALO_BOT_TOKEN=
ZALO_WEBHOOK_SECRET=
ANTHROPIC_API_KEY=
PUBLIC_BASE_URL=https://zah19-team35.123c.vn
CORS_ORIGINS=https://h5.zdn.vn,https://zah19-team35.123c.vn
EOF
```

> Điền giá trị vào TRƯỚC KHI paste. `<<'EOF'` có nháy đơn nên bash không diễn giải
> `$`, `!`, backtick trong token — quan trọng vì token Zalo hay chứa ký tự lạ.

Kiểm tra không biến nào rỗng:

```bash
grep -E '^[A-Z_]+=$' .env && echo "⚠️ CÒN BIẾN RỖNG" || echo "✅ đã điền đủ"
```

```bash
cd /opt/lisa && docker compose up -d
docker compose logs -f api        # chờ dòng "Schema đã đồng bộ" + "API listening on :3000"
```

Schema tự tạo lúc boot từ `bootstrap.sql` (idempotent) — **không cần chạy drizzle-kit.**

**Verify:**

```bash
curl -s http://127.0.0.1:3000/health              # từ VPS
curl -s https://zah19-team35.123c.vn/api/health   # từ máy dev — quan trọng hơn
```

Nếu lệnh thứ 2 fail mà lệnh 1 ok → vấn đề ở nginx, không phải ở app. Xem
`sudo tail -50 /var/log/nginx/error.log`.

---

## Bước 3 — Nối webhook Zalo (5 phút)

```bash
BOT_TOKEN='<token>'
SECRET='<ZALO_WEBHOOK_SECRET đúng như trong .env>'

curl -s -X POST "https://bot-api.zaloplatforms.com/bot$BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://zah19-team35.123c.vn/zalo/webhook\",
       \"secret_token\":\"$SECRET\",
       \"drop_pending_updates\":true}"
```

**Verify:**

```bash
curl -s https://zah19-team35.123c.vn/zalo/info | jq
# me.can_join_groups = true, webhook.url = đúng URL trên
```

Rồi nhắn cho bot trên Zalo một câu bất kỳ. Trong `docker compose logs -f api` phải thấy
job `agent_turn` được nhận và chạy.

> ⚠️ `secret_token` phải **khớp tuyệt đối** với `ZALO_WEBHOOK_SECRET` trong `.env`.
> Lệch một ký tự → mọi webhook bị từ chối im lặng (API vẫn trả 200 để Zalo khỏi retry).
> Triệu chứng: nhắn bot không thấy gì trong log.

---

## Bước 4 — Seed đối tác OA (5 phút)

```bash
docker compose exec api node -e "require('./dist/db/seed-partners.js')" \
  || docker compose exec api sh -c "cd /app && node dist/db/seed-partners.js"
```

> ⚠️ **Quan trọng cho demo:** `src/db/seed-partners.ts` đang dùng `oa_id` GIẢ
> (`demo-oa-*`). Bấm "Mở chat" với id giả sẽ lỗi trên sân khấu.
> **Trước khi demo phải thay bằng oa_id thật** — lấy từ URL `zalo.me/<oa_id>` của
> các OA du lịch công khai, hoặc dùng OA test của team. Sửa file rồi seed lại.

---

## Bước 5 — Mini App (20 phút, chạy song song được)

> ⚠️ **Chạy trên MÁY DEV, không phải VPS.** VPS không có Node/pnpm, và `zmp deploy`
> cần credential Zalo trên máy bạn. Mini App được đẩy lên CDN của Zalo — nó KHÔNG
> chạy trên VPS. VPS chỉ phục vụ API mà Mini App gọi vào.

```bash
# trên máy Mac, trong monorepo
cd projects/lisa-travel-agent/apps/miniapp
cp .env.example .env       # đặt VITE_API_BASE_URL=<PUBLIC_BASE_URL>/api
cd ../.. && pnpm install
pnpm --filter miniapp build
pnpm --filter miniapp exec zmp deploy    # hoặc dùng workflow CD · Development
```

`VITE_API_BASE_URL` phải trỏ về đúng nơi API đang chạy — domain BTC khi có DNS,
hoặc URL Cloudflare Tunnel khi đang test.

Màn quan trọng nhất là `/handoff` — Concierge Handoff. Test bằng cách mở:

```
https://zalo.me/s/<APP_ID>/#/handoff?oa=<OA_ID>&name=Sunrise%20Resort&msg=Ch%C3%A0o%20shop
```

**Nếu Mini App chưa sẵn sàng:** không sao, hệ thống vẫn chạy đủ luồng. Lisa sẽ gửi
đoạn tin đã soạn + link `zalo.me/<oa_id>` vào chat để user copy-paste. Mất độ mượt,
không mất luồng.

---

## Bước 6 — Chạy thử full flow (15 phút)

Nhắn lần lượt vào nhóm có bot, kiểm tra từng cái:

| # | Nhắn gì | Kỳ vọng |
|---|---|---|
| 1 | "chào bạn" | Lisa giới thiệu, có "đang soạn tin…" trước đó |
| 2 | "nhóm mình đi Đà Nẵng 12–14/8, 6 người, 3tr/người" | Hỏi lại cho đủ → `create_trip` |
| 3 | "lên lịch trình giúp mình" | Nói "để mình research chút nha" rồi **~60s sau tự nhắn** lịch trình |
| 4 | "tìm chỗ ở gần biển" | Ra 3 OA + link handoff |
| 5 | *gửi ảnh hoá đơn* | Đọc đúng tổng tiền → ghi chi phí |
| 6 | *gửi ảnh phong cảnh* | Vào album, có caption |
| 7 | "nhắc mình 7h sáng mai check-in" | Đặt reminder → **verify bằng cách sửa `fire_at` trong DB về 1 phút sau** |
| 8 | "chia tiền" | Bảng ai nợ ai, số giao dịch tối thiểu |
| 9 | "tổng kết chuyến đi" | ~60s sau gửi link `/trip/<id>/` |
| 10 | Đợi >10 phút rồi nhắn lại | Lisa nhớ sở thích nhóm (reflection đã chạy) |

Kiểm tra reminder mà không phải chờ tới sáng:

```bash
docker compose exec postgres psql -U lisa -d lisa \
  -c "UPDATE reminders SET fire_at = now() + interval '30 seconds' WHERE sent = false;"
```

---

## Khi hỏng thì làm gì

| Triệu chứng | Nguyên nhân thường gặp | Xử lý |
|---|---|---|
| Nhắn bot không thấy gì trong log | `secret_token` lệch | Gọi lại `setWebhook` với đúng secret trong `.env` |
| `curl https://.../api/health` fail nhưng `127.0.0.1:3000` ok | nginx conf | `sudo nginx -t`, xem `/var/log/nginx/error.log` |
| Cert invalid khi Zalo gọi webhook | Dùng subdomain 2 cấp | Domain **phải** là `zah19-team35.123c.vn` |
| Reminder lệch giờ | Timezone | `timedatectl set-timezone Asia/Ho_Chi_Minh` rồi `docker compose restart` |
| Ảnh gửi ra không hiện | `PUBLIC_BASE_URL` sai hoặc `/media/` chưa serve | `curl -I https://zah19-team35.123c.vn/media/<file>` |
| Lisa trả lời chậm >10s | web_search chạy trong hot path | Bình thường nếu có tra cứu; nếu mọi lượt đều chậm, xem log tool |
| Job kẹt `running` | Worker chết giữa chừng | Tự thu hồi sau 5 phút; muốn ngay: `UPDATE jobs SET status='pending' WHERE status='running'` |

**Rollback nginx** (nếu lỡ làm hỏng):

```bash
sudo rm /etc/nginx/conf.d/lisa.conf && sudo nginx -t && sudo systemctl reload nginx
```

**Xem log:**

```bash
docker compose logs -f --tail 100 api
docker compose exec postgres psql -U lisa -d lisa -c \
  "SELECT id,kind,status,attempts,left(last_error,80) FROM jobs ORDER BY id DESC LIMIT 20;"
```

---

## Dọn dẹp còn nợ

Hai thư mục sau không còn dùng (đã bỏ OpenClaw và Caddy), xoá khi rảnh tay:

```bash
git rm -r --cached infra/openclaw infra/Caddyfile
rm -rf infra/openclaw infra/openclaw-local infra/Caddyfile
```
