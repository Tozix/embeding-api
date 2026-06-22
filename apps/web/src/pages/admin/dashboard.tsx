import { Dashboard } from '../../components/dashboard';

export default async function DashboardPage() {
  return <Dashboard />;
}

export const getConfig = async () => ({ render: 'static' }) as const;
