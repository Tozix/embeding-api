# Деплой на сервер (llm.korateam.ru)

Полная инструкция: один `docker compose` поднимает весь стек (postgres + redis + ollama + api + web),
а хостовый **nginx** терминирует TLS и проксирует на контейнеры. CPU-only, без GPU.

Схема: `браузер → nginx (443, TLS) → / → web-контейнер (8080)` и `/v1·/auth·/admin·/keys·/health → api-контейнер (3000)`.
Контейнеры слушают только `127.0.0.1` — наружу торчит лишь nginx.

---

## 0. Требования к серверу

- Ubuntu/Debian (или любой Linux с systemd).
- **Docker Engine + плагин Compose v2** (`docker compose version` ≥ 2).
- **nginx** на хосте (`apt install nginx`).
- **certbot** (`apt install certbot` — сертификаты получаешь сам).
- DNS: A/AAAA-запись `llm.korateam.ru` → IP сервера.
- Открыты порты **80** и **443** (firewall). Порты 3000/8080/5432/6379/11434 наружу НЕ открывать.
- Память: для CPU-инференса желательно много RAM (у тебя ~100 ГБ — с запасом).

```bash
# проверка
docker compose version
nginx -v
certbot --version
```

---

## 1. Клонирование

```bash
sudo mkdir -p /opt && cd /opt
git clone git@github.com:Tozix/embeding-api.git
cd embeding-api
```

---

## 2. Конфигурация `.env`

```bash
cp .env.example .env
```

Сгенерируй секреты и впиши их в `.env`:

```bash
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "APIKEY_HMAC_SECRET=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
```

Минимально нужно задать в `.env` (остальное — дефолты):

```ini
NODE_ENV=production
POSTGRES_PASSWORD=<сгенерированный>
JWT_ACCESS_SECRET=<сгенерированный 32+>
JWT_REFRESH_SECRET=<сгенерированный 32+>
APIKEY_HMAC_SECRET=<сгенерированный 32+>

# супер-админ создаётся при первом старте
SUPERADMIN_EMAIL=admin@korateam.ru
SUPERADMIN_PASSWORD=<надёжный пароль>

# ВАЖНО для работы за nginx (same-origin):
WEB_ORIGIN=https://llm.korateam.ru
WAKU_PUBLIC_API_URL=          # ПУСТО — фронт ходит на same-origin, nginx роутит /v1,/auth,…

# CPU-инференс: чат строго по одному, эмбеддинги — по числу свободных ядер (пример: 4)
CHAT_CONCURRENCY=1
EMBED_CONCURRENCY=4
```

> Порты `API_PORT`/`WEB_PORT`/… НЕ задавай — останутся дефолтные (3000/8080) и слушают только localhost.
> Если задашь — синхронно поправь `upstream` в nginx-конфиге.
>
> `WAKU_PUBLIC_API_URL` **должен быть пустым** — он запекается в фронт на сборке; пустой = same-origin за nginx.

---

## 3. Поднять стек

```bash
docker compose up -d --build      # соберёт api+web, поднимет postgres+redis+ollama
docker compose ps                 # все healthy/up
docker compose logs -f api        # дождаться "API слушает http://0.0.0.0:3000"
```

Проверка локально (до nginx):

```bash
curl -s http://127.0.0.1:3000/health      # {"status":"ok"}
curl -sI http://127.0.0.1:8080/           # 200, отдаётся фронт
```

API-контейнер на старте сам применяет миграции и сидит супер-админа из ENV (идемпотентно).

---

## 4. nginx + TLS (certbot)

Подготовь webroot для ACME и поставь конфиг:

```bash
sudo mkdir -p /var/www/certbot
sudo cp infra/nginx/llm.korateam.ru.conf /etc/nginx/sites-available/llm.korateam.ru
sudo ln -s /etc/nginx/sites-available/llm.korateam.ru /etc/nginx/sites-enabled/
```

**Первый выпуск сертификата** (порт 80 ещё свободен от нашего 443-блока — берём standalone):

```bash
# временно остановим nginx, чтобы certbot занял 80 (или используй свой привычный способ)
sudo systemctl stop nginx
sudo certbot certonly --standalone -d llm.korateam.ru
sudo systemctl start nginx
```

Альтернатива (без остановки nginx, если 80-блок уже отдаёт ACME) — webroot:

```bash
sudo certbot certonly --webroot -w /var/www/certbot -d llm.korateam.ru
```

Проверка и перезагрузка:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

**Автопродление.** certbot ставит systemd-таймер. Чтобы nginx подхватывал новый серт — добавь deploy-hook:

```bash
echo -e '#!/bin/sh\nsystemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo certbot renew --dry-run     # проверка продления
```

> Конфиг уже отдаёт `/.well-known/acme-challenge/` из `/var/www/certbot` на :80 — webroot-продление работает без простоя.

Теперь открой **https://llm.korateam.ru** — должен отдаться фронт, а `/v1/*` — API.

---

## 5. Модели Ollama

Скачай нужные модели в контейнер ollama, затем зарегистрируй их в админке:

```bash
docker compose exec ollama ollama pull nomic-embed-text     # эмбеддинги
docker compose exec ollama ollama pull qwen2.5:7b           # чат (пример)
docker compose exec ollama ollama list
```

Дальше — в веб-админке (или через API): `Модели → Sync из Ollama`, затем включи нужные (`isEnabled`).
Только включённые модели видны в `/v1/models` и доступны ключам.

---

## 6. Первый вход и выдача доступа

1. Зайди на https://llm.korateam.ru, войди супер-админом (`SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD`).
2. Пользователи регистрируются сами; их API-ключи создаются в статусе **PENDING** и НЕ работают,
   пока ты не одобришь их в админке (`Ключи → Approve`). Можешь и сам выпустить ключ пользователю.
3. Проверка OpenAI-совместимости (подставь одобренный ключ):

```bash
curl https://llm.korateam.ru/v1/embeddings \
  -H "Authorization: Bearer sk-emb-..." -H 'Content-Type: application/json' \
  -d '{"model":"nomic-embed-text","input":"привет"}'

# любой OpenAI SDK: base_url = https://llm.korateam.ru/v1 , api_key = sk-emb-...
```

---

## 7. Эксплуатация

```bash
# обновление до новой версии
git pull && docker compose up -d --build

# логи / статус
docker compose logs -f api
docker compose ps

# рестарт только API
docker compose restart api

# остановить всё (данные в volume сохраняются)
docker compose down
# полностью с данными:  docker compose down -v
```

**Бэкап БД** (volume `embeding-api_pgdata`):

```bash
docker compose exec -T postgres pg_dump -U embeding embeding > backup_$(date +%F).sql
# восстановление: cat backup.sql | docker compose exec -T postgres psql -U embeding embeding
```

**Тюнинг под CPU-only:** `CHAT_CONCURRENCY=1` (тяжёлая генерация — строго по одной),
`EMBED_CONCURRENCY` = сколько эмбеддингов считать параллельно (ориентир: число свободных ядер).
Очередь BullMQ сериализует нагрузку, чтобы не положить сервер.

---

## Траблшутинг

| Симптом | Причина / решение |
|---|---|
| `api` рестартится, в логах `config.get of undefined` | неверный cwd при ручном запуске; в контейнере собрано правильно — не запускай `bun ... main.ts` из корня |
| 502 от nginx | контейнер `api`/`web` не поднялся — `docker compose ps`, `logs api` |
| `/v1/*` отвечает 401/403 | ключ не `APPROVED` (одобри в админке) или модель не включена |
| фронт грузится, но логин/запросы падают на CORS | `WAKU_PUBLIC_API_URL` не пуст или `WEB_ORIGIN` ≠ `https://llm.korateam.ru` → пересобрать web |
| nginx не стартует после конфига | сертификата ещё нет — сначала выпусти certbot (раздел 4) |
| модель не отвечает / долго | CPU-инференс; проверь, что модель скачана (`ollama list`) и включена; снизь нагрузку |
