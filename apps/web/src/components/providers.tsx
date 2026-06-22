'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '../lib/auth';
import { ToastProvider } from './toast';

/** Клиентская обёртка приложения: тосты + auth-сессия. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}
