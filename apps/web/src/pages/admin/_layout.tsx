import type { ReactNode } from 'react';
import { AppShell } from '../../components/app-shell';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  return <AppShell requireAdmin>{children}</AppShell>;
}

export const getConfig = async () => ({ render: 'static' }) as const;
