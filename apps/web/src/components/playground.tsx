'use client';

import { useState } from 'react';
import { API_BASE } from '../lib/api';
import { useToast } from './toast';
import { Field } from './ui';

type Mode = 'chat' | 'embeddings';

const EXAMPLES: Record<Mode, string[]> = {
  chat: [
    'Привет! Кто ты?',
    'Напиши хайку про море',
    'Объясни рекурсию простыми словами',
  ],
  embeddings: [
    'Привет, мир',
    'Векторный поиск по документам',
    'semantic search test',
  ],
};

export function Playground() {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [mode, setMode] = useState<Mode>('chat');
  const [input, setInput] = useState(EXAMPLES.chat[0] ?? '');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);

  const auth = () => ({ authorization: `Bearer ${apiKey.trim()}` });

  const loadModels = async () => {
    if (!apiKey.trim()) return toast('Вставьте API-ключ', 'err');
    try {
      const res = await fetch(`${API_BASE}/v1/models`, { headers: auth() });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? `Ошибка ${res.status}`);
      const ids: string[] = (data.data ?? []).map((m: { id: string }) => m.id);
      setModels(ids);
      if (ids[0]) setModel(ids[0]);
      toast(ids.length ? `Доступно моделей: ${ids.length}` : 'Нет доступных моделей', ids.length ? 'ok' : 'err');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка', 'err');
    }
  };

  const runEmbeddings = async () => {
    const res = await fetch(`${API_BASE}/v1/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth() },
      body: JSON.stringify({ model, input }),
    });
    const data = await res.json();
    if (!res.ok) {
      setOutput(JSON.stringify(data, null, 2));
      return;
    }
    const v: number[] = data.data[0].embedding;
    setOutput(
      `✓ вектор размерности ${v.length}\n\n[${v
        .slice(0, 8)
        .map((x) => x.toFixed(5))
        .join(', ')}, … ещё ${v.length - 8}]\n\nusage: ${JSON.stringify(data.usage)}`,
    );
  };

  const runChat = async () => {
    setOutput('');
    const res = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth() },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: input }],
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      const d = await res.json().catch(() => ({}));
      setOutput(JSON.stringify(d, null, 2));
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let acc = '';
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
            error?: { message?: string };
          };
          if (j.error) {
            acc += `\n[ошибка] ${j.error.message ?? ''}`;
          } else {
            acc += j.choices?.[0]?.delta?.content ?? '';
          }
          setOutput(acc);
        } catch {
          /* skip */
        }
      }
    }
  };

  const run = async () => {
    if (!apiKey.trim()) return toast('Вставьте API-ключ', 'err');
    if (!model) return toast('Выберите модель (нажмите «Загрузить модели»)', 'err');
    setRunning(true);
    try {
      await (mode === 'embeddings' ? runEmbeddings() : runChat());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка', 'err');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="page stack gap-3">
      <div className="page-head">
        <div>
          <h1>Песочница</h1>
          <p>
            Тестовые запросы к моделям вашим API-ключом. Ключ остаётся в браузере и шлётся
            прямо в <span className="mono">/v1/*</span>.
          </p>
        </div>
      </div>

      {/* ключ + модели */}
      <div className="panel">
        <div className="panel-body stack gap-2">
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="API-ключ (sk-emb-…)">
              <input
                className="input mono"
                style={{ minWidth: 320 }}
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
                <select
                  className="select"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <p className="faint" style={{ fontSize: '0.8rem' }}>
            Ключ нужен <b>одобренный</b>. Сырой ключ показывается один раз при создании — если
            потеряли, выпустите новый в разделе «Мои API-ключи».
          </p>
        </div>
      </div>

      {/* режим + ввод */}
      <div className="panel">
        <div className="panel-head">
          <div className="row gap-1">
            {(['chat', 'embeddings'] as Mode[]).map((m) => (
              <button
                key={m}
                className={`btn btn-sm ${mode === m ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => {
                  setMode(m);
                  setInput(EXAMPLES[m][0] ?? '');
                  setOutput('');
                }}
              >
                {m === 'chat' ? 'Чат' : 'Эмбеддинги'}
              </button>
            ))}
          </div>
        </div>
        <div className="panel-body stack gap-2">
          <div className="row gap-1" style={{ flexWrap: 'wrap' }}>
            {EXAMPLES[mode].map((ex) => (
              <button
                key={ex}
                className="btn btn-ghost btn-sm"
                onClick={() => setInput(ex)}
              >
                {ex.length > 28 ? ex.slice(0, 28) + '…' : ex}
              </button>
            ))}
          </div>
          <textarea
            className="input mono"
            style={{ minHeight: 96, height: 'auto', padding: '0.6rem 0.7rem', resize: 'vertical' }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={mode === 'chat' ? 'Ваше сообщение…' : 'Текст для эмбеддинга…'}
          />
          <div>
            <button className="btn btn-primary" onClick={run} disabled={running}>
              {running ? 'Выполняется…' : 'Выполнить ▸'}
            </button>
          </div>
        </div>
      </div>

      {/* вывод */}
      {output && (
        <div className="panel">
          <div className="panel-head">
            <span className="mono faint" style={{ fontSize: '0.78rem' }}>
              {mode === 'chat' ? 'ответ модели' : 'результат'}
            </span>
          </div>
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: '1rem 1.1rem',
              fontSize: '0.82rem',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--text)',
            }}
          >
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}
