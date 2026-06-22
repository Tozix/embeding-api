'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { AuthResult, PublicUser } from '@embeding/schemas/auth';
import { api, bootstrapSession, setAccessToken } from './api';

type AuthContextValue = {
  user: PublicUser | null;
  loading: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (await bootstrapSession()) {
          const me = await api<PublicUser>('/auth/me');
          if (alive) setUser(me);
        }
      } catch {
        /* нет валидной сессии */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<AuthResult>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setAccessToken(res.accessToken);
    setUser(res.user);
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const res = await api<AuthResult>('/auth/register', {
        method: 'POST',
        body: { email, password, ...(displayName ? { displayName } : {}) },
      });
      setAccessToken(res.accessToken);
      setUser(res.user);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* всё равно чистим локально */
    }
    setAccessToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    setUser(await api<PublicUser>('/auth/me'));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdmin: user?.role === 'SUPERADMIN',
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth должен использоваться внутри AuthProvider');
  return ctx;
}
