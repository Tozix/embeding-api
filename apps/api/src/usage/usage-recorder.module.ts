import { Module } from '@nestjs/common';
import { UsageRecorderService } from './usage-recorder.service';
import { AnalyticsLive } from './realtime';

/** Только запись/публикация usage. Выделено отдельно, чтобы QueueModule не зависел от read-стороны аналитики. */
@Module({
  providers: [UsageRecorderService, AnalyticsLive],
  exports: [UsageRecorderService, AnalyticsLive],
})
export class UsageRecorderModule {}
