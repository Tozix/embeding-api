'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useRouter } from 'waku';
import { useAuth } from '../lib/auth';

const USER_NAV = [
  { to: '/app/keys', label: 'Мои API-ключи' },
  { to: '/app/chat', label: 'Чат с моделью' },
  { to: '/app/playground', label: 'Песочница' },
] as const;
// Админка живёт под /app/admin/* — в одном SPA-неймспейсе /app/* (а НЕ на /admin/*, который
// занят API). Так nginx остаётся простым path-роутингом без разбора Accept. См. infra/nginx.
const ADMIN_NAV = [
  { to: '/app/admin/dashboard', label: 'Дашборд нагрузки' },
  { to: '/app/admin/users', label: 'Пользователи' },
  { to: '/app/admin/keys', label: 'Ключи' },
  { to: '/app/admin/models', label: 'Модели' },
] as const;

function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    const saved = (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
  }, []);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => {
        const next = theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
        document.documentElement.dataset.theme = next;
        localStorage.setItem('theme', next);
      }}
    >
      {theme === 'dark' ? 'Светлая' : 'Тёмная'}
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, isAdmin, logout } = useAuth();
  // Реактивный путь из роутера Waku — обновляется при client-side навигации (shell не перемонтируется).
  const { path } = useRouter();
  // Админ-зона определяется по пути (/app/admin/*), а не отдельным лэйаутом — иначе был бы
  // двойной AppShell. Не-админа уводим в кабинет; API всё равно закрыт RolesGuard.
  const requireAdmin = path.startsWith('/app/admin');
  useEffect(() => {
    if (loading) return;
    if (!user) window.location.assign('/login');
    else if (requireAdmin && !isAdmin) window.location.assign('/app/keys');
  }, [loading, user, requireAdmin, isAdmin]);

  if (loading || !user || (requireAdmin && !isAdmin)) {
    return (
      <div className="auth-wrap">
        <span className="spinner" />
      </div>
    );
  }

  const active = (to: string) =>
    path === to || path.startsWith(`${to}/`) ? 'page' : undefined;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="dot" />
          <span>embeding</span>
        </div>

        <div className="nav-section">Аккаунт</div>
        {USER_NAV.map((n) => (
          <Link key={n.to} to={n.to} className="nav-link" aria-current={active(n.to)}>
            {n.label}
          </Link>
        ))}

        {isAdmin && (
          <>
            <div className="nav-section">Администрирование</div>
            {ADMIN_NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="nav-link"
                aria-current={active(n.to)}
              >
                {n.label}
              </Link>
            ))}
          </>
        )}

        <div className="sidebar-foot">
          <div className="grow" style={{ overflow: 'hidden' }}>
            <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user.displayName || user.email}
            </div>
            <div className="faint mono" style={{ fontSize: '0.72rem' }}>
              {user.role === 'SUPERADMIN' ? 'super-admin' : 'user'}
            </div>
          </div>
        </div>
      </aside>

      <div className="content">
        <div className="topbar">
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            OpenAI-совместимый шлюз к Ollama
          </div>
          <div className="row gap-1">
            <ThemeToggle />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => logout().then(() => window.location.assign('/login'))}
            >
              Выйти
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
