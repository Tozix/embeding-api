import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser } from '@embeding/schemas/auth';
import type { AuthenticatedRequest } from '../types/auth-request';

/** Достаёт нормализованного пользователя (req.user = {id,email,role}) или его поле. */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user) throw new UnauthorizedException();
    return field ? req.user[field] : req.user;
  },
);
