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
EXPOSE 3000
USER node
CMD ["node", "dist/main.js"]
