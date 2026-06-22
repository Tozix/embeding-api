'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { ApiKeyCreated, ApiKeyPublic } from '@embeding/schemas/auth';
import { api, ApiError } from '../lib/api';
import { relTime } from '../lib/format';
import { useToast } from './toast';
import { CopyButton, EmptyState, Spinner, StatusBadge } from './ui';

export function KeysPanel() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyPublic[] | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<ApiKeyCreated | null>(null);

  const load = async () => {
    try {
      setKeys(await api<ApiKeyPublic[]>('/keys'));
    } catch {
      toast('Не удалось загрузить ключи', 'err');
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const k = await api<ApiKeyCreated>('/keys', {
        method: 'POST',
        body: { name: name.trim() },
      });
      setRevealed(k);
      setName('');
      toast('Ключ создан. Ждёт одобрения супер-админом.', 'ok');
      await load();
    } catch (x) {
      toast(x instanceof ApiError ? x.message : 'Ошибка создания', 'err');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api(`/keys/${id}`, { method: 'DELETE' });
      toast('Ключ отозван', 'ok');
      await load();
    } catch {
      toast('Не удалось отозвать ключ', 'err');
    }
  };

  return (
    <div className="page stack gap-3">
      <div className="page-head">
        <div>
          <h1>API-ключи</h1>
          <p>
            Ключи для доступа к <span className="mono">/v1</span>. Новый ключ заработает после
            одобрения супер-админом.
          </p>
        </div>
      </div>

      {revealed && (
        <div
          className="panel"
          style={{ borderColor: 'color-mix(in oklch, var(--accent) 45%, var(--border))' }}
        >
          <div className="panel-head">
            <strong>Ключ создан — сохраните его сейчас</strong>
            <span className="badge badge-warn">показывается один раз</span>
          </div>
          <div className="panel-body stack gap-2">
            <div className="key-reveal">
              <span className="grow">{revealed.key}</span>
              <CopyButton value={revealed.key} />
            </div>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              Полный ключ больше не будет показан. Текущий статус — <StatusBadge status={revealed.status} />.
            </p>
            <div>
              <button className="btn btn-ghost btn-sm" onClick={() => setRevealed(null)}>
                Я сохранил, скрыть
              </button>
            </div>
          </div>
        </div>
      )}

      <form className="panel" onSubmit={create}>
        <div className="panel-body row gap-2 wrap">
          <input
            className="input grow"
            placeholder="Название ключа, напр. «прод-бэкенд»"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            style={{ minWidth: 240 }}
          />
          <button className="btn btn-primary" disabled={creating || !name.trim()} type="submit">
            {creating ? <span className="spinner" /> : 'Создать ключ'}
          </button>
        </div>
      </form>

      <div className="panel">
        <div className="panel-head">
          <h2>Ваши ключи</h2>
          <span className="muted mono">{keys?.length ?? 0}</span>
        </div>
        {keys === null ? (
          <div className="panel-body">
            <Spinner label="Загрузка…" />
          </div>
        ) : keys.length === 0 ? (
          <EmptyState title="Ключей пока нет">Создайте первый ключ выше.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Префикс</th>
                  <th>Статус</th>
                  <th>Создан</th>
                  <th>Последний вызов</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td className="mono muted">{k.keyPrefix}</td>
                    <td>
                      <StatusBadge status={k.status} />
                    </td>
                    <td className="muted">{relTime(k.createdAt)}</td>
                    <td className="muted">{k.lastUsedAt ? relTime(k.lastUsedAt) : '—'}</td>
                    <td className="row-actions">
                      {k.status !== 'REVOKED' && (
                        <button className="btn btn-danger btn-sm" onClick={() => revoke(k.id)}>
                          Отозвать
                        </button>
                      )}
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
