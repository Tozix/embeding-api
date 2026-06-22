#!/usr/bin/env bash
# E2e: поднимает одноразовые Postgres+Redis, мигрирует, прогоняет bun test, убирает за собой.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PG=embeding-e2e-pg
RD=embeding-e2e-redis
PG_PORT=5434
RD_PORT=6380

cleanup() { docker rm -f "$PG" "$RD" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "→ поднимаю postgres + redis…"
docker run -d --name "$PG" -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e \
  -p "127.0.0.1:${PG_PORT}:5432" postgres:17-alpine >/dev/null
docker run -d --name "$RD" -p "127.0.0.1:${RD_PORT}:6379" redis:7-alpine >/dev/null

for _ in $(seq 1 30); do docker exec "$PG" pg_isready -U e2e >/dev/null 2>&1 && break; sleep 1; done
for _ in $(seq 1 30); do docker exec "$RD" redis-cli ping >/dev/null 2>&1 && break; sleep 1; done

export DATABASE_URL="postgresql://e2e:e2e@127.0.0.1:${PG_PORT}/e2e?schema=public"
echo "→ миграции…"
( cd "$ROOT" && bunx prisma migrate deploy --config apps/api/prisma.config.ts )

# ENV для приложения (Ollama указываем в заведомо мёртвый порт — проверяем путь 502)
export REDIS_HOST=127.0.0.1 REDIS_PORT="$RD_PORT"
export OLLAMA_BASE_URL="http://127.0.0.1:59999" OLLAMA_TIMEOUT_MS=3000
export JWT_ACCESS_SECRET=e2e-access-secret-0123456789
export JWT_REFRESH_SECRET=e2e-refresh-secret-0123456789
export APIKEY_HMAC_SECRET=e2e-apikey-hmac-secret-0123456789-xyz
export SUPERADMIN_EMAIL=admin@e2e.local SUPERADMIN_PASSWORD=admin-password-123
export NODE_ENV=test MSGPACKR_NATIVE_ACCELERATION_DISABLED=true
export CHAT_CONCURRENCY=1 EMBED_CONCURRENCY=2

echo "→ bun test test/e2e…"
cd "$ROOT/apps/api" && bun test test/e2e
