# Setup — Lisa Travel Agent

Bộ tài liệu tham chiếu để dựng, chạy và deploy toàn bộ hệ thống **Lisa – Trợ lý du lịch**: Zalo bot (OpenClaw + Claude) + Zalo Mini App (React) + API (NestJS) + Postgres.

| File | Nội dung |
|---|---|
| [`01-kien-truc.md`](./01-kien-truc.md) | Kiến trúc, đính chính khái niệm (zClaw/OpenClaw/ClawBot), cấu trúc code |
| [`02-chay-local.md`](./02-chay-local.md) | Chạy dev local: DB, API, mini app, lệnh kiểm tra như CI |
| [`03-tai-nguyen-zalo.md`](./03-tai-nguyen-zalo.md) | Tạo bot Zalo, Mini App, API key — các bước làm 1 lần |
| [`04-vps-va-ci-cd.md`](./04-vps-va-ci-cd.md) | Bootstrap VPS, GitHub secrets, full flow CI/CD, checklist demo |
| [`05-ci-cd-zalo-mini-app.md`](./05-ci-cd-zalo-mini-app.md) | Deep-dive CI/CD Zalo Mini App: zmp-cli, token, version status (thiết kế chuẩn production) |

Đường tắt: mới clone repo → đọc `02`; chuẩn bị demo → checklist cuối `04`.
