# Образ NestJS API на Bun (монорепо Turborepo). Контекст сборки = корень репо.
FROM oven/bun:1.3-alpine AS base
WORKDIR /app

# --- deps: установка зависимостей воркспейсов (кэшируемый слой) ---
FROM base AS deps
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/schemas/package.json packages/schemas/package.json
RUN bun install --frozen-lockfile

# --- runner: код + генерация Prisma-клиента ---
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma.config.ts вычисляет env('DATABASE_URL') при загрузке → нужен фиктивный URL даже для generate
# (подключение к БД не выполняется).
RUN cd apps/api && DATABASE_URL="postgresql://build:build@localhost:5432/build" bunx prisma generate
EXPOSE 3000
WORKDIR /app/apps/api
# применяем миграции, сидим супер-админа (идемпотентно) и стартуем
CMD ["sh", "-c", "bunx prisma migrate deploy && bun run prisma/seed.ts && bun run src/main.ts"]
