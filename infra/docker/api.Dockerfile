# Образ NestJS API на Bun (монорепо Turborepo). Контекст сборки = корень репо.
# Одностадийно: bun install выполняется В ЭТОМ ЖЕ слое, где потом всё запускается, —
# иначе COPY node_modules между стейджами ломает симлинки bun и `bunx prisma` тянет
# свежую prisma (и не резолвит 'prisma/config'). Манифесты копируем первыми → install кэшируется.
FROM oven/bun:1.3-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/schemas/package.json packages/schemas/package.json
RUN bun install --frozen-lockfile

COPY . .
# Генерация клиента из КОРНЯ (находит локальный prisma). dummy DATABASE_URL — т.к. prisma.config.ts
# вычисляет env() при загрузке (к БД не подключаемся).
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    bunx prisma generate --config apps/api/prisma.config.ts

EXPOSE 3000
# миграции (из /app) → сид + старт из apps/api (cwd нужен для tsconfig decorators и bunfig preload)
CMD ["sh", "-c", "bunx prisma migrate deploy --config apps/api/prisma.config.ts && cd apps/api && bun run prisma/seed.ts && bun run src/main.ts"]
