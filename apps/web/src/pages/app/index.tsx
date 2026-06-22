import { KeysPanel } from '../../components/keys-panel';

export default async function AppIndexPage() {
  return <KeysPanel />;
}

export const getConfig = async () => ({ render: 'static' }) as const;
