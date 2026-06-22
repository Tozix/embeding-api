# Waku-фронтенд. Сборка под Bun (работает), прод-сервинг под Node
# (Waku RSC требует react-server condition, который даёт Node). Контекст = корень репо.

# --- build: установка + waku build под Bun ---
FROM oven/bun:1.3-alpine AS build
WORKDIR /app
# URL API, как его видит браузер; запекается в клиент на этапе сборки (пусто = same-origin).
ARG WAKU_PUBLIC_API_URL=""
ENV WAKU_PUBLIC_API_URL=${WAKU_PUBLIC_API_URL}
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/schemas/package.json packages/schemas/package.json
RUN bun install --frozen-lockfile
COPY . .
RUN cd apps/web && bunx waku build

# --- runner: сервинг под Node ---
FROM node:22-alpine AS runner
WORKDIR /app/apps/web
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/apps/web /app/apps/web
EXPOSE 8080
# `waku build` генерирует штатный Node-сервер dist/serve-node.js (слушает PORT, 0.0.0.0).
# Запускаем его напрямую — не через bin waku, т.к. bun-раскладка node_modules не даёт
# /app/node_modules/.bin/waku под Node.
CMD ["node", "dist/serve-node.js"]
