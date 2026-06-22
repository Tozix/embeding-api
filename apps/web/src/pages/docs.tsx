import { Docs } from '../components/docs';

export default async function DocsPage() {
  return <Docs />;
}

export const getConfig = async () => ({ render: 'static' }) as const;
