import { Landing } from '../components/landing';

export default async function HomePage() {
  return <Landing />;
}

export const getConfig = async () => ({ render: 'static' }) as const;
