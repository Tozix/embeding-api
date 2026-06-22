import { Playground } from '../../components/playground';

export default async function PlaygroundPage() {
  return <Playground />;
}

export const getConfig = async () => ({ render: 'static' }) as const;
