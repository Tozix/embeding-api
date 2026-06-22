import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ApiKeyCreated,
  ApiKeyPublic,
  CreateApiKeyInput,
} from '@embeding/schemas/auth';
import type { AdminKeysQuery } from '@embeding/schemas/admin';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyStatus } from '../prisma/client';
import { generateApiKey, hashApiKey } from '../common/crypto/api-key';
import type { Env } from '../config/env';

type DbApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  status: ApiKeyStatus;
  createdAt: Date;
  approvedAt: Date | null;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
};

function toApiKeyPublic(k: DbApiKey): ApiKeyPublic {
  return {
    id: k.id,
    name: k.name,
    keyPrefix: k.keyPrefix,
    status: k.status,
    createdAt: k.createdAt.toISOString(),
    approvedAt: k.approvedAt?.toISOString() ?? null,
    expiresAt: k.expiresAt?.toISOString() ?? null,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  };
}

type CreateInput = Pick<CreateApiKeyInput, 'name' | 'modelIds' | 'expiresAt'>;

@Injectable()
export class ApiKeyService {
  private readonly pepper: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.pepper = config.get('APIKEY_HMAC_SECRET', { infer: true });
  }

  /**
   * Создаёт ключ. По умолчанию PENDING (пользовательский путь). autoApprove=true —
   * для админского создания ключа пользователю (сразу APPROVED).
   * Сырой ключ возвращается ОДИН раз в поле `key`.
   */
  async create(
    userId: string,
    input: CreateInput,
    opts?: { autoApprove?: boolean; approvedBy?: string },
  ): Promise<ApiKeyCreated> {
    await this.assertModelsExist(input.modelIds);

    const { raw, prefix } = generateApiKey();
    const approve = opts?.autoApprove ?? false;
    const created = await this.prisma.apiKey.create({
      data: {
        userId,
        name: input.name,
        keyPrefix: prefix,
        keyHash: hashApiKey(raw, this.pepper),
        status: approve ? ApiKeyStatus.APPROVED : ApiKeyStatus.PENDING,
        approvedBy: approve ? (opts?.approvedBy ?? null) : null,
        approvedAt: approve ? new Date() : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        allowedModels: input.modelIds?.length
          ? { create: input.modelIds.map((modelId) => ({ modelId })) }
          : undefined,
      },
    });
    return { ...toApiKeyPublic(created), key: raw };
  }

  async listForUser(userId: string): Promise<ApiKeyPublic[]> {
    const rows = await this.prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toApiKeyPublic);
  }

  /** Отзыв собственного ключа (пользовательский путь). Идемпотентно. */
  async revokeOwn(userId: string, id: string): Promise<void> {
    const key = await this.prisma.apiKey.findFirst({ where: { id, userId } });
    if (!key) throw new NotFoundException('Ключ не найден');
    if (key.status !== ApiKeyStatus.REVOKED) {
      await this.prisma.apiKey.update({
        where: { id },
        data: { status: ApiKeyStatus.REVOKED },
      });
    }
  }

  // ---------- админские операции ----------

  async approve(id: string, adminId: string): Promise<ApiKeyPublic> {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException('Ключ не найден');
    if (key.status === ApiKeyStatus.REVOKED) {
      throw new ConflictException('Нельзя одобрить отозванный ключ');
    }
    if (key.status === ApiKeyStatus.APPROVED) return toApiKeyPublic(key); // идемпотентно
    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: {
        status: ApiKeyStatus.APPROVED,
        approvedBy: adminId,
        approvedAt: new Date(),
      },
    });
    return toApiKeyPublic(updated);
  }

  async revoke(id: string): Promise<ApiKeyPublic> {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException('Ключ не найден');
    if (key.status === ApiKeyStatus.REVOKED) return toApiKeyPublic(key);
    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: { status: ApiKeyStatus.REVOKED },
    });
    return toApiKeyPublic(updated);
  }

  async listAll(query: AdminKeysQuery): Promise<{
    items: (ApiKeyPublic & { userId: string })[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.apiKey.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.apiKey.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({ ...toApiKeyPublic(r), userId: r.userId })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private async assertModelsExist(modelIds?: string[]): Promise<void> {
    if (!modelIds || modelIds.length === 0) return;
    const unique = [...new Set(modelIds)];
    const count = await this.prisma.model.count({ where: { id: { in: unique } } });
    if (count !== unique.length) {
      throw new BadRequestException('Некоторые modelIds не существуют');
    }
  }
}
