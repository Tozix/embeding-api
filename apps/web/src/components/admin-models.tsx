'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
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
};

export function AdminModels() {
  const { toast } = useToast();
  const [models, setModels] = useState<Model[] | null>(null);
  const [ollamaName, setOllamaName] = useState('');
  const [kind, setKind] = useState<'EMBEDDING' | 'CHAT'>('CHAT');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setModels(await api<Model[]>('/admin/models'));
    } catch {
      toast('Не удалось загрузить модели', 'err');
    }
  };
  useEffect(() => {
    void load();
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
      await load();
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
      await load();
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
      await load();
    } catch (x) {
      toast(x instanceof ApiError ? x.message : 'Ошибка', 'err');
    }
  };

  const remove = async (m: Model) => {
    if (!window.confirm(`Удалить модель ${m.displayName}?`)) return;
    try {
      await api(`/admin/models/${m.id}`, { method: 'DELETE' });
      toast('Модель удалена', 'ok');
      await load();
    } catch (x) {
      toast(x instanceof ApiError ? x.message : 'Ошибка', 'err');
    }
  };

  return (
    <div className="page stack gap-3">
      <div className="page-head">
        <div>
          <h1>Модели</h1>
          <p>Какие модели Ollama доступны через шлюз. Включённые видны всем одобренным ключам.</p>
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
                  <th>Ollama</th>
                  <th>Тип</th>
                  <th>Доступность</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{m.displayName}</td>
                    <td className="mono muted">{m.ollamaName}</td>
                    <td>
                      <span className="badge badge-neutral">{m.kind.toLowerCase()}</span>
                    </td>
                    <td>
                      <span className={`badge ${m.isEnabled ? 'badge-ok' : 'badge-neutral'}`}>
                        {m.isEnabled ? 'включена' : 'выключена'}
                      </span>
                    </td>
                    <td className="row-actions">
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
