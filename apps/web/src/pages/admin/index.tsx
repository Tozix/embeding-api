import { Dashboard } from '../../components/dashboard';

export default async function AdminIndexPage() {
  return <Dashboard />;
}

export const getConfig = async () => ({ render: 'static' }) as const;
