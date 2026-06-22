import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CHAT_QUEUE, EMBED_QUEUE } from '../queue/inference.types';

type Bucket = 'minute' | 'hour' | 'day';
type TopBy = 'user' | 'apiKey' | 'model';

type TimeseriesRow = {
  bucket: Date;
  requests: number;
  errors: number;
  avgLatencyMs: number;
  totalTokens: number;
};

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(CHAT_QUEUE) private readonly chatQueue: Queue,
    @InjectQueue(EMBED_QUEUE) private readonly embedQueue: Queue,
  ) {}

  private range(from?: string, to?: string): { gte: Date; lte: Date } {
    return {
      gte: from ? new Date(from) : new Date(Date.now() - 24 * 3600 * 1000),
      lte: to ? new Date(to) : new Date(),
    };
  }

  async summary(from?: string, to?: string) {
    const { gte, lte } = this.range(from, to);
    const where = { createdAt: { gte, lte } };
    const [agg, requests, errors] = await this.prisma.$transaction([
      this.prisma.usageRecord.aggregate({
        where,
        _avg: { latencyMs: true, queueWaitMs: true },
        _sum: { totalTokens: true, promptTokens: true, completionTokens: true },
      }),
      this.prisma.usageRecord.count({ where }),
      this.prisma.usageRecord.count({ where: { ...where, ok: false } }),
    ]);
    return {
      from: gte.toISOString(),
      to: lte.toISOString(),
      requests,
      errors,
      avgLatencyMs: Math.round(agg._avg.latencyMs ?? 0),
      avgQueueWaitMs: Math.round(agg._avg.queueWaitMs ?? 0),
      totalTokens: agg._sum.totalTokens ?? 0,
      promptTokens: agg._sum.promptTokens ?? 0,
      completionTokens: agg._sum.completionTokens ?? 0,
    };
  }

  async timeseries(from?: string, to?: string, bucket: Bucket = 'hour') {
    const { gte, lte } = this.range(from, to);
    // bucket — из Zod-enum (minute|hour|day), безопасно как параметр date_trunc.
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT date_trunc($1, "createdAt") AS bucket,
              COUNT(*)::int AS requests,
              SUM(CASE WHEN ok THEN 0 ELSE 1 END)::int AS errors,
              COALESCE(AVG("latencyMs"), 0)::float AS "avgLatencyMs",
              COALESCE(SUM("totalTokens"), 0)::int AS "totalTokens"
         FROM usage_records
        WHERE "createdAt" >= $2 AND "createdAt" <= $3
        GROUP BY bucket
        ORDER BY bucket`,
      bucket,
      gte,
      lte,
    )) as TimeseriesRow[];
    return rows.map((r) => ({
      bucket: new Date(r.bucket).toISOString(),
      requests: r.requests,
      errors: r.errors,
      avgLatencyMs: Math.round(r.avgLatencyMs),
      totalTokens: r.totalTokens,
    }));
  }

  async top(by: TopBy, from?: string, to?: string, limit = 10) {
    const { gte, lte } = this.range(from, to);
    const where = { createdAt: { gte, lte } };

    if (by === 'model') {
      const rows = await this.prisma.usageRecord.groupBy({
        by: ['modelName'],
        where,
        _count: { _all: true },
        _sum: { totalTokens: true },
        orderBy: { _count: { modelName: 'desc' } },
        take: limit,
      });
      return rows.map((r) => ({
        key: r.modelName,
        label: r.modelName,
        requests: r._count._all,
        totalTokens: r._sum.totalTokens ?? 0,
      }));
    }

    if (by === 'user') {
      const rows = await this.prisma.usageRecord.groupBy({
        by: ['userId'],
        where: { ...where, userId: { not: null } },
        _count: { _all: true },
        _sum: { totalTokens: true },
        orderBy: { _count: { userId: 'desc' } },
        take: limit,
      });
      const ids = rows
        .map((r) => r.userId)
        .filter((x): x is string => x !== null);
      const users = await this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, email: true },
      });
      const label = new Map(users.map((u) => [u.id, u.email]));
      return rows.map((r) => ({
        key: r.userId ?? '—',
        label: (r.userId && label.get(r.userId)) || '—',
        requests: r._count._all,
        totalTokens: r._sum.totalTokens ?? 0,
      }));
    }

    const rows = await this.prisma.usageRecord.groupBy({
      by: ['apiKeyId'],
      where: { ...where, apiKeyId: { not: null } },
      _count: { _all: true },
      _sum: { totalTokens: true },
      orderBy: { _count: { apiKeyId: 'desc' } },
      take: limit,
    });
    const ids = rows
      .map((r) => r.apiKeyId)
      .filter((x): x is string => x !== null);
    const keys = await this.prisma.apiKey.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, keyPrefix: true },
    });
    const label = new Map(keys.map((k) => [k.id, `${k.name} (${k.keyPrefix})`]));
    return rows.map((r) => ({
      key: r.apiKeyId ?? '—',
      label: (r.apiKeyId && label.get(r.apiKeyId)) || '—',
      requests: r._count._all,
      totalTokens: r._sum.totalTokens ?? 0,
    }));
  }

  /** Текущая глубина очередей — для индикатора нагрузки. */
  async queues() {
    const [chat, embeddings] = await Promise.all([
      this.chatQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
      this.embedQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
    ]);
    return { chat, embeddings };
  }
}
