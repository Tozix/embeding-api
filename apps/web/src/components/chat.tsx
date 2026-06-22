'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'waku';
import { api, streamPost } from '../lib/api';
import { useToast } from './toast';
import { Field } from './ui';

type Msg = { role: 'user' | 'assistant'; content: string; stats?: string };
type KeyOpt = { id: string; name: string; keyPrefix: string };
type ModelOpt = { id: string; kind: 'CHAT' | 'EMBEDDING' };

export function Chat() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<KeyOpt[]>([]);
  const [keyId, setKeyId] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    void api<KeyOpt[]>('/me/playground/keys')
      .then((ks) => {
        setKeys(ks);
        if (ks[0]) setKeyId(ks[0].id);
      })
      .catch(() => {});
  }, []);

  // модели ключа — только CHAT (в чат нельзя слать embedding-модели)
  useEffect(() => {
    if (!keyId) {
      setModels([]);
      return;
    }
    void api<ModelOpt[]>(`/me/playground/keys/${keyId}/models`)
      .then((all) => {
        const chat = all.filter((m) => m.kind === 'CHAT').map((m) => m.id);
        setModels(chat);
        setModel(chat[0] ?? '');
      })
      .catch(() => setModels([]));
  }, [keyId]);

  const patchLast = (patch: Partial<Msg>) =>
    setMessages((ms) =>
      ms.map((m, i) => (i === ms.length - 1 ? { ...m, ...patch } : m)),
    );

  const send = async () => {
    const text = input.trim();
    if (!keyId) return toast('Выберите ключ', 'err');
    if (!model) return toast('Нет доступной chat-модели', 'err');
    if (!text || busy) return;

    const history: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);

    const t0 = performance.now();
    let firstAt = 0;
    let acc = '';
    let tokens = 0;
    try {
      await streamPost(
        `/me/playground/keys/${keyId}/chat`,
        {
          model,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
          stream_options: { include_usage: true },
        },
        (data) => {
          const j = data as {
            choices?: { delta?: { content?: string } }[];
            usage?: { completion_tokens?: number };
            error?: { message?: string };
          };
          if (j.error) {
            acc += `\n⚠ ${j.error.message ?? ''}`;
            patchLast({ content: acc });
            return;
          }
          const delta = j.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            if (!firstAt) firstAt = performance.now();
            acc += delta;
            patchLast({ content: acc });
          }
          if (j.usage?.completion_tokens) tokens = j.usage.completion_tokens;
        },
      );
      const total = performance.now() - t0;
      const tps = tokens && total ? (tokens / (total / 1000)).toFixed(1) : null;
      const ttfb = firstAt ? Math.round(firstAt - t0) : null;
      patchLast({
        content: acc || '(пустой ответ)',
        stats: [
          tokens ? `${tokens} ток` : null,
          `${(total / 1000).toFixed(1)} с`,
          tps ? `${tps} ток/с` : null,
          ttfb ? `TTFB ${ttfb} мс` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка';
      patchLast({ content: acc || `⚠ ${msg}` });
      toast(msg, 'err');
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div
      className="page stack gap-3"
      style={{ height: 'calc(100dvh - 57px)', display: 'flex', flexDirection: 'column' }}
    >
      <div className="page-head">
        <div>
          <h1>Чат с моделью</h1>
          <p>Универсальный ассистент с контекстом сессии — пообщаться и оценить скорость/качество.</p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setMessages([])}
          disabled={messages.length === 0}
        >
          Сбросить диалог
        </button>
      </div>

      <div className="panel">
        <div className="panel-body row gap-2 wrap" style={{ alignItems: 'flex-end' }}>
          {keys.length === 0 ? (
            <p className="muted">
              Нет одобренных ключей.{' '}
              <Link to="/app/keys" className="link">
                Создайте ключ
              </Link>
              .
            </p>
          ) : (
            <>
              <Field label="Ключ">
                <select className="select" value={keyId} onChange={(e) => setKeyId(e.target.value)}>
                  {keys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} ({k.keyPrefix})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Модель (chat)">
                <select
                  className="select"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={models.length === 0}
                >
                  {models.length === 0 ? (
                    <option value="">нет chat-моделей</option>
                  ) : (
                    models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))
                  )}
                </select>
              </Field>
            </>
          )}
        </div>
      </div>

      <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div
          ref={scrollRef}
          style={{ flex: 1, overflowY: 'auto', padding: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
        >
          {messages.length === 0 ? (
            <div className="empty" style={{ margin: 'auto' }}>
              Задайте вопрос — контекст диалога сохраняется в сессии.
            </div>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%' }}
              >
                <div
                  style={{
                    padding: '0.6rem 0.85rem',
                    borderRadius: 12,
                    background: m.role === 'user' ? 'var(--accent)' : 'var(--surface-2)',
                    color: m.role === 'user' ? 'var(--accent-ink)' : 'var(--text)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    lineHeight: 1.55,
                  }}
                >
                  {m.content || (busy && i === messages.length - 1 ? <span className="spinner" /> : '')}
                </div>
                {m.stats && (
                  <div className="faint mono" style={{ fontSize: '0.72rem', marginTop: '0.3rem' }}>
                    {m.stats}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', padding: '0.85rem', display: 'flex', gap: '0.6rem', alignItems: 'flex-end' }}>
          <textarea
            className="input"
            style={{ flex: 1, minHeight: 44, height: 'auto', padding: '0.55rem 0.7rem', resize: 'none' }}
            rows={1}
            placeholder="Сообщение… (Enter — отправить, Shift+Enter — перенос строки)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
          />
          <button className="btn btn-primary" onClick={send} disabled={busy || !input.trim() || !model}>
            {busy ? '…' : 'Отправить'}
          </button>
        </div>
      </div>
    </div>
  );
}
