import { AdminModels } from '../../components/admin-models';

export default async function ModelsPage() {
  return <AdminModels />;
}

export const getConfig = async () => ({ render: 'static' }) as const;
