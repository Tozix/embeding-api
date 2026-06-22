'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, streamPost } from '../lib/api';
import { useToast } from './toast';
import { EmptyState, Spinner } from './ui';

type Model = {
  id: string;
  ollamaName: string;
  displayName: string;
  kind: 'EMBEDDING' | 'CHAT';
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  loaded: boolean;
  sizeBytes: number;
  expiresAt: string | null;
};

function fmtSize(b: number): string {
  if (!b) return '';
  return b >= 1e9 ? `${(b / 1e9).toFixed(1)} ГБ` : `${Math.round(b / 1e6)} МБ`;
}

export function AdminModels() {
  const { toast } = useToast();
  const [models, setModels] = useState<Model[] | null>(null);
  const [ollamaName, setOllamaName] = useState('');
  const [kind, setKind] = useState<'EMBEDDING' | 'CHAT'>('CHAT');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [memBusy, setMemBusy] = useState<string | null>(null);
  const [pulling, setPulling] = useState<
    Record<string, { status: string; pct: number }>
  >({});

  // /admin/models/runtime отдаёт модели + их статус в памяти (Ollama /api/ps).
  const fetchModels = async (silent = false) => {
    try {
      setModels(await api<Model[]>('/admin/models/runtime'));
    } catch {
      if (!silent) toast('Не удалось загрузить модели', 'err');
    }
  };

  useEffect(() => {
    void fetchModels();
    const t = setInterval(() => void fetchModels(true), 3000); // real-time статус памяти
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!ollamaName.trim()) return;
    setBusy(true);
    try {
      await api('/admin/models', {
        method: 'POST',
        body: { ollamaName: ollamaName.trim(), kind, isEnabled: enabled },
      });
      toast('Модель добавлена', 'ok');
      setOllamaName('');
      await fetchModels();
    } catch (x) {
      toast(x instanceof ApiError ? x.message : 'Ошибка', 'err');
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    try {
      const r = await api<{ added: string[]; total: number }>('/admin/models/sync', {
        method: 'POST',
      });
      toast(`Синхронизация: +${r.added.length} из ${r.total} в Ollama`, 'ok');
      await fetchModels();
    } catch (x) {
      toast(x instanceof ApiError ? x.message : 'Ollama недоступна', 'err');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (m: Model) => {
    try {
      await api(`/admin/models/${m.id}`, {
        method: 'PATCH',
        body: { isEnabled: !m.isEnabled },
      });
      await fetchModels();
    } catch (x) {
      toast(x instanceof ApiError ? x.message : 'Ошибка', 'err');
    }
  };

  // Скачивание модели в Ollama со стримингом прогресса (для моделей, которых ещё нет локально).
  const pull = async (m: Model) => {
    if (pulling[m.id]) return;
    setPulling((p) => ({ ...p, [m.id]: { status: 'старт…', pct: 0 } }));
    let failed = false;
    try {
      await streamPost(`/admin/models/${m.id}/pull`, {}, (data) => {
        const d = data as {
          status?: string;
          total?: number;
          completed?: number;
          error?: string;
        };
        if (d.error) {
          failed = true;
          toast(`Скачивание: ${d.error}`, 'err');
          return;
        }
        const pct =
          d.total && d.completed ? Math.round((d.completed / d.total) * 100) : 0;
        setPulling((p) => ({ ...p, [m.id]: { status: d.status ?? '', pct } }));
      });
      if (!failed) {
        toast(`${m.displayName}: скачана`, 'ok');
        await fetchModels();
      }
    } catch (x) {
      toast(x instanceof ApiError ? x.message : 'Ошибка скачивания', 'err');
    } finally {
      setPulling((p) => {
        const c = { ...p };
        delete c[m.id];
        return c;
      });
    }
  };

  // Загрузка/выгрузка модели в память (прогрев). Загрузка может занять время — блокируем кнопку.
  const setMem = async (m: Model, action: 'load' | 'unload') => {
    setMemBusy(m.id);
    try {
      await api(`/admin/models/${m.id}/${action}`, { method: 'POST' });
      toast(
        action === 'load' ? `${m.displayName}: загружена в память` : `${m.displayName}: выгружена`,
        'ok',
      );
      await fetchModels();
    } catch (x) {
      toast(x instanceof ApiError ? x.message : 'Ошибка', 'err');
    } finally {
      setMemBusy(null);
    }
  };

  const remove = async (m: Model) => {
    if (!window.confirm(`Удалить модель ${m.displayName}?`)) return;
    try {
      await api(`/admin/models/${m.id}`, { method: 'DELETE' });
      toast('Модель удалена', 'ok');
      await fetchModels();
    } catch (x) {
      toast(x instanceof ApiError ? x.message : 'Ошибка', 'err');
    }
  };

  return (
    <div className="page stack gap-3">
      <div className="page-head">
        <div>
          <h1>Модели</h1>
          <p>
            Доступность через шлюз и управление памятью: загрузка/выгрузка моделей и live-статус
            прогрева (обновляется каждые 3 с).
          </p>
        </div>
        <button className="btn btn-ghost" disabled={busy} onClick={sync}>
          {busy ? <span className="spinner" /> : 'Синхронизировать с Ollama'}
        </button>
      </div>

      <form className="panel" onSubmit={create}>
        <div className="panel-body row gap-2 wrap">
          <input
            className="input grow mono"
            placeholder="имя в Ollama, напр. nomic-embed-text"
            value={ollamaName}
            onChange={(e) => setOllamaName(e.target.value)}
            style={{ minWidth: 240 }}
          />
          <select
            className="select"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'EMBEDDING' | 'CHAT')}
          >
            <option value="CHAT">chat</option>
            <option value="EMBEDDING">embedding</option>
          </select>
          <label className="row gap-1" style={{ fontSize: '0.85rem' }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            включить сразу
          </label>
          <button className="btn btn-primary" disabled={busy || !ollamaName.trim()} type="submit">
            Добавить
          </button>
        </div>
      </form>

      <div className="panel">
        {!models ? (
          <div className="panel-body">
            <Spinner label="Загрузка…" />
          </div>
        ) : models.length === 0 ? (
          <EmptyState title="Моделей нет">
            Добавьте вручную или синхронизируйте с Ollama.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Имя (OpenAI)</th>
                  <th>Тип</th>
                  <th>Доступность</th>
                  <th>В памяти</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="mono">{m.displayName}</div>
                      <div className="mono faint" style={{ fontSize: '0.76rem' }}>
                        {m.ollamaName}
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-neutral">{m.kind.toLowerCase()}</span>
                    </td>
                    <td>
                      <span className={`badge ${m.isEnabled ? 'badge-ok' : 'badge-neutral'}`}>
                        {m.isEnabled ? 'включена' : 'выключена'}
                      </span>
                    </td>
                    <td>
                      {pulling[m.id] ? (
                        <span className="badge badge-warn">
                          ↓ {pulling[m.id]?.pct ?? 0}%{' '}
                          {(pulling[m.id]?.status ?? '').slice(0, 16)}
                        </span>
                      ) : memBusy === m.id ? (
                        <span className="badge badge-warn">
                          <span className="spinner" /> прогрев…
                        </span>
                      ) : m.loaded ? (
                        <span className="badge badge-ok">
                          ● в памяти{m.sizeBytes ? ` · ${fmtSize(m.sizeBytes)}` : ''}
                        </span>
                      ) : (
                        <span className="badge badge-neutral">○ выгружена</span>
                      )}
                    </td>
                    <td className="row-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={!!pulling[m.id]}
                        onClick={() => pull(m)}
                      >
                        {pulling[m.id] ? `↓ ${pulling[m.id]?.pct ?? 0}%` : 'Скачать'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={memBusy === m.id || !!pulling[m.id]}
                        onClick={() => setMem(m, m.loaded ? 'unload' : 'load')}
                      >
                        {m.loaded ? 'Выгрузить' : 'Загрузить'}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => toggle(m)}>
                        {m.isEnabled ? 'Выключить' : 'Включить'}
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(m)}>
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
