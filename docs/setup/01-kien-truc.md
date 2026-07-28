# Kiến trúc & khái niệm

## Đính chính khái niệm

| Tên | Thực tế | Dùng trong dự án |
|---|---|---|
| "zClaw" | Project OpenClaw chạy trên ESP32, **không liên quan Zalo** | Không dùng |
| OpenClaw | [docs.openclaw.ai](https://docs.openclaw.ai) — AI agent gateway self-host, nối agent (Claude...) với 20+ kênh chat | ✅ Runtime của Zino |
| Kênh Zalo của OpenClaw | Plugin bundled `@openclaw/zalo` — bot chính thức tạo tại [bot.zaloplatforms.com](https://bot.zaloplatforms.com), **hỗ trợ group chat** (bot trả lời khi được @mention) | ✅ Kênh của Zino |
| Zalo ClawBot | Plugin `@zalo-platforms/openclaw-zaloclawbot` — bot cá nhân **chỉ nói chuyện với chủ bot** | ❌ Không dùng được cho nhóm |

## Sơ đồ

```
Nhóm Zalo ──@Zino──▶ Zalo Bot Platform ──long-polling──▶ OpenClaw gateway (VPS, Docker)
                                                              │  agent = Claude + persona AGENTS.md/SOUL.md
                                                              │  ghi dữ liệu qua HTTP + x-api-key
                                                              ▼
Mini App (Zalo CDN) ──HTTPS──▶ Caddy ──▶ API NestJS ──▶ Postgres (Docker volume)
```

## Cấu trúc code (``)

| Thư mục | Vai trò |
|---|---|
| `apps/miniapp` | React 19 + Vite + Tailwind 4 (shadcn-style tokens). Build ra `www/`, deploy bằng `zmp-cli`. 4 tab: Trang chủ / Lịch trình / Chi phí / Kỷ niệm |
| `apps/api` | NestJS + Drizzle + Postgres. Schema: `trips`, `members`, `events`, `expenses`, `activities`. Mini app đọc (mở); Zino ghi (header `x-api-key`) |
| `infra/` | docker-compose VPS: `postgres` + `api` + `openclaw` + `caddy` (auto-HTTPS). Persona Zino: `infra/openclaw/workspace/AGENTS.md` + `SOUL.md` |
| `scripts/` | `vps-bootstrap.sh` — chuẩn bị VPS trống |

Workflows nằm ở repo root `.github/workflows/` (CI, deploy miniapp/API/infra). Scripts CI dùng chung (`zmp-deploy.mjs`, `check-zmp-token.mjs`, `check-bundle-size.mjs`) ở repo root `scripts/`.

## Quyết định kỹ thuật chính

- **Group chat**: kênh `@openclaw/zalo` hỗ trợ group nhưng **bot chỉ trả lời khi được @mention** (không cấu hình được). Nếu platform không cho add bot vào nhóm → hạn chế phía Zalo, thử tạo bot khác.
- **Zino ghi dữ liệu qua API HTTP** thay vì truy cập DB trực tiếp — persona AGENTS.md dạy Zino gọi `POST /trips`, `/events`, `/expenses`, `/activities` với `x-api-key`. Đổi hành vi Zino = sửa AGENTS.md, push, workflow tự sync.
- **Mini app là static bundle** trên CDN Zalo → không có runtime env; mọi config inline lúc build (`VITE_*`), không được chứa secret.
- **Postgres tự host** trong compose (1 file quản hết, không phụ thuộc dịch vụ ngoài); migration bằng `drizzle-kit push` cho tốc độ hackathon.
- **Image API pin theo commit SHA** — rollback = re-run workflow ở commit cũ.
