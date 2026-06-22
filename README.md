# embeding-api

OpenAI-совместимый шлюз к [Ollama](https://ollama.com) для эмбеддингов и других локальных моделей,
с регистрацией пользователей, супер-админом и модерацией API-ключей.

> **Важно:** см. [CLAUDE.md](CLAUDE.md) — там зафиксированы архитектура, конвенции и два приоритетных
> правила репозитория (использование context7 и правило общения на русском).

## Стек

Bun + Turborepo · NestJS 11 · Waku · Zod 4 · Prisma 7 · PostgreSQL · Ollama · Docker.

## Структура

```
apps/
  api/        NestJS — OpenAI-совместимый API (/v1/*) + auth + админка. Prisma здесь.
  web/        Waku — фронтенд (дизайн ведётся через скилл /impeccable)
packages/
  schemas/    Общие Zod-схемы и типы (контракты OpenAI + auth)
infra/
  docker/     Dockerfile + docker-compose (ollama + postgres + api)
  nginx/      Пример конфига для хостового nginx
```

## Быстрый старт (локально)

```bash
cp .env.example .env          # заполнить секреты
bun install
bun run db:generate           # сгенерировать Prisma-клиент
bun run db:migrate            # применить миграции (нужен запущенный postgres)
bun run db:seed               # создать супер-админа из ENV
bun run dev                   # api + web в watch-режиме
```

## Запуск в контейнерах (одна команда из корня)

```bash
cp .env.example .env          # заполнить секреты
docker compose up -d --build  # postgres + redis + ollama + api + web
```

nginx живёт на **хост-машине** (не в compose) и проксирует на контейнеры:
`/` → web (`127.0.0.1:8080`), а `/v1`, `/auth`, `/admin`, `/keys` → api (`127.0.0.1:3000`).
Пример: [infra/nginx/embeding-api.conf](infra/nginx/embeding-api.conf). При доступе через
хостовый nginx (same-origin) оставьте `WAKU_PUBLIC_API_URL` пустым; для прямого доступа к web
задайте его в `.env` (напр. `http://localhost:3000`).

## Деплой на сервер

Полная пошаговая инструкция (Docker + хостовый nginx + TLS через certbot, домен
`llm.korateam.ru`) — в [DEPLOY.md](DEPLOY.md). Боевой конфиг nginx:
[infra/nginx/llm.korateam.ru.conf](infra/nginx/llm.korateam.ru.conf).

## Бизнес-правило про ключи

API-ключ, созданный пользователем, имеет статус `PENDING` и **не работает**, пока супер-админ
не переведёт его в `APPROVED`. Управление пользователями, ключами и моделями — за супер-админом.
