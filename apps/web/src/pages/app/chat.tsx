import { Chat } from '../../components/chat';

export default async function ChatPage() {
  return <Chat />;
}

export const getConfig = async () => ({ render: 'static' }) as const;
