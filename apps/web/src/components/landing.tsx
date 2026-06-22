'use client';

import { useEffect } from 'react';
import { Link } from 'waku';
import { useAuth } from '../lib/auth';

const SNIPPET = `from openai import OpenAI

client = OpenAI(
    base_url="https://your-host/v1",
    api_key="sk-emb-…",  # ключ выдаётся в кабинете
)

client.embeddings.create(
    model="nomic-embed-text",
    input="привет, мир",
)`;

export function Landing() {
  const { user, loading } = useAuth();
  useEffect(() => {
    if (!loading && user) window.location.assign('/app/keys');
  }, [loading, user]);

  return (
    <main style={{ maxWidth: 1040, margin: '0 auto', padding: '6vh 1.5rem' }}>
      <div className="row between" style={{ marginBottom: '5rem' }}>
        <div className="brand" style={{ padding: 0 }}>
          <span className="dot" />
          <span>embeding</span>
        </div>
        <div className="row gap-1">
          <Link to="/docs" className="btn btn-ghost btn-sm">
            Документация
          </Link>
          <Link to="/login" className="btn btn-ghost btn-sm">
            Войти
          </Link>
          <Link to="/register" className="btn btn-primary btn-sm">
            Создать аккаунт
          </Link>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(0,0.85fr)',
          gap: '3rem',
          alignItems: 'center',
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: '1rem' }}>
            self-hosted · ollama · openai-compatible
          </div>
          <h1 style={{ fontSize: '2.6rem', lineHeight: 1.08, letterSpacing: '-0.02em' }}>
            Один OpenAI-совместимый шлюз ко всем вашим локальным моделям.
          </h1>
          <p
            className="muted"
            style={{ fontSize: '1.05rem', maxWidth: '52ch', marginTop: '1.25rem' }}
          >
            Эмбеддинги и чат через Ollama за единым ключом. Очередь бережёт CPU, супер-админ
            модерирует ключи и видит нагрузку в реальном времени. Просто поменяйте{' '}
            <span className="mono">base_url</span>.
          </p>
          <div className="row gap-1" style={{ marginTop: '2rem' }}>
            <Link to="/register" className="btn btn-primary">
              Начать
            </Link>
            <Link to="/login" className="btn btn-ghost">
              У меня есть аккаунт
            </Link>
          </div>
        </div>

        <div className="panel" style={{ overflow: 'hidden' }}>
          <div className="panel-head">
            <span className="mono faint" style={{ fontSize: '0.78rem' }}>
              quickstart.py
            </span>
            <span className="badge badge-ok">drop-in</span>
          </div>
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: '1.1rem',
              fontSize: '0.82rem',
              lineHeight: 1.7,
              color: 'var(--text-muted)',
              overflowX: 'auto',
            }}
          >
            {SNIPPET}
          </pre>
        </div>
      </div>
    </main>
  );
}
