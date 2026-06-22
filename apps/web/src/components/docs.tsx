'use client';

import type { ReactNode } from 'react';
import { Link } from 'waku';
import { API_BASE } from '../lib/api';

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="panel" style={{ overflow: 'hidden', marginTop: '0.75rem' }}>
      <div className="panel-head">
        <span className="mono faint" style={{ fontSize: '0.78rem' }}>
          {label}
        </span>
      </div>
      <pre
        className="mono"
        style={{
          margin: 0,
          padding: '1rem 1.1rem',
          fontSize: '0.8rem',
          lineHeight: 1.65,
          color: 'var(--text-muted)',
          overflowX: 'auto',
          whiteSpace: 'pre',
        }}
      >
        {code}
      </pre>
    </div>
  );
}

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} style={{ marginTop: '3.5rem', scrollMarginTop: '2rem' }}>
      <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
        {eyebrow}
      </div>
      <h2 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>{title}</h2>
      {children}
    </section>
  );
}

// База для примеров: реальный origin страницы (точна для любого деплоя), фолбэк — домен прод.
const ORIGIN =
  typeof window !== 'undefined'
    ? window.location.origin
    : 'https://llm.korateam.ru';

const CURL_EMBED = `curl ${ORIGIN}/v1/embeddings \\
  -H "Authorization: Bearer sk-emb-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "nomic-embed-text",
    "input": "привет, мир"
  }'`;

const CURL_CHAT = `curl ${ORIGIN}/v1/chat/completions \\
  -H "Authorization: Bearer sk-emb-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen2.5:7b",
    "messages": [{"role": "user", "content": "Привет!"}],
    "stream": true
  }'`;

const PY = `from openai import OpenAI

client = OpenAI(base_url="${ORIGIN}/v1", api_key="sk-emb-...")

# эмбеддинги
emb = client.embeddings.create(model="nomic-embed-text", input="привет, мир")
print(len(emb.data[0].embedding))

# чат
r = client.chat.completions.create(
    model="qwen2.5:7b",
    messages=[{"role": "user", "content": "Привет!"}],
)
print(r.choices[0].message.content)

# стриминг
for chunk in client.chat.completions.create(
    model="qwen2.5:7b",
    messages=[{"role": "user", "content": "Считай до 5"}],
    stream=True,
):
    print(chunk.choices[0].delta.content or "", end="", flush=True)`;

const JS = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${ORIGIN}/v1",
  apiKey: "sk-emb-...",
});

const emb = await client.embeddings.create({
  model: "nomic-embed-text",
  input: "привет, мир",
});

const stream = await client.chat.completions.create({
  model: "qwen2.5:7b",
  messages: [{ role: "user", content: "Привет!" }],
  stream: true,
});
for await (const chunk of stream)
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");`;

const ENDPOINTS: [string, string, string, string][] = [
  ['POST', '/v1/embeddings', 'Эмбеддинги текста', 'API-ключ'],
  ['POST', '/v1/chat/completions', 'Чат-комплишены (+ стриминг)', 'API-ключ'],
  ['GET', '/v1/models', 'Список доступных моделей', 'API-ключ'],
  ['POST', '/auth/register', 'Регистрация', '—'],
  ['POST', '/auth/login', 'Вход в кабинет', '—'],
  ['POST', '/keys', 'Создать API-ключ (→ pending)', 'JWT'],
  ['GET', '/keys', 'Мои ключи', 'JWT'],
];

export function Docs() {
  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: '5vh 1.5rem 8rem' }}>
      {/* nav */}
      <div className="row between" style={{ marginBottom: '4rem' }}>
        <Link to="/" className="brand" style={{ padding: 0 }}>
          <span className="dot" />
          <span>embeding</span>
        </Link>
        <div className="row gap-1">
          <a
            href={`${API_BASE}/reference`}
            className="btn btn-ghost btn-sm"
            target="_blank"
            rel="noreferrer"
          >
            Swagger ↗
          </a>
          <Link to="/login" className="btn btn-primary btn-sm">
            Войти
          </Link>
        </div>
      </div>

      {/* hero */}
      <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
        документация · openai-compatible
      </div>
      <h1 style={{ fontSize: '2.3rem', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
        Как пользоваться API
      </h1>
      <p className="muted" style={{ fontSize: '1.05rem', maxWidth: '60ch', marginTop: '1rem' }}>
        Сервис полностью совместим с OpenAI. Любой клиент или SDK работает без изменений — нужно
        лишь подменить <span className="mono">base_url</span> и ключ.
      </p>
      <div className="row gap-1" style={{ marginTop: '1.5rem' }}>
        <a href={`${API_BASE}/reference`} className="btn btn-primary" target="_blank" rel="noreferrer">
          Открыть интерактивный Swagger →
        </a>
        <Link to="/register" className="btn btn-ghost">
          Получить ключ
        </Link>
      </div>

      <Section id="start" eyebrow="шаг за шагом" title="Быстрый старт">
        <ol className="muted" style={{ lineHeight: 1.9, paddingLeft: '1.2rem', maxWidth: '60ch' }}>
          <li>
            <Link to="/register" className="link">
              Зарегистрируйтесь
            </Link>{' '}
            в кабинете.
          </li>
          <li>
            Создайте API-ключ — он появится в статусе{' '}
            <span className="badge badge-warn">pending</span>. Сырой ключ показывается{' '}
            <b>один раз</b> — сохраните его.
          </li>
          <li>
            Дождитесь одобрения супер-админом — статус станет{' '}
            <span className="badge badge-ok">approved</span>.
          </li>
          <li>
            Подставьте ключ и хост в любой OpenAI-клиент. Готово.
          </li>
        </ol>
      </Section>

      <Section id="auth" eyebrow="аутентификация" title="Ключи и доступ">
        <p className="muted" style={{ maxWidth: '60ch', lineHeight: 1.7 }}>
          Все запросы к <span className="mono">/v1/*</span> авторизуются заголовком{' '}
          <span className="mono">Authorization: Bearer sk-emb-…</span>. Ключ работает только в
          статусе <span className="mono">approved</span> и только для моделей, которые включил
          администратор. Неодобренный или отозванный ключ получает ошибку в формате OpenAI.
        </p>
      </Section>

      <Section id="examples" eyebrow="примеры" title="curl">
        <CodeBlock label="embeddings.sh" code={CURL_EMBED} />
        <CodeBlock label="chat-stream.sh" code={CURL_CHAT} />
      </Section>

      <Section id="python" eyebrow="примеры" title="Python (openai SDK)">
        <p className="muted" style={{ marginBottom: '0.25rem' }}>
          <span className="mono">pip install openai</span>
        </p>
        <CodeBlock label="example.py" code={PY} />
      </Section>

      <Section id="javascript" eyebrow="примеры" title="JavaScript / TypeScript (openai SDK)">
        <p className="muted" style={{ marginBottom: '0.25rem' }}>
          <span className="mono">npm i openai</span>
        </p>
        <CodeBlock label="example.ts" code={JS} />
      </Section>

      <Section id="endpoints" eyebrow="справочник" title="Эндпоинты">
        <div className="panel" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-faint)' }}>
                <th style={{ padding: '0.6rem 1rem' }}>Метод</th>
                <th style={{ padding: '0.6rem 1rem' }}>Путь</th>
                <th style={{ padding: '0.6rem 1rem' }}>Назначение</th>
                <th style={{ padding: '0.6rem 1rem' }}>Auth</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map(([method, path, purpose, auth]) => (
                <tr key={path + method} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.55rem 1rem' }}>
                    <span className="mono" style={{ color: 'var(--accent)' }}>
                      {method}
                    </span>
                  </td>
                  <td style={{ padding: '0.55rem 1rem' }} className="mono">
                    {path}
                  </td>
                  <td style={{ padding: '0.55rem 1rem' }} className="muted">
                    {purpose}
                  </td>
                  <td style={{ padding: '0.55rem 1rem' }} className="faint">
                    {auth}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="faint" style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
          Полный справочник со схемами запросов/ответов и кнопкой «Try it out» —{' '}
          <a href={`${API_BASE}/reference`} className="link" target="_blank" rel="noreferrer">
            интерактивный Swagger
          </a>
          .
        </p>
      </Section>
    </main>
  );
}
