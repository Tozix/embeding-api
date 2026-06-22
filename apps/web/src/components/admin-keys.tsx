'use client';

import { useEffect, useState } from 'react';
import type { ApiKeyPublic } from '@embeding/schemas/auth';
import { api, ApiError } from '../lib/api';
import { relTime } from '../lib/format';
import { useToast } from './toast';
import { EmptyState, Spinner, StatusBadge } from './ui';

type Row = ApiKeyPublic & { userId: string };
type Page = { items: Row[]; total: number; page: number; pageSize: number };

const FILTERS = [
  { v: '', label: 'Все' },
  { v: 'PENDING', label: 'Ожидают' },
  { v: 'APPROVED', label: 'Одобренные' },
  { v: 'REVOKED', label: 'Отозванные' },
];

export function AdminKeys() {
  const { toast } = useToast();
  const [data, setData] = useState<Page | null>(null);
  const [status, setStatus] = useState('');

  const load = async (s = status) => {
    try {
      const q = s ? `&status=${s}` : '';
      setData(await api<Page>(`/admin/keys?page=1&pageSize=50${q}`));
      setStatus(s);
    } catch {
      toast('Не удалось загрузить ключи', 'err');
    }
  };
  useEffect(() => {
    void load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (id: string, action: 'approve' | 'revoke') => {
    try {
      await api(`/admin/keys/${id}/${action}`, { method: 'POST' });
      toast(action === 'approve' ? 'Ключ одобрен' : 'Ключ отозван', 'ok');
      await load();
    } catch (x) {
      toast(x instanceof ApiError ? x.message : 'Ошибка', 'err');
    }
  };

  const pending = data?.items.filter((k) => k.status === 'PENDING').length ?? 0;

  return (
    <div className="page stack gap-3">
      <div className="page-head">
        <div>
          <h1>Ключи</h1>
          <p>Модерация ключей всех пользователей. До одобрения ключ не работает на /v1.</p>
        </div>
        {pending > 0 && <span className="badge badge-warn">{pending} ждут одобрения</span>}
      </div>

      <div className="row gap-1 wrap">
        {FILTERS.map((f) => (
          <button
            key={f.v}
            className={`btn btn-sm ${status === f.v ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => load(f.v)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="panel">
        {!data ? (
          <div className="panel-body">
            <Spinner label="Загрузка…" />
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState title="Ключей не найдено" />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Префикс</th>
                  <th>Пользователь</th>
                  <th>Статус</th>
                  <th>Создан</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td className="mono muted">{k.keyPrefix}</td>
                    <td className="mono faint" style={{ fontSize: '0.78rem' }}>
                      {k.userId.slice(0, 12)}…
                    </td>
                    <td>
                      <StatusBadge status={k.status} />
                    </td>
                    <td className="muted">{relTime(k.createdAt)}</td>
                    <td className="row-actions">
                      {k.status === 'PENDING' && (
                        <button className="btn btn-primary btn-sm" onClick={() => act(k.id, 'approve')}>
                          Одобрить
                        </button>
                      )}
                      {k.status !== 'REVOKED' && (
                        <button className="btn btn-danger btn-sm" onClick={() => act(k.id, 'revoke')}>
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
