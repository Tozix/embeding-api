import { AuthForm } from '../components/auth-form';

export default async function RegisterPage() {
  return <AuthForm mode="register" />;
}

export const getConfig = async () => ({ render: 'static' }) as const;
