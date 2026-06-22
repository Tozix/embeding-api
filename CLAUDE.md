# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Статус репозитория:** greenfield. Сейчас в репозитории только `.gitignore` и `.vscode/`.
> Архитектура и команды ниже — это **целевые конвенции**, по которым ведётся скаффолдинг.
> Когда код появится, поддерживай этот файл в актуальном состоянии.

---

## ПРАВИЛО 1 — context7 (ОБЯЗАТЕЛЬНО)

**Перед использованием любой внешней библиотеки сверяйся с актуальной документацией через context7.**
Не полагайся на версии и API «по памяти» — стек выбран «самых последних версий», а они меняются.

Готовые Context7-ID этого проекта:
- NestJS → `/nestjs/docs.nestjs.com` (актуально: **v11**)
- Prisma → `/prisma/prisma` (актуально: **v7**)
- Zod → `/colinhacks/zod` (актуально: **v4**)
- Waku → `/wakujs/waku` (React-фреймворк; **не** путать с p2p-протоколом `/waku-org/js-waku`)

## ПРАВИЛО 2 — ЖЁСТКОЕ ПРАВИЛО ОБЩЕНИЯ (ОБЯЗАТЕЛЬНО)

**Задавай уточняющие вопросы на русском языке с подробным объяснением каждого варианта с указанием, что рекомендуешь!**

- Любой уточняющий вопрос (через `AskUserQuestion` или текстом) — **только на русском**.
- Для **каждого** варианта давай развёрнутое объяснение: суть, плюсы/минусы, последствия выбора.
- **Явно указывай, какой вариант рекомендуешь** и почему (рекомендованный — первым, с пометкой «(рекомендую)»).
- Это правило приоритетно и распространяется на все взаимодействия в этом репозитории.

---

## Что это за проект

OpenAI-совместимый API-шлюз к **Ollama** для эмбеддингов и других локальных моделей, плюс
полноценный сервис управления: регистрация пользователей, супер-админ, выпуск и модерация API-ключей.

Ключевые бизнес-правила (определяют почти всю логику авторизации):
- **API-ключ не работает, пока его не одобрит супер-админ.** Пользователь создаёт ключ → статус `pending`
  → супер-админ переводит в `approved` → только тогда ключ проходит через guard на `/v1/*`.
- **Супер-админ** управляет пользователями (CRUD, блокировка), выпускает ключи для пользователей,
  одобряет/отзывает ключи и управляет тем, какие модели Ollama доступны (глобально и по ключу/пользователю).
- Супер-админ **сидится из ENV** при первом старте (`SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`), не через UI.

## Стек

- **Рантайм и пакетный менеджер:** Bun (`bun install`, `bun run`). Node не используется для запуска.
- **Монорепо:** Turborepo поверх bun-воркспейсов.
- **API:** NestJS v11 (на Bun).
- **Фронтенд:** Waku (React server components) — современный дизайн; UI ведётся через скилл `/impeccable`.
- **Валидация:** Zod v4 — общие схемы переиспользуются бэком и фронтом из `packages/schemas`.
- **БД:** PostgreSQL + Prisma v7 (схема в `apps/api/prisma/schema.prisma`).
- **Очередь:** BullMQ + Redis (`apps/api/src/queue/`) — контроль конкуренции инференса на CPU-only + метрики.
  Bun крашится на нативном `msgpackr-extract` — отключён через `bunfig.toml` preload + ENV (см. memory `bun-bullmq-msgpackr`).
- **Деплой:** всё в контейнерах через docker-compose (postgres, redis, ollama, api); **nginx на хост-машине** проксирует в API.

## Структура монорепо (целевая)

```
apps/
  api/        # NestJS: OpenAI-совместимый слой (/v1/*) + auth + admin. Здесь же prisma/
  web/        # Waku-фронтенд (кабинет пользователя + админка)
packages/
  schemas/    # Zod-схемы + выведенные TS-типы — единственный источник правды для DTO/контрактов
  config/     # общие tsconfig / eslint / prettier
infra/
  docker/     # Dockerfile'ы, docker-compose.yml (postgres, redis, ollama, api)
  nginx/      # пример конфига для хостового nginx
```

## Архитектура (большая картина)

**Две независимые схемы авторизации в API — это центральный момент, держи их раздельно:**
1. `JwtAuthGuard` — для веб/админ-маршрутов (логин в кабинет/админку). JWT **access + refresh**;
   refresh — в httpOnly cookie. Роли: `USER`, `SUPERADMIN`.
2. `ApiKeyGuard` — для OpenAI-маршрутов `/v1/*`. Проверяет `Authorization: Bearer <key>`:
   ключ существует, `status === 'approved'`, не отозван, пользователь активен, запрошенная модель разрешена.
   Любой провал → ответ в OpenAI-формате ошибки.

**OpenAI-совместимый слой `/v1/*` (реализован):** `POST /v1/embeddings`, `POST /v1/chat/completions`
(non-stream + SSE-стриминг в формате OpenAI `delta`), `GET /v1/models`, `GET /v1/models/:model`.
Запросы/ответы валидируются Zod-схемами из `packages/schemas` (контракт = OpenAI SDK). Те же схемы импортирует фронт.

**Поток инференса идёт через очередь, а не напрямую в Ollama** (важно):
`OpenAiService` (резолв модели + валидация + auth — ДО очереди) → `InferenceService` (BullMQ, `apps/api/src/queue/`)
→ воркер-процессор вызывает `OllamaService` → результат назад. Зачем: Ollama на CPU-only тянет одну тяжёлую
задачу за раз. Две очереди с разной конкуренцией: `chat` (CHAT_CONCURRENCY, по умолч. 1 — строгая
сериализация) и `embeddings` (EMBED_CONCURRENCY, по умолч. 3). Стриминг идёт через in-process мост
`StreamHub`: воркер пишет сырые чанки Ollama, HTTP-обработчик читает и маппит в OpenAI-формат; обрыв клиента
прерывает генерацию (`Channel.abort`). HTTP-статус ошибок сохраняется через границу очереди сериализацией
конверта (`queue/queue-error.ts`) — иначе BullMQ теряет его (станет 500 вместо 502).

**Аналитика/мониторинг (`apps/api/src/usage/`):** воркер на каждый вызов пишет `UsageRecord` (пользователь,
ключ, модель, токены, латентность, ожидание в очереди, статус) и публикует live-событие в `AnalyticsLive`.
Эндпоинты (только SUPERADMIN): `/admin/analytics/{summary,timeseries,top,queues}` + `/admin/analytics/live`
(SSE; фронт читает fetch-стримом с Bearer, т.к. браузерный EventSource не шлёт заголовки).

**Ollama** — отдельный сервис в docker-compose с volume для весов моделей; API ходит к нему по адресу
`OLLAMA_BASE_URL=http://ollama:11434` внутри сети compose. Для GPU нужен nvidia-container-toolkit на хосте.

## Команды

Все команды — через Bun/Turbo из корня репо.

```bash
bun install                 # установить зависимости всех воркспейсов
bun run dev                 # = turbo run dev — поднять все apps в watch (api + web)
turbo run build             # собрать всё
turbo run lint              # линт всех воркспейсов
turbo run test              # тесты всех воркспейсов

# Запуск одного приложения / одной задачи:
turbo run dev --filter=api
turbo run dev --filter=web
```

> **Грабли Bun (важно):** API запускать ТОЛЬКО с cwd=`apps/api` (так делают и `turbo`, и Docker `WORKDIR`).
> Bun ищет `tsconfig.json` относительно cwd, а не пофайлово; в корне его нет → `emitDecoratorMetadata`
> выключается → NestJS-DI инжектит `undefined`. Симптом `TypeError ... config.get` на старте = неверный cwd,
> а не баг кода. **Не** запускать `bun run apps/api/src/main.ts` из корня репо.

**Тесты — нативный `bun test`.** Unit (без инфры) и e2e (реальные Postgres+Redis):

```bash
turbo run test                  # unit во всех воркспейсах (apps/api/test/unit, packages/schemas/test)
bun run test:e2e                # e2e: scripts/test-e2e.sh поднимает Postgres+Redis, мигрирует, гоняет apps/api/test/e2e
cd apps/api && bun test test/unit/ms.test.ts        # один файл
cd apps/api && bun test -t "название теста"          # по имени
```
e2e бутает реальное Nest-приложение (NestFactory) против одноразовых контейнеров и проверяет
критичные флоу: auth+ротация+reuse-detection, гейтинг ключа PENDING→APPROVED, /v1/*, admin, очередь→502.

**Prisma (из `apps/api`):**

```bash
bunx prisma migrate dev --name <change>   # создать+применить миграцию (dev)
bunx prisma migrate deploy                # применить миграции (prod/CI)
bunx prisma generate                      # перегенерировать клиент
bunx prisma studio                        # GUI к БД
bun run prisma/seed.ts                    # сид супер-админа из ENV
```

**Контейнеры (одна команда из корня):**

```bash
docker compose up -d --build   # postgres + redis + ollama + api + web (compose в корне)
docker compose logs -f api
```
Dockerfile'ы — в `infra/docker/` (api: Bun; web: сборка Bun → сервинг Node). nginx — на хосте.

## Конвенции

- **Источник правды для контрактов — `packages/schemas` (Zod).** DTO в Nest и типы во фронте выводятся из них
  (`z.infer`). Не описывай одну и ту же форму данных в двух местах.
- **Совместимость с OpenAI — приоритет над удобством.** Формы запросов/ответов и ошибок `/v1/*` должны
  совпадать с тем, что ждёт официальный OpenAI SDK (включая SSE-стриминг chat-комплишенов).
- **Секреты и конфиг — только из ENV** (`SUPERADMIN_*`, `JWT_*`, `DATABASE_URL`, `OLLAMA_BASE_URL`).
  Супер-админ и любые стартовые данные создаются сид-скриптом, а не вручную в БД.
- **Prisma 7 — грабли (важно):** URL подключения **НЕ** хранится в `schema.prisma`. Миграции читают
  его из [apps/api/prisma.config.ts](apps/api/prisma.config.ts) (`env('DATABASE_URL')`), а runtime
  `PrismaClient` подключается через **driver adapter** `@prisma/adapter-pg` (см.
  [prisma.service.ts](apps/api/src/prisma/prisma.service.ts) и `prisma/seed.ts`). Сгенерированный клиент
  лежит в `apps/api/src/generated/prisma/` (gitignored), реэкспорт — через `src/prisma/client.ts`.
  Перед `dev`/`build`/тестами обязателен `bun run db:generate`.
- **Фронтенд `apps/web` (Waku/RSC) — под Node, не Bun.** Дизайн-система: [DESIGN.md](DESIGN.md) +
  `apps/web/src/styles.css` (тёплый графит + янтарь). Клиентский SPA: `lib/auth.tsx` (access в памяти,
  refresh-cookie), `lib/api.ts` (Bearer + авто-refresh + SSE через fetch). `waku build` под Bun проходит, но
  dev-сервер требует Node (`react-server` condition) — `bun run dev`/turbo идут через node-shebang бинаря `waku`
  (ок); НЕ `bunx waku`. Кросс-порт dev: `WAKU_PUBLIC_API_URL`. См. memory `waku-rsc-node-not-bun`.
- **nginx — на хосте, не в compose.** Контейнер API слушает порт; терминирование TLS и роутинг — задача хостового nginx.
