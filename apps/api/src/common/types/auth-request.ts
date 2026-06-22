import type { Request } from 'express';
import type { AuthUser } from '@embeding/schemas/auth';

/** Контекст API-ключа, который ApiKeyGuard кладёт в req после успешной проверки. */
export type ApiKeyContext = {
  id: string;
  userId: string;
  keyPrefix: string;
  // null = ограничения по моделям нет (доступ ко всем globally enabled);
  // непустой массив = ключ ограничен этими id моделей.
  allowedModelIds: string[] | null;
};

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  apiKey?: ApiKeyContext;
}
