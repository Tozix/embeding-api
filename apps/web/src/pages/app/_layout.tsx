import type { ReactNode } from 'react';
import { AppShell } from '../../components/app-shell';

export default async function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

export const getConfig = async () => ({ render: 'static' }) as const;
