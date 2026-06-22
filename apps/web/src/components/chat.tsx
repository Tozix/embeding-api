'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { API_BASE } from '../lib/api';
import { useToast } from './toast';
import { Field } from './ui';

type Msg = { role: 'user' | 'assistant'; content: string; stats?: string };

export function Chat() {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState('');
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

  const loadModels = async () => {
    if (!apiKey.trim()) return toast('Вставьте API-ключ', 'err');
    try {
      const res = await fetch(`${API_BASE}/v1/models`, {
        headers: { authorization: `Bearer ${apiKey.trim()}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? `Ошибка ${res.status}`);
      const ids: string[] = (data.data ?? []).map((m: { id: string }) => m.id);
      setModels(ids);
      if (ids[0]) setModel(ids[0]);
      toast(ids.length ? `Доступно моделей: ${ids.length}` : 'Нет моделей', ids.length ? 'ok' : 'err');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка', 'err');
    }
  };

  const patchLast = (patch: Partial<Msg>) =>
    setMessages((ms) =>
      ms.map((m, i) => (i === ms.length - 1 ? { ...m, ...patch } : m)),
    );

  const send = async () => {
    const text = input.trim();
    if (!apiKey.trim()) return toast('Вставьте API-ключ', 'err');
    if (!model) return toast('Загрузите модели и выберите', 'err');
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
      const res = await fetch(`${API_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({
          model,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
          stream_options: { include_usage: true },
        }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error?.message ?? `Ошибка ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload) as {
              choices?: { delta?: { content?: string } }[];
              usage?: { completion_tokens?: number };
            };
            const delta = j.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              if (!firstAt) firstAt = performance.now();
              acc += delta;
              patchLast({ content: acc });
            }
            if (j.usage?.completion_tokens) tokens = j.usage.completion_tokens;
          } catch {
            /* skip */
          }
        }
      }
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
    <div className="page stack gap-3" style={{ height: 'calc(100dvh - 57px)', display: 'flex', flexDirection: 'column' }}>
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

      {/* настройки */}
      <div className="panel">
        <div className="panel-body row gap-2 wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="API-ключ (sk-emb-…)">
            <input
              className="input mono"
              style={{ minWidth: 300 }}
              placeholder="sk-emb-…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>
          <button className="btn btn-ghost" onClick={loadModels}>
            Загрузить модели
          </button>
          {models.length > 0 && (
            <Field label="Модель">
              <select className="select" value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </div>

      {/* диалог */}
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

        {/* ввод */}
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
          <button className="btn btn-primary" onClick={send} disabled={busy || !input.trim()}>
            {busy ? '…' : 'Отправить'}
          </button>
        </div>
      </div>
    </div>
  );
}
