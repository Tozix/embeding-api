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

beforeAll(async () => {
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

test('/v1/embeddings через очередь → Ollama недоступна → 502 (статус сохранён через очередь)', async () => {
  const r = await http('/v1/embeddings', {
    method: 'POST',
    token: rawKey,
    body: { model: 'nomic-embed-text', input: 'привет' },
  });
  expect(r.status).toBe(502);
  expect(r.body.error.type).toBe('api_error');
});

test('ротация refresh + reuse-detection: старый токен после ротации → 401', async () => {
  const rotated = await http('/auth/refresh', { method: 'POST', cookie: refreshA });
  expect(rotated.status).toBe(200);
  expect(typeof rotated.body.accessToken).toBe('string');

  // повторное использование СТАРОГО refresh → reuse-инцидент → 401
  const reuse = await http('/auth/refresh', { method: 'POST', cookie: refreshA });
  expect(reuse.status).toBe(401);
});
