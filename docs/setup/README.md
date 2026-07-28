# Setup — Zino Travel Agent

Bộ tài liệu tham chiếu để dựng, chạy và deploy toàn bộ hệ thống **Zino – Trợ lý nhu cầu** (Zalo Intelligent Needs): Zalo bot (OpenClaw + Claude) + Zalo Mini App (React) + API (NestJS) + Postgres.

| File | Nội dung |
|---|---|
| [`01-kien-truc.md`](./01-kien-truc.md) | Kiến trúc, đính chính khái niệm (zClaw/OpenClaw/ClawBot), cấu trúc code |
| [`02-chay-local.md`](./02-chay-local.md) | Chạy dev local: DB, API, mini app, lệnh kiểm tra như CI |
| [`03-tai-nguyen-zalo.md`](./03-tai-nguyen-zalo.md) | Tạo bot Zalo, Mini App, API key — các bước làm 1 lần |
| [`04-vps-va-ci-cd.md`](./04-vps-va-ci-cd.md) | Bootstrap VPS, GitHub secrets, full flow CI/CD, checklist demo |
| [`05-ci-cd-zalo-mini-app.md`](./05-ci-cd-zalo-mini-app.md) | Deep-dive CI/CD Zalo Mini App: zmp-cli, token, version status (thiết kế chuẩn production) |
| [`06-verify-vps.md`](./06-verify-vps.md) | Vừa nhận VPS từ BTC: recon + verify đủ điều kiện trước khi bootstrap |
| [`10-doi-sang-bot-zino.md`](./10-doi-sang-bot-zino.md) | **Đổi Lisa → Zino**: bot token mới, rename repo/VPS/DB, ghép lại pairing |

Đường tắt: mới clone repo → đọc `02`; vừa được cấp VPS → `06` rồi `04`; chuẩn bị demo → checklist cuối `04`.
