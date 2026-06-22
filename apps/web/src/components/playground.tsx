'use client';

import { useEffect, useState } from 'react';
import { Link } from 'waku';
import { api, ApiError, streamPost } from '../lib/api';
import { useToast } from './toast';
import { Field } from './ui';

type Mode = 'chat' | 'embeddings';
type KeyOpt = { id: string; name: string; keyPrefix: string };
type ModelOpt = { id: string; kind: 'CHAT' | 'EMBEDDING' };

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
  const [keys, setKeys] = useState<KeyOpt[]>([]);
  const [keyId, setKeyId] = useState('');
  const [allModels, setAllModels] = useState<ModelOpt[]>([]);
  const [model, setModel] = useState('');
  const [mode, setMode] = useState<Mode>('chat');
  const [input, setInput] = useState(EXAMPLES.chat[0] ?? '');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void api<KeyOpt[]>('/me/playground/keys')
      .then((ks) => {
        setKeys(ks);
        if (ks[0]) setKeyId(ks[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!keyId) {
      setAllModels([]);
      return;
    }
    void api<ModelOpt[]>(`/me/playground/keys/${keyId}/models`)
      .then(setAllModels)
      .catch(() => setAllModels([]));
  }, [keyId]);

  // модели текущего режима (чат → только CHAT, эмбеддинги → только EMBEDDING)
  const models = allModels.filter((m) =>
    mode === 'chat' ? m.kind === 'CHAT' : m.kind === 'EMBEDDING',
  );

  useEffect(() => {
    if (models.length && !models.some((m) => m.id === model)) {
      setModel(models[0]!.id);
    } else if (!models.length) {
      setModel('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, allModels]);

  const runEmbeddings = async () => {
    const data = await api<{
      data: { embedding: number[] }[];
      usage: unknown;
    }>(`/me/playground/keys/${keyId}/embeddings`, {
      method: 'POST',
      body: { model, input },
    });
    const v = data.data[0]!.embedding;
    setOutput(
      `✓ вектор размерности ${v.length}\n\n[${v
        .slice(0, 8)
        .map((x) => x.toFixed(5))
        .join(', ')}, … ещё ${v.length - 8}]\n\nusage: ${JSON.stringify(data.usage)}`,
    );
  };

  const runChat = async () => {
    setOutput('');
    let acc = '';
    await streamPost(
      `/me/playground/keys/${keyId}/chat`,
      { model, messages: [{ role: 'user', content: input }], stream: true },
      (data) => {
        const j = data as {
          choices?: { delta?: { content?: string } }[];
          error?: { message?: string };
        };
        if (j.error) acc += `\n[ошибка] ${j.error.message ?? ''}`;
        else acc += j.choices?.[0]?.delta?.content ?? '';
        setOutput(acc);
      },
    );
  };

  const run = async () => {
    if (!keyId) return toast('Выберите ключ', 'err');
    if (!model) return toast('Нет доступной модели для этого режима', 'err');
    setRunning(true);
    try {
      await (mode === 'embeddings' ? runEmbeddings() : runChat());
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'err');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="page stack gap-3">
      <div className="page-head">
        <div>
          <h1>Песочница</h1>
          <p>Тестовые запросы к моделям одним из ваших одобренных ключей — эмбеддинги и чат.</p>
        </div>
      </div>

      {/* ключ + модель */}
      <div className="panel">
        <div className="panel-body stack gap-2">
          {keys.length === 0 ? (
            <p className="muted">
              Нет одобренных ключей.{' '}
              <Link to="/app/keys" className="link">
                Создайте ключ
              </Link>{' '}
              и дождитесь одобрения супер-админом.
            </p>
          ) : (
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label="Ключ">
                <select className="select" value={keyId} onChange={(e) => setKeyId(e.target.value)}>
                  {keys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} ({k.keyPrefix})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Модель">
                <select
                  className="select"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={models.length === 0}
                >
                  {models.length === 0 ? (
                    <option value="">нет {mode === 'chat' ? 'chat' : 'embedding'}-моделей</option>
                  ) : (
                    models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))
                  )}
                </select>
              </Field>
            </div>
          )}
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
              <button key={ex} className="btn btn-ghost btn-sm" onClick={() => setInput(ex)}>
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
            <button className="btn btn-primary" onClick={run} disabled={running || !model}>
              {running ? 'Выполняется…' : 'Выполнить ▸'}
            </button>
          </div>
        </div>
      </div>

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
