import { AdminUsers } from '../../../components/admin-users';

export default async function UsersPage() {
  return <AdminUsers />;
}

export const getConfig = async () => ({ render: 'static' }) as const;
