# Đăng nhập Zalo & liên kết thành viên — ĐANG TẠM TẮT

> Trạng thái: code xong, có test, **tắt bằng cờ**. Chờ kích hoạt Zalo App.

## Vì sao tắt

`getAccessToken()` trả về:

```
code -1401: Login failed: Zalo app has not been activated
```

Zalo App cha (**Lisa Travel Agent**) chưa được kích hoạt trong console, nên mọi
API cần danh tính người dùng đều bị chặn. Đây là thủ tục hành chính, không phải
lỗi code — popup xin quyền vẫn hiện và user vẫn bấm "Cho phép" được, nhưng
`getAccessToken` vẫn từ chối sau đó.

## Bật lại — 3 bước

1. `developers.zalo.me` → đăng nhập bằng tài khoản **Admin** của app →
   **Lisa Travel Agent** → **Cài đặt** → **Thông tin ứng dụng**: điền đủ số điện
   thoại, email, **icon ứng dụng** → Lưu → nút **Kích hoạt ứng dụng** mới hiện.
   (Thiếu icon là lý do nút bị ẩn hay gặp nhất.)

2. Kiểm server đã đủ cấu hình:

   ```bash
   curl -s https://zah-35.123c.vn/api/auth/status
   # {"configured":true,"missing":[]}
   ```

   Thiếu gì thì điền vào `/opt/zino/.env`: `ZALO_APP_SECRET` (bắt buộc),
   `SESSION_SECRET` (bỏ trống thì dùng `AGENT_API_KEY`).

3. Bật cờ rồi **build lại** Mini App:

   ```bash
   # apps/miniapp/.env
   VITE_AUTH_ENABLED=true
   ```

   ```bash
   bash scripts/deploy-miniapp.sh --testing -m "bat dang nhap"
   ```

   ⚠️ `VITE_*` được nhúng lúc build. Sửa `.env` mà không build lại là không có
   tác dụng gì, và không có lỗi nào báo.

## Luồng người dùng khi đã bật

```
Mở Mini App  →  banner "Liên kết tài khoản"  →  mã 6 số (hạn 5 phút)
Gõ trong nhóm Zalo:  @Zino 482913
Zino:  "Đã liên kết xong rồi nhé Đông 🎉"
App tự nhận sau ~3s  →  vào thẳng, từ đó không hỏi lại
```

## Vì sao phải có bước liên kết

Zalo Bot API và Zalo Mini App nhìn **cùng một con người dưới hai id khác
namespace**, và Zalo không có API nối:

| Nguồn | Ví dụ id |
|---|---|
| Bot webhook (`from.id`) | `e8580118d94d3013695c` |
| Mini App (theo Zalo App) | `3681046936240438345` |

Mã 6 số là cây cầu. Điểm mấu chốt về an toàn: **người gõ mã là người chứng minh
danh tính**, và `from.id` do webhook của Zalo khẳng định — không phải lời khai
của client.

## Những gì đã có sẵn trong code

| Phần | Vị trí |
|---|---|
| Verify access token + JWT phiên | `apps/api/src/auth/auth.service.ts`, `session.ts` |
| `/auth/zalo`, `/auth/device`, `/me`, `/me/trips` | `apps/api/src/auth/auth.controller.ts` |
| Bắt mã 6 số trong nhóm | `apps/api/src/zalo/zalo.controller.ts` → `tryRedeemLinkCode` |
| Bảng `app_users`, `link_codes`, `person_links` | `apps/api/src/db/bootstrap.sql` |
| Phiên + màn liên kết | `apps/miniapp/src/lib/session.ts`, `pages/link.tsx` |
| Unit test JWT + mã | `apps/api/src/auth/session.test.ts` (8 test) |

Backend **không bị tắt** — các endpoint `/auth/*` và `/me/*` vẫn sống, chỉ là
Mini App không gọi tới. Không ảnh hưởng gì tới `/trips/*` mà bot và trang tổng
kết đang dùng.

## Đường lui đã cài sẵn: phiên theo thiết bị

`/auth/device` cho phép chạy toàn bộ luồng liên kết mà không cần Zalo cấp access
token. Đánh đổi: id do client sinh, server không xác minh được — ai cầm điện
thoại đã liên kết thì thấy dữ liệu của người đó.

Đang **không dùng**. Nếu tới sát ngày demo mà app vẫn chưa kích hoạt được, bật
`VITE_AUTH_ENABLED=true` là nó tự rơi vào đường này.

## Việc còn lại sau khi bật

- [ ] Mọi người trong nhóm liên kết một lần (nếu từng liên kết bằng phiên thiết
      bị thì phải làm lại — danh tính chuyển sang id Zalo thật)
- [ ] Cân nhắc siết `/trips/*` theo membership. Hiện cố tình để mở vì bot và
      trang recap đang gọi; siết sớm là tự tạo rủi ro chết demo
- [ ] Đo `getContextAsync()` (màn `/debug`, bật bằng `VITE_DEBUG_UI=true`) —
      nếu id nhóm khớp `zaloChatId` thì bỏ được luôn bước gõ mã
- [ ] Xoá `apps/api/src/debug.controller.ts` — nó phơi id nhóm và tên thành viên
      ra public, không có auth
