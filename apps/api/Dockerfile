# Context là apps/api (khớp workflow CI/CD) → tự cài dependency bằng npm,
# không phụ thuộc pnpm workspace ở root.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json && npm prune --omit=dev

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY drizzle.config.ts ./
COPY src/db/schema.ts ./src/db/schema.ts
# tsc không copy file .sql sang dist → phải copy tay. App đọc nó lúc boot để
# đồng bộ schema (xem DatabaseModule.onApplicationBootstrap).
COPY src/db/bootstrap.sql ./dist/db/bootstrap.sql

# COPY GIỮ NGUYÊN mode của file trên máy build. Nếu cây source ở đó là 0600
# (umask chặt, hoặc thư mục có ACL riêng), file vào image cũng 0600 và thuộc
# root — trong khi stage này chạy `USER node`. Hậu quả: app chết ngay lúc boot
# với `EACCES ... bootstrap.sql`, và vì DatabaseModule cố tình `throw` nên
# container crash-loop chứ không chạy què.
#
# CI không bao giờ dính (actions/checkout ghi 0644) → lỗi chỉ xuất hiện khi
# build từ máy dev, đúng lúc đang vội. Ép quyền đọc để build ở đâu cũng như nhau.
# Chỉ đụng dist/src/config: node_modules đã 0644 sẵn từ stage build, chmod -R
# lên nó chỉ tổ đẻ thêm một layer nặng vô ích.
RUN chmod -R a+rX /app/dist /app/src /app/drizzle.config.ts

EXPOSE 3000
USER node
CMD ["node", "dist/main.js"]
