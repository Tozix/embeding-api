import { AuthForm } from '../components/auth-form';

export default async function LoginPage() {
  return <AuthForm mode="login" />;
}

export const getConfig = async () => ({ render: 'static' }) as const;
