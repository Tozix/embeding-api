import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiKeyContext,
  AuthenticatedRequest,
} from '../types/auth-request';

/** Достаёт контекст API-ключа (req.apiKey), проверенный ApiKeyGuard, или его поле. */
export const CurrentApiKey = createParamDecorator(
  (field: keyof ApiKeyContext | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.apiKey) throw new UnauthorizedException();
    return field ? req.apiKey[field] : req.apiKey;
  },
);
