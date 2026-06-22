import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@embeding/schemas/enums';
import { ROLES_KEY } from '../../common/constants';
import type { AuthenticatedRequest } from '../../common/types/auth-request';

/** Проверяет роль. Ставится ПОСЛЕ JwtAuthGuard (он наполняет req.user). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!roles || roles.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ForbiddenException('Недостаточно прав');
    }
    return true;
  }
}
