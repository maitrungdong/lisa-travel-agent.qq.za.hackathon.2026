# Tạo tài nguyên Zalo & API key (làm 1 lần)

## 1. Bot Zalo cho Lisa

1. Vào [bot.zaloplatforms.com](https://bot.zaloplatforms.com), đăng nhập, tạo bot.
2. Lấy **bot token** dạng `numeric_id:secret` (với Marketplace bot, token runtime có thể nằm trong welcome message của bot).
3. Trong settings bot: bật cho phép thêm vào nhóm. Nếu không add được bot vào nhóm → hạn chế phía platform, thử loại bot khác.
4. Token này đặt vào `ZALO_BOT_TOKEN` trong `/opt/lisa/.env` trên VPS (OpenClaw đọc env này cho account default).

Hành vi mặc định đã cấu hình trong `infra/openclaw/openclaw.json`:
- DM: `dmPolicy: pairing` — người lạ nhắn sẽ nhận pairing code, duyệt bằng `openclaw pairing approve zalo <CODE>`.
- Group: `groupPolicy: open` — ai trong nhóm cũng gọi được Lisa qua @mention.

## 2. Zalo Mini App

1. Vào [developers.zalo.me](https://developers.zalo.me) → tạo Mini App → lấy `APP_ID`.
2. Lấy `ZMP_TOKEN` (JWT, **có hạn**): Công cụ → API Explorer → Lấy Access Token.
3. Hai giá trị này đặt vào secrets `ZALO_APP_ID` / `ZMP_TOKEN` của cả 2 Environments (`development`, `production`) (xem `04-vps-va-ci-cd.md`).
4. Token hết hạn → workflow `zmp-token-health.yml` tự mở issue nhắc rotate hàng tuần.

Chi tiết cơ chế zmp-cli/token/version status: [`05-ci-cd-zalo-mini-app.md`](./05-ci-cd-zalo-mini-app.md).

## 3. Anthropic API key

Tạo tại console.anthropic.com → đặt vào `ANTHROPIC_API_KEY` trong `/opt/lisa/.env` (model cho agent Lisa).
