import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyStatus } from '../prisma/client';
import { hashApiKey } from '../common/crypto/api-key';
import { openAiErrors } from '../common/http/openai-error';
import type { AuthenticatedRequest } from '../common/types/auth-request';
import type { Env } from '../config/env';

const TOUCH_THROTTLE_MS = 60_000;

/**
 * Защита /v1/*: Bearer API-ключ работает ТОЛЬКО в статусе APPROVED.
 * Все ошибки — в OpenAI-конверте (через openAiErrors → AllExceptionsFilter).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly pepper: string;
  private readonly lastTouch = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.pepper = config.get('APIKEY_HMAC_SECRET', { infer: true });
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw openAiErrors.authentication('Missing bearer API key');
    }

    const keyHash = hashApiKey(header.slice(7).trim(), this.pepper);
    const key = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        allowedModels: { select: { modelId: true } },
        user: { select: { isActive: true } },
      },
    });

    if (!key) throw openAiErrors.authentication('Invalid API key');
    if (key.status === ApiKeyStatus.PENDING) {
      throw openAiErrors.permission('API key is pending administrator approval');
    }
    if (key.status === ApiKeyStatus.REVOKED) {
      throw openAiErrors.authentication('API key has been revoked');
    }
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
      throw openAiErrors.authentication('API key has expired');
    }
    if (!key.user.isActive) {
      throw openAiErrors.permission('Account is disabled');
    }

    req.apiKey = {
      id: key.id,
      userId: key.userId,
      keyPrefix: key.keyPrefix,
      // null = без ограничения по моделям; иначе — список разрешённых id
      allowedModelIds: key.allowedModels.length
        ? key.allowedModels.map((m) => m.modelId)
        : null,
    };

    this.touchLastUsed(key.id);
    return true;
  }

  /** Обновление lastUsedAt вне горячего пути, с throttle, fire-and-forget. */
  private touchLastUsed(id: string): void {
    const now = Date.now();
    if (now - (this.lastTouch.get(id) ?? 0) < TOUCH_THROTTLE_MS) return;
    this.lastTouch.set(id, now);
    // лёгкая эвикция, чтобы Map не рос бесконечно при большом числе ключей
    if (this.lastTouch.size > 5000) {
      for (const [k, ts] of this.lastTouch) {
        if (now - ts >= TOUCH_THROTTLE_MS) this.lastTouch.delete(k);
      }
    }
    void this.prisma.apiKey
      .update({ where: { id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
}
