import '../styles.css';
import type { ReactNode } from 'react';
import { Providers } from '../components/providers';

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <title>embeding · OpenAI-совместимый шлюз к Ollama</title>
      <Providers>{children}</Providers>
    </>
  );
}

export const getConfig = async () => ({ render: 'static' }) as const;
