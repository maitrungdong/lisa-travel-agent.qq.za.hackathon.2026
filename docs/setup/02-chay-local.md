# Chạy local

Yêu cầu: Node ≥ 20, Docker (cho Postgres).

```bash
# (từ root của repo zino-travel-agent)
corepack enable
pnpm install

# DB local
docker run -d --name zino-pg -e POSTGRES_USER=zino -e POSTGRES_PASSWORD=zino \
  -e POSTGRES_DB=zino -p 5432:5432 postgres:16-alpine
pnpm db:push                      # tạo schema từ apps/api/src/db/schema.ts

# API
cp apps/api/.env.example apps/api/.env
pnpm dev:api                      # http://localhost:3000/health

# Dữ liệu mẫu để test giao diện (1 chuyến đủ lịch trình/chi phí/ảnh/ghi chú)
pnpm seed:demo
pnpm seed:partners                # danh bạ OA đối tác

# Mini app (chạy trình duyệt thường được — zmp-sdk tự fallback ngoài Zalo)
echo 'VITE_API_BASE_URL=http://localhost:3000' > apps/miniapp/.env.local
pnpm dev:miniapp                  # http://localhost:5173
```

`pnpm seed:demo` chạy lại được nhiều lần — nó xoá chuyến demo cũ rồi tạo lại,
và neo ngày vào **hôm nay** để đếm ngược / tab ngày luôn có ngày chưa qua.

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

## Giả lập Zino ghi dữ liệu (không cần bot)

```bash
curl -X POST localhost:3000/trips -H 'Content-Type: application/json' \
  -H 'x-api-key: change-me' \
  -d '{"name":"Đà Lạt cuối tuần","destination":"Đà Lạt","startDate":"2026-08-01","endDate":"2026-08-03"}'
```

(`AGENT_API_KEY` chưa set trong `.env` → guard không chặn; set rồi thì header phải khớp.)
