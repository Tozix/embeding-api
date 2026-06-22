import { KeysPanel } from '../../components/keys-panel';

export default async function KeysPage() {
  return <KeysPanel />;
}

export const getConfig = async () => ({ render: 'static' }) as const;
