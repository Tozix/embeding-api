import {
  Controller,
  Get,
  type MessageEvent,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable, from, interval, map, merge, switchMap } from 'rxjs';
import {
  AnalyticsRangeSchema,
  TimeseriesQuerySchema,
  TopQuerySchema,
  type AnalyticsRange,
  type TimeseriesQuery,
  type TopQuery,
} from '@embeding/schemas/admin';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AnalyticsService } from './analytics.service';
import { AnalyticsLive } from './realtime';
import { SystemMetricsService } from '../system/system-metrics.service';

/** Аналитика для дашборда (только SUPERADMIN). live — SSE; фронт читает его fetch-стримом с Bearer. */
@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly live: AnalyticsLive,
    private readonly system: SystemMetricsService,
  ) {}

  /** CPU/RAM хоста: текущий снимок + история для графика «за период». */
  @Get('system')
  systemMetrics() {
    return this.system.snapshot();
  }

  @Get('summary')
  summary(@Query(new ZodValidationPipe(AnalyticsRangeSchema)) q: AnalyticsRange) {
    return this.analytics.summary(q.from, q.to);
  }

  @Get('timeseries')
  timeseries(
    @Query(new ZodValidationPipe(TimeseriesQuerySchema)) q: TimeseriesQuery,
  ) {
    return this.analytics.timeseries(q.from, q.to, q.bucket);
  }

  @Get('top')
  top(@Query(new ZodValidationPipe(TopQuerySchema)) q: TopQuery) {
    return this.analytics.top(q.by, q.from, q.to, q.limit);
  }

  @Get('queues')
  queues() {
    return this.analytics.queues();
  }

  @Sse('live')
  liveStream(): Observable<MessageEvent> {
    const usage$ = new Observable<MessageEvent>((subscriber) => {
      const unsubscribe = this.live.subscribe((event) =>
        subscriber.next({ data: { type: 'usage', event } } as MessageEvent),
      );
      return () => unsubscribe();
    });
    const queues$ = interval(3000).pipe(
      switchMap(() => from(this.analytics.queues())),
      map((queues) => ({ data: { type: 'queues', queues } }) as MessageEvent),
    );
    const system$ = interval(2000).pipe(
      map(
        () =>
          ({
            data: { type: 'system', system: this.system.snapshot().current },
          }) as MessageEvent,
      ),
    );
    return merge(usage$, queues$, system$);
  }
}
