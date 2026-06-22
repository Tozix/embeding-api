'use client';

import { useEffect, useState } from 'react';
import type { PublicUser } from '@embeding/schemas/auth';
import { api, ApiError } from '../lib/api';
import { relTime } from '../lib/format';
import { useToast } from './toast';
import { EmptyState, Spinner } from './ui';

type Page = { items: PublicUser[]; total: number; page: number; pageSize: number };

export function AdminUsers() {
  const { toast } = useToast();
  const [data, setData] = useState<Page | null>(null);
  const [page, setPage] = useState(1);

  const load = async (p = page) => {
    try {
      setData(await api<Page>(`/admin/users?page=${p}&pageSize=20`));
      setPage(p);
    } catch {
      toast('Не удалось загрузить пользователей', 'err');
    }
  };
  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = async (id: string, body: object, okMsg: string) => {
    try {
      await api(`/admin/users/${id}`, { method: 'PATCH', body });
      toast(okMsg, 'ok');
      await load();
    } catch (x) {
      toast(x instanceof ApiError ? x.message : 'Ошибка', 'err');
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Удалить пользователя? Его ключи и сессии будут удалены.')) return;
    try {
      await api(`/admin/users/${id}`, { method: 'DELETE' });
      toast('Пользователь удалён', 'ok');
      await load();
    } catch (x) {
      toast(x instanceof ApiError ? x.message : 'Ошибка', 'err');
    }
  };

  const pages = data ? Math.ceil(data.total / data.pageSize) : 1;

  return (
    <div className="page stack gap-3">
      <div className="page-head">
        <div>
          <h1>Пользователи</h1>
          <p>Роли, блокировка и удаление. Систему нельзя оставить без активного супер-админа.</p>
        </div>
        <span className="muted mono">{data?.total ?? 0}</span>
      </div>

      <div className="panel">
        {!data ? (
          <div className="panel-body">
            <Spinner label="Загрузка…" />
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState title="Нет пользователей" />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th>Роль</th>
                  <th>Статус</th>
                  <th>Регистрация</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div>{u.displayName || '—'}</div>
                      <div className="mono faint" style={{ fontSize: '0.78rem' }}>
                        {u.email}
                      </div>
                    </td>
                    <td>
                      <span
                        className={`badge ${u.role === 'SUPERADMIN' ? 'badge-warn' : 'badge-neutral'}`}
                      >
                        {u.role === 'SUPERADMIN' ? 'super-admin' : 'user'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${u.isActive ? 'badge-ok' : 'badge-err'}`}>
                        {u.isActive ? 'активен' : 'заблокирован'}
                      </span>
                    </td>
                    <td className="muted">{relTime(u.createdAt)}</td>
                    <td className="row-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          patch(
                            u.id,
                            { role: u.role === 'SUPERADMIN' ? 'USER' : 'SUPERADMIN' },
                            'Роль изменена',
                          )
                        }
                      >
                        {u.role === 'SUPERADMIN' ? 'Снять админа' : 'Сделать админом'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          patch(u.id, { isActive: !u.isActive }, 'Статус изменён')
                        }
                      >
                        {u.isActive ? 'Заблокировать' : 'Разблокировать'}
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(u.id)}>
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

      {data && pages > 1 && (
        <div className="row gap-1">
          <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => load(page - 1)}>
            Назад
          </button>
          <span className="muted mono">
            {page} / {pages}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            disabled={page >= pages}
            onClick={() => load(page + 1)}
          >
            Вперёд
          </button>
        </div>
      )}
    </div>
  );
}
