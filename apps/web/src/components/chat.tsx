'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'waku';
import { api, streamPost } from '../lib/api';
import { useToast } from './toast';
import { Field } from './ui';

type Msg = { role: 'user' | 'assistant'; content: string; stats?: string };
type KeyOpt = { id: string; name: string; keyPrefix: string };
type ModelOpt = { id: string; kind: 'CHAT' | 'EMBEDDING' };

// Чат — это «контекст сессии», поэтому держим историю и выбор в sessionStorage:
// переживает уход со страницы и обновление в рамках вкладки, чистится при её закрытии.
// streaming=true означает, что прямо сейчас идёт генерация (возможно — в фоне, после
// ухода со страницы): её писал send() в прошлом монтировании, а мы дочитываем поллингом.
const STORE_KEY = 'chat-session:v1';
type Saved = { messages: Msg[]; keyId: string; model: string; streaming?: boolean };

// Флаг живёт вне React: при уходе со страницы во время генерации компонент размонтируется,
// но fetch-цикл send() продолжает работать и писать ответ в sessionStorage — ответ не
// теряется. Флаг не даёт «фоновому» writer'у и «обычному» persist-эффекту перетирать друг друга.
let streamActive = false;

function loadSaved(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}
function saveSession(s: Saved): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* sessionStorage недоступен — не критично */
  }
}

export function Chat() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<KeyOpt[]>([]);
  const [keysErr, setKeysErr] = useState(false);
  const [keyId, setKeyId] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0); // сек с момента отправки — для индикатора «думает»
  const [resuming, setResuming] = useState(false); // вернулись во время фоновой генерации
  // Гидрация из sessionStorage — в эффекте (не в init), чтобы не разойтись с SSR-разметкой.
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Восстановление сохранённой сессии чата при входе на страницу.
  useEffect(() => {
    const s = loadSaved();
    if (s) {
      if (Array.isArray(s.messages)) setMessages(s.messages);
      if (s.keyId) setKeyId(s.keyId);
      if (s.model) setModel(s.model);
    }
    setHydrated(true);

    // Вернулись во время активной генерации (стрим идёт в фоне из прошлого монтирования) —
    // дочитываем ответ из sessionStorage, пока он не допишется. Так ответ не «пропадает».
    if (s?.streaming) {
      setResuming(true);
      const poll = setInterval(() => {
        const cur = loadSaved();
        if (!cur) {
          clearInterval(poll);
          setResuming(false);
          return;
        }
        setMessages(cur.messages ?? []);
        if (!cur.streaming) {
          clearInterval(poll);
          setResuming(false);
        }
      }, 300);
      const stop = setTimeout(() => {
        clearInterval(poll);
        setResuming(false);
      }, 300_000); // предохранитель: не поллим вечно
      return () => {
        clearInterval(poll);
        clearTimeout(stop);
      };
    }
  }, []);

  // Сохранение сессии (история + выбор). Во время стрима пишет send() (с флагом streaming),
  // поэтому здесь пропускаем — иначе перетёрли бы прогресс/флаг фонового writer'а.
  useEffect(() => {
    if (!hydrated || streamActive) return;
    saveSession({ messages, keyId, model, streaming: false });
  }, [hydrated, messages, keyId, model]);

  useEffect(() => {
    void api<KeyOpt[]>('/me/playground/keys')
      .then((ks) => {
        setKeys(ks);
        setKeysErr(false);
        // сохраняем восстановленный выбор, если он ещё валиден; иначе — первый ключ
        setKeyId((cur) => (cur && ks.some((k) => k.id === cur) ? cur : (ks[0]?.id ?? '')));
      })
      .catch(() => setKeysErr(true)); // не маскируем сбой запроса под «нет ключей»
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
        // сохраняем восстановленную модель, если она доступна ключу; иначе — первую
        setModel((cur) => (cur && chat.includes(cur) ? cur : (chat[0] ?? '')));
      })
      .catch(() => setModels([]));
  }, [keyId]);

  const send = async () => {
    const text = input.trim();
    if (!keyId) return toast('Выберите ключ', 'err');
    if (!model) return toast('Нет доступной chat-модели', 'err');
    if (!text || busy) return;

    const history: Msg[] = [...messages, { role: 'user', content: text }];
    setInput('');
    setBusy(true);
    streamActive = true; // стрим теперь живёт независимо от монтирования компонента

    // Единый writer: пишем и в UI (setMessages — no-op после размонтирования), и durable в
    // sessionStorage. Второе продолжит работать, даже если уйти со страницы → ответ не теряется.
    let lastSaveAt = 0;
    const flush = (assistant: Msg, streaming: boolean, force = false) => {
      const msgs = [...history, assistant];
      setMessages(msgs);
      const now = performance.now();
      if (force || !streaming || now - lastSaveAt > 200) {
        lastSaveAt = now;
        saveSession({ messages: msgs, keyId, model, streaming });
      }
    };

    flush({ role: 'assistant', content: '' }, true, true);

    const t0 = performance.now();
    setElapsed(0);
    // тикаем счётчик, пока ждём/стримим — на CPU «думанье» (processing) может быть долгим
    const timer = setInterval(() => setElapsed((performance.now() - t0) / 1000), 100);
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
            flush({ role: 'assistant', content: acc }, true);
            return;
          }
          const delta = j.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            if (!firstAt) firstAt = performance.now();
            acc += delta;
            flush({ role: 'assistant', content: acc }, true);
          }
          if (j.usage?.completion_tokens) tokens = j.usage.completion_tokens;
        },
      );
      const total = performance.now() - t0;
      const tps = tokens && total ? (tokens / (total / 1000)).toFixed(1) : null;
      const ttfb = firstAt ? Math.round(firstAt - t0) : null;
      flush(
        {
          role: 'assistant',
          content: acc || '(пустой ответ)',
          stats: [
            tokens ? `${tokens} ток` : null,
            `${(total / 1000).toFixed(1)} с`,
            tps ? `${tps} ток/с` : null,
            ttfb ? `TTFB ${ttfb} мс` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        },
        false,
        true,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка';
      flush({ role: 'assistant', content: acc || `⚠ ${msg}` }, false, true);
      toast(msg, 'err');
    } finally {
      clearInterval(timer);
      streamActive = false;
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
          {keysErr ? (
            <p className="muted">
              Не удалось загрузить ключи — обновите страницу. Если повторяется, возможно, API
              устарел (нужно пересобрать).
            </p>
          ) : keys.length === 0 ? (
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
                  {m.content ? (
                    <>
                      {m.content}
                      {(busy || resuming) && i === messages.length - 1 && (
                        <span className="blink-cursor">▍</span>
                      )}
                    </>
                  ) : (busy || resuming) && i === messages.length - 1 ? (
                    <span className="thinking">
                      <span className="typing-dots">
                        <i />
                        <i />
                        <i />
                      </span>
                      думает…{busy ? ` ${elapsed.toFixed(1)} с` : ''}
                    </span>
                  ) : (
                    ''
                  )}
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
