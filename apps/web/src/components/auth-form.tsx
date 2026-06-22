'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'waku';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Field } from './ui';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const { login, register, user, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isLogin = mode === 'login';

  useEffect(() => {
    if (!loading && user) window.location.assign('/app/keys');
  }, [loading, user]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (isLogin) await login(email, password);
      else await register(email, password, displayName || undefined);
      window.location.assign('/app/keys');
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Не удалось выполнить запрос');
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card stack gap-2" onSubmit={submit}>
        <div className="brand" style={{ padding: '0 0 0.25rem' }}>
          <span className="dot" />
          <span>embeding</span>
        </div>
        <div>
          <h2>{isLogin ? 'Вход' : 'Создание аккаунта'}</h2>
          <p className="muted" style={{ margin: '0.3rem 0 0', fontSize: '0.88rem' }}>
            {isLogin
              ? 'Войдите, чтобы управлять ключами.'
              : 'Зарегистрируйтесь и выпустите первый ключ.'}
          </p>
        </div>

        {!isLogin && (
          <Field label="Имя (необязательно)">
            <input
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Ваше имя"
              autoComplete="name"
            />
          </Field>
        )}
        <Field label="Email">
          <input
            className="input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </Field>
        <Field label="Пароль">
          <input
            className="input"
            type="password"
            required
            minLength={isLogin ? 1 : 8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isLogin ? '' : 'минимум 8 символов'}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
          />
        </Field>

        {err && <div className="field-error">{err}</div>}

        <button className="btn btn-primary" disabled={busy} type="submit">
          {busy ? <span className="spinner" /> : isLogin ? 'Войти' : 'Создать аккаунт'}
        </button>

        <p className="muted" style={{ fontSize: '0.85rem', textAlign: 'center', margin: 0 }}>
          {isLogin ? (
            <>
              Нет аккаунта?{' '}
              <Link to="/register" style={{ color: 'var(--accent)' }}>
                Создать
              </Link>
            </>
          ) : (
            <>
              Уже есть аккаунт?{' '}
              <Link to="/login" style={{ color: 'var(--accent)' }}>
                Войти
              </Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
