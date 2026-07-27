# Build & deploy Zalo Mini App — từ đầu

> Chạy **trên máy dev**, không phải VPS. Mini App được đẩy lên **CDN của Zalo**,
> nó không nằm trên VPS. VPS chỉ chạy API mà Mini App gọi vào.

```
Máy dev                Zalo CDN (h5.zdn.vn)          VPS
───────                ────────────────────          ───
vite build   ──push──► Mini App (file tĩnh)  ──gọi──► API :3000
  └─ www/                • itinerary                   /api/trips/...
                         • partners ⭐                  /api/partners
                         • expenses
                         • gallery
                         • handoff
```

---

## Điều kiện cần

| | Lấy ở đâu |
|---|---|
| Node ≥ 20 + pnpm | máy dev |
| `zmp-cli` | `npm install -g zmp-cli@4.0.3` |
| **`APP_ID`** | developers.zalo.me → Mini App của team → trang thông tin |
| **`ZMP_TOKEN`** | developers.zalo.me → Công cụ → API Explorer → Lấy Access Token |
| API đang chạy | URL công khai (domain BTC hoặc Cloudflare Tunnel) |

> ⚠️ **Chưa có Mini App trên developers.zalo.me?** Phải đăng ký app trước — đây là
> phần mất thời gian nhất và không tự động hoá được. Nếu không kịp, **bỏ Mini App
> khỏi scope**: Lisa vẫn chạy đủ 3 pha qua chat, chỉ mất phần `openChat` điền sẵn.

---

## Bước 1 — Trỏ Mini App về đúng API

`VITE_API_BASE_URL` bị **inline vào bundle lúc build**. Sai giá trị này thì app
gọi nhầm server và không có cách sửa nào ngoài build lại.

```bash
cd projects/lisa-travel-agent

# Lấy thẳng từ VPS cho khỏi gõ nhầm
BASE=$(ssh -p 2222 zah19-team35@118.102.2.135 \
  "grep '^PUBLIC_BASE_URL=' /opt/lisa/.env | cut -d= -f2-")
echo "BASE = $BASE"

# Ghi vào .env của miniapp — giữ nguyên các dòng khác nếu file đã tồn tại
touch apps/miniapp/.env
grep -v '^VITE_API_BASE_URL=' apps/miniapp/.env > /tmp/mini.env || true
echo "VITE_API_BASE_URL=$BASE/api" >> /tmp/mini.env
mv /tmp/mini.env apps/miniapp/.env

cat apps/miniapp/.env
```

Kiểm tra API sống trước khi build — build xong mới phát hiện sai thì mất thời gian:

```bash
curl -s "$BASE/api/health" && echo
```

## Bước 2 — Build

```bash
pnpm install
pnpm --filter miniapp build
ls -la apps/miniapp/www/
```

Kỳ vọng: `www/index.html` + `www/assets/*.js` + `*.css`. Bundle nên dưới ~500 kB.

## Bước 3 — Deploy lên Zalo

```bash
cd apps/miniapp

ZMP_APP_ID=<app_id> \
ZMP_TOKEN=<token> \
ZMP_DESCRIPTION="Lisa hackathon demo" \
node ../../scripts/zmp-deploy.mjs
```

Script tự thêm `--passive --existing`: **passive** = không hỏi tương tác (dùng được
trong CI), **existing** = dùng thư mục `www/` bạn vừa build bằng Vite thay vì để
zmp build lại.

Không cần `zmp login` — lệnh đó bắt quét QR, không chạy headless được. Script ghi
thẳng credential vào `.env` (và giữ nguyên các biến `VITE_*` đã có).

**Version status:**

| Giá trị | Nghĩa |
|---|---|
| `development` (mặc định) | Không hiện trong Quản lý phiên bản, bị ghi đè mỗi lần deploy |
| `testing` | Được đánh số, lưu lại, gửi xét duyệt được. Đặt `ZMP_VERSION_STATUS=testing` |

`zmp deploy` **không** publish lên production — publish phải qua xét duyệt của Zalo.
Cho hackathon thì `development` là đủ.

## Bước 4 — Mở thử

```
https://zalo.me/s/<APP_ID>/
```

Kiểm tra lần lượt:

| Màn | Kỳ vọng |
|---|---|
| Trang chủ | Hiện chuyến đi. Trống → `VITE_API_BASE_URL` sai hoặc chưa có chuyến |
| Đối tác | Danh sách OA. Trống → chưa seed `partner_oas` |
| Handoff | Bấm "Nhờ Lisa soạn tin" → hiện tin đã soạn → **"Mở chat"** mở đúng chat OA |
| Chi phí | Tổng chi + ai nợ ai |
| Kỷ niệm | Ảnh Lisa gom từ nhóm |

⚠️ **`openChat` chỉ chạy trong app Zalo thật.** Mở trên trình duyệt desktop sẽ
báo "chức năng này chỉ chạy trong ứng dụng Zalo" và hiện nút Copy + link dự phòng.
Test bằng điện thoại.

---

## Khi hỏng

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| `Command "zmp" not found` | Chưa cài CLI | `npm install -g zmp-cli@4.0.3` |
| `Token Invalid` / `permission_denied` | Token hết hạn hoặc sai app | Lấy token mới ở API Explorer |
| `Thiếu mô tả phiên bản` | Zalo bắt buộc trường này | Thêm `ZMP_DESCRIPTION="..."` |
| `www không tồn tại hoặc rỗng` | Chưa build | Chạy bước 2 |
| App mở được nhưng không có dữ liệu | `VITE_API_BASE_URL` sai | Mở DevTools xem request đi đâu, sửa rồi **build lại** |
| CORS bị chặn | API chưa cho phép origin | Thêm `https://h5.zdn.vn` vào `CORS_ORIGINS` trong `/opt/lisa/.env` |
| Đổi URL API mà app vẫn gọi URL cũ | Bundle đã inline URL cũ | Build lại — sửa `.env` không đủ |

**Bẫy hay gặp nhất:** đổi `VITE_API_BASE_URL` rồi deploy luôn mà quên build lại.
Bundle vẫn mang URL cũ. Luôn theo thứ tự: **sửa `.env` → build → deploy**.
