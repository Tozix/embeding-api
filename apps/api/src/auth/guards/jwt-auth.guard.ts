import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/constants';
import type { AuthenticatedRequest } from '../../common/types/auth-request';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../token.service';

/** Защищает веб/админ-маршруты по access-JWT. Нормализует req.user = {id,email,role}. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Требуется Bearer access-токен');
    }

    let payload;
    try {
      payload = await this.tokens.verifyAccessToken(header.slice(7));
    } catch {
      throw new UnauthorizedException('Невалидный или истёкший токен');
    }

    // Перепроверяем актуальное состояние пользователя в БД (а не из токена): блокировка,
    // удаление и смена роли вступают в силу немедленно, не дожидаясь истечения access-JWT.
    // Веб/админ-трафик низкочастотный — лишний запрос приемлем; /v1/* идёт мимо (ApiKeyGuard).
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { isActive: true, role: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Учётная запись недоступна');
    }
    req.user = { id: payload.sub, email: payload.email, role: user.role };
    return true;
  }
}
