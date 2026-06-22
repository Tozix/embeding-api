// E2e против реального Postgres+Redis. Инфру и ENV поднимает scripts/test-e2e.sh.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { Role } from '../../src/prisma/client';

let app: NestExpressApplication;
let base: string;

// общее состояние между тестами (bun test идёт по порядку в файле)
let userToken = '';
let refreshA = '';
let rawKey = '';
let keyId = '';
let adminToken = '';
let ollama: { stop: () => void; port: number } | undefined;

type Res = { status: number; body: any; setCookie: string | null };

async function http(
  path: string,
  opts: { method?: string; body?: unknown; token?: string; cookie?: string } = {},
): Promise<Res> {
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : undefined,
    setCookie: res.headers.get('set-cookie'),
  };
}

function refreshCookie(setCookie: string | null): string {
  const m = setCookie?.match(/embeding_refresh=[^;]+/);
  return m ? m[0] : '';
}

/** Читает SSE-ответ целиком и возвращает payload'ы строк `data: ...`. */
async function sse(path: string, body: unknown, token: string): Promise<string[]> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => l.slice(6));
}

// Фейк отслеживает «загруженные в память» модели по keep_alive (0 = выгрузить).
const loadedModels = new Set<string>();
function track(model: string | undefined, keepAlive: unknown): void {
  if (!model) return;
  if (keepAlive === 0) loadedModels.delete(model);
  else loadedModels.add(model);
}

/**
 * Фейковый Ollama: детерминированные /api/embed, /api/chat (NDJSON), /api/generate, /api/ps.
 * Слушает порт из OLLAMA_BASE_URL (его задаёт scripts/test-e2e.sh ДО старта процесса),
 * чтобы ConfigService и фейк смотрели на один порт без гонки с beforeAll.
 */
function startFakeOllama() {
  const port = Number(
    new URL(process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:18434').port,
  );
  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/api/embed') {
        const b = (await req.json()) as {
          model?: string;
          input: string | string[];
          keep_alive?: unknown;
        };
        track(b.model, b.keep_alive);
        const inputs = Array.isArray(b.input) ? b.input : [b.input];
        return Response.json({
          embeddings: inputs.map(() => [0.11, 0.22, 0.33, 0.44]),
          prompt_eval_count: 5,
        });
      }
      if (url.pathname === '/api/generate') {
        const b = (await req.json()) as { model?: string; keep_alive?: unknown };
        track(b.model, b.keep_alive);
        return Response.json({ model: b.model ?? 'fake', response: '', done: true });
      }
      if (url.pathname === '/api/ps') {
        return Response.json({
          models: [...loadedModels].map((name) => ({
            name,
            size: 123_000_000,
            size_vram: 0,
            expires_at: '2099-01-01T00:00:00Z',
          })),
        });
      }
      if (url.pathname === '/api/chat') {
        const b = (await req.json()) as {
          model?: string;
          stream?: boolean;
          keep_alive?: unknown;
        };
        track(b.model, b.keep_alive);
        if (b.stream === false) {
          return Response.json({
            model: 'fake',
            message: { role: 'assistant', content: 'Ответ модели' },
            done: true,
            done_reason: 'stop',
            prompt_eval_count: 7,
            eval_count: 3,
          });
        }
        const enc = new TextEncoder();
        const lines = [
          { model: 'fake', message: { role: 'assistant', content: 'Раз' }, done: false },
          { model: 'fake', message: { role: 'assistant', content: ', два' }, done: false },
          { model: 'fake', message: { role: 'assistant', content: ', три' }, done: false },
          { model: 'fake', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 7, eval_count: 5 },
        ];
        return new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              for (const l of lines) c.enqueue(enc.encode(JSON.stringify(l) + '\n'));
              c.close();
            },
          }),
          { headers: { 'content-type': 'application/x-ndjson' } },
        );
      }
      if (url.pathname === '/api/tags') {
        return Response.json({ models: [{ name: 'fake-model' }] });
      }
      return new Response('not found', { status: 404 });
    },
  });
}

beforeAll(async () => {
  // Фейковый Ollama на порту из OLLAMA_BASE_URL (задан раннером до старта процесса).
  ollama = startFakeOllama();
  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
  });
  app.use(cookieParser());
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  // сид супер-админа (как делает prisma/seed.ts)
  const prisma = app.get(PrismaService);
  await prisma.user.upsert({
    where: { email: process.env.SUPERADMIN_EMAIL! },
    update: { role: Role.SUPERADMIN, isActive: true },
    create: {
      email: process.env.SUPERADMIN_EMAIL!,
      passwordHash: await bcrypt.hash(process.env.SUPERADMIN_PASSWORD!, 10),
      role: Role.SUPERADMIN,
      displayName: 'Super Admin',
    },
  });
});

afterAll(async () => {
  await app?.close();
  ollama?.stop();
});

test('регистрация → 201, нормализованный email, access + refresh-cookie', async () => {
  const r = await http('/auth/register', {
    method: 'POST',
    body: { email: 'User@E2E.local', password: 'password123' },
  });
  expect(r.status).toBe(201);
  expect(r.body.user.email).toBe('user@e2e.local');
  expect(typeof r.body.accessToken).toBe('string');
  userToken = r.body.accessToken;
  refreshA = refreshCookie(r.setCookie);
  expect(refreshA).toContain('embeding_refresh=');
});

test('/auth/me → 200', async () => {
  const r = await http('/auth/me', { token: userToken });
  expect(r.status).toBe(200);
  expect(r.body.email).toBe('user@e2e.local');
});

test('логин с неверным паролем → 401', async () => {
  const r = await http('/auth/login', {
    method: 'POST',
    body: { email: 'user@e2e.local', password: 'WRONG' },
  });
  expect(r.status).toBe(401);
});

test('создание ключа → 201 PENDING, сырой ключ один раз', async () => {
  const r = await http('/keys', {
    method: 'POST',
    token: userToken,
    body: { name: 'e2e' },
  });
  expect(r.status).toBe(201);
  expect(r.body.status).toBe('PENDING');
  expect(r.body.key).toContain('sk-emb-');
  rawKey = r.body.key;
  keyId = r.body.id;
});

test('PENDING-ключ на /v1/models → 403 OpenAI-конверт', async () => {
  const r = await http('/v1/models', { token: rawKey });
  expect(r.status).toBe(403);
  expect(r.body.error.type).toBe('permission_error');
});

test('логин супер-админа → 200', async () => {
  const r = await http('/auth/login', {
    method: 'POST',
    body: {
      email: process.env.SUPERADMIN_EMAIL,
      password: process.env.SUPERADMIN_PASSWORD,
    },
  });
  expect(r.status).toBe(200);
  adminToken = r.body.accessToken;
});

test('USER на /admin/users → 403 (RolesGuard)', async () => {
  const r = await http('/admin/users', { token: userToken });
  expect(r.status).toBe(403);
});

test('супер-админ одобряет ключ → 200 APPROVED', async () => {
  const r = await http(`/admin/keys/${keyId}/approve`, {
    method: 'POST',
    token: adminToken,
  });
  expect(r.status).toBe(200);
  expect(r.body.status).toBe('APPROVED');
});

test('супер-админ заводит включённую модель → 201', async () => {
  const r = await http('/admin/models', {
    method: 'POST',
    token: adminToken,
    body: { ollamaName: 'nomic-embed-text', kind: 'EMBEDDING', isEnabled: true },
  });
  expect(r.status).toBe(201);
});

test('APPROVED-ключ видит модель в /v1/models → 200', async () => {
  const r = await http('/v1/models', { token: rawKey });
  expect(r.status).toBe(200);
  expect(r.body.object).toBe('list');
  expect(r.body.data.some((m: { id: string }) => m.id === 'nomic-embed-text')).toBe(
    true,
  );
});

test('/v1/embeddings через очередь → Ollama → 200 с вектором', async () => {
  const r = await http('/v1/embeddings', {
    method: 'POST',
    token: rawKey,
    body: { model: 'nomic-embed-text', input: 'привет' },
  });
  expect(r.status).toBe(200);
  expect(r.body.object).toBe('list');
  expect(r.body.data).toHaveLength(1);
  expect(r.body.data[0].embedding).toHaveLength(4);
  expect(r.body.usage.prompt_tokens).toBe(5);
});

test('супер-админ заводит CHAT-модель → 201', async () => {
  const r = await http('/admin/models', {
    method: 'POST',
    token: adminToken,
    body: { ollamaName: 'fake-chat', kind: 'CHAT', isEnabled: true },
  });
  expect(r.status).toBe(201);
});

test('/v1/chat/completions non-stream → 200', async () => {
  const r = await http('/v1/chat/completions', {
    method: 'POST',
    token: rawKey,
    body: { model: 'fake-chat', messages: [{ role: 'user', content: 'привет' }] },
  });
  expect(r.status).toBe(200);
  expect(r.body.object).toBe('chat.completion');
  expect(r.body.choices[0].message.content).toBe('Ответ модели');
  expect(r.body.choices[0].finish_reason).toBe('stop');
});

test('/v1/chat/completions stream → SSE-чанки, контент, usage, [DONE]', async () => {
  const events = await sse(
    '/v1/chat/completions',
    {
      model: 'fake-chat',
      messages: [{ role: 'user', content: 'считай' }],
      stream: true,
      stream_options: { include_usage: true },
    },
    rawKey,
  );
  expect(events.at(-1)).toBe('[DONE]');
  const chunks = events
    .filter((e) => e !== '[DONE]')
    .map((e) => JSON.parse(e));
  // первый чанк несёт delta.role=assistant
  expect(chunks[0].choices[0].delta.role).toBe('assistant');
  // склейка контента из дельт
  const textOut = chunks
    .map((c) => c.choices[0]?.delta?.content ?? '')
    .join('');
  expect(textOut).toBe('Раз, два, три');
  // финальный delta-чанк несёт finish_reason
  expect(chunks.some((c) => c.choices[0]?.finish_reason === 'stop')).toBe(true);
  // при include_usage — отдельный usage-чанк с пустым choices
  const usageChunk = chunks.find(
    (c) => c.usage && c.choices.length === 0,
  );
  expect(usageChunk.usage.total_tokens).toBe(12);
});

test('ротация refresh + reuse-detection: старый токен после ротации → 401', async () => {
  const rotated = await http('/auth/refresh', { method: 'POST', cookie: refreshA });
  expect(rotated.status).toBe(200);
  expect(typeof rotated.body.accessToken).toBe('string');

  // повторное использование СТАРОГО refresh → reuse-инцидент → 401
  const reuse = await http('/auth/refresh', { method: 'POST', cookie: refreshA });
  expect(reuse.status).toBe(401);
});

// ---------- новые admin-фичи ----------

test('#3 супер-админ создаёт пользователя → 201 (email нормализован), можно войти', async () => {
  const r = await http('/admin/users', {
    method: 'POST',
    token: adminToken,
    body: {
      email: 'Made@Admin.io',
      password: 'password123',
      role: 'USER',
      displayName: 'Создан',
    },
  });
  expect(r.status).toBe(201);
  expect(r.body.email).toBe('made@admin.io');
  expect(r.body.role).toBe('USER');
  const login = await http('/auth/login', {
    method: 'POST',
    body: { email: 'made@admin.io', password: 'password123' },
  });
  expect(login.status).toBe(200);
});

test('#3 дубликат email при создании → 409', async () => {
  const r = await http('/admin/users', {
    method: 'POST',
    token: adminToken,
    body: { email: 'made@admin.io', password: 'password123' },
  });
  expect(r.status).toBe(409);
});

test('#2 создание второго супер-админа → у него есть доступ к /admin', async () => {
  const r = await http('/admin/users', {
    method: 'POST',
    token: adminToken,
    body: { email: 'admin2@test.io', password: 'password123', role: 'SUPERADMIN' },
  });
  expect(r.status).toBe(201);
  const login = await http('/auth/login', {
    method: 'POST',
    body: { email: 'admin2@test.io', password: 'password123' },
  });
  const access = await http('/admin/users', { token: login.body.accessToken });
  expect(access.status).toBe(200);
});

test('#1 супер-админ выпускает себе ключ → сразу APPROVED', async () => {
  const r = await http('/keys', {
    method: 'POST',
    token: adminToken,
    body: { name: 'admin self key' },
  });
  expect(r.status).toBe(201);
  expect(r.body.status).toBe('APPROVED');
  expect(r.body.key).toContain('sk-emb-');
});

test('#4 load/unload модели в память + runtime-статус', async () => {
  const runtime = await http('/admin/models/runtime', { token: adminToken });
  expect(runtime.status).toBe(200);
  const chat = runtime.body.find(
    (m: { ollamaName: string }) => m.ollamaName === 'fake-chat',
  );
  expect(chat).toBeTruthy();

  const load = await http(`/admin/models/${chat.id}/load`, {
    method: 'POST',
    token: adminToken,
  });
  expect(load.status).toBe(200);
  const after = await http('/admin/models/runtime', { token: adminToken });
  const loaded = after.body.find((m: { id: string }) => m.id === chat.id);
  expect(loaded.loaded).toBe(true);
  expect(loaded.sizeBytes).toBeGreaterThan(0);

  const unload = await http(`/admin/models/${chat.id}/unload`, {
    method: 'POST',
    token: adminToken,
  });
  expect(unload.status).toBe(200);
  const after2 = await http('/admin/models/runtime', { token: adminToken });
  const unloaded = after2.body.find((m: { id: string }) => m.id === chat.id);
  expect(unloaded.loaded).toBe(false);
});

test('#6 метрики хоста (CPU/RAM) → cpuCount/current/history', async () => {
  const r = await http('/admin/analytics/system', { token: adminToken });
  expect(r.status).toBe(200);
  expect(r.body.cpuCount).toBeGreaterThan(0);
  expect(r.body.current.memTotal).toBeGreaterThan(0);
  expect(typeof r.body.current.cpu).toBe('number');
  expect(Array.isArray(r.body.history)).toBe(true);
});

test('USER на /admin/models/runtime → 403', async () => {
  const r = await http('/admin/models/runtime', { token: userToken });
  expect(r.status).toBe(403);
});
