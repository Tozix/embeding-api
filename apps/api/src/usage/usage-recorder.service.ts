import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsLive } from './realtime';
import type { UsageRecordInput } from './usage.types';

@Injectable()
export class UsageRecorderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly live: AnalyticsLive,
  ) {}

  /** Пишет строку UsageRecord и публикует live-событие. Не бросает: аналитика не должна ронять инференс. */
  async record(input: UsageRecordInput): Promise<void> {
    const totalTokens = input.promptTokens + input.completionTokens;
    try {
      const saved = await this.prisma.usageRecord.create({
        data: {
          userId: input.userId,
          apiKeyId: input.apiKeyId,
          modelName: input.modelName,
          endpoint: input.endpoint,
          stream: input.stream,
          status: input.status,
          ok: input.ok,
          promptTokens: input.promptTokens,
          completionTokens: input.completionTokens,
          totalTokens,
          latencyMs: input.latencyMs,
          queueWaitMs: input.queueWaitMs,
        },
        select: { id: true, createdAt: true },
      });
      this.live.publish({
        id: saved.id,
        createdAt: saved.createdAt.toISOString(),
        userId: input.userId,
        apiKeyId: input.apiKeyId,
        modelName: input.modelName,
        endpoint: input.endpoint,
        stream: input.stream,
        status: input.status,
        ok: input.ok,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        totalTokens,
        latencyMs: input.latencyMs,
        queueWaitMs: input.queueWaitMs,
      });
    } catch {
      /* проглатываем: запись аналитики не критична для ответа клиенту */
    }
  }
}
