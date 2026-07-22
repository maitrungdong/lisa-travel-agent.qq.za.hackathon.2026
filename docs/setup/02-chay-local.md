# Chạy local

Yêu cầu: Node ≥ 20, Docker (cho Postgres).

```bash
# (từ root của repo lisa-travel-agent)
corepack enable
pnpm install

# DB local
docker run -d --name lisa-pg -e POSTGRES_USER=lisa -e POSTGRES_PASSWORD=lisa \
  -e POSTGRES_DB=lisa -p 5432:5432 postgres:16-alpine
pnpm db:push                      # tạo schema từ apps/api/src/db/schema.ts

# API
cp apps/api/.env.example apps/api/.env
pnpm dev:api                      # http://localhost:3000/health

# Mini app (chạy trình duyệt thường được — zmp-sdk tự fallback ngoài Zalo)
pnpm dev:miniapp                  # http://localhost:5173
```

## Kiểm tra như CI

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Lệnh hay dùng

| Lệnh | Tác dụng |
|---|---|
| `pnpm db:generate` | Sinh file migration SQL từ schema (commit vào `apps/api/drizzle/`) |
| `pnpm db:push` | Áp schema thẳng vào DB (nhanh, dùng cho dev/hackathon) |
| `pnpm test -- --coverage` | Test + coverage (CI upload thư mục `coverage/`) |
| `pnpm --filter api build` / `--filter miniapp build` | Build riêng từng app |

## Giả lập Lisa ghi dữ liệu (không cần bot)

```bash
curl -X POST localhost:3000/trips -H 'Content-Type: application/json' \
  -H 'x-api-key: change-me' \
  -d '{"name":"Đà Lạt cuối tuần","destination":"Đà Lạt","startDate":"2026-08-01","endDate":"2026-08-03"}'
```

(`AGENT_API_KEY` chưa set trong `.env` → guard không chặn; set rồi thì header phải khớp.)
