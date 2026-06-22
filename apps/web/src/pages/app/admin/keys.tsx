import { AdminKeys } from '../../../components/admin-keys';

export default async function AdminKeysPage() {
  return <AdminKeys />;
}

export const getConfig = async () => ({ render: 'static' }) as const;
