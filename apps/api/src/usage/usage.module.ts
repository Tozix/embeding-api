import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { CHAT_QUEUE, EMBED_QUEUE } from '../queue/inference.types';
import { UsageRecorderModule } from './usage-recorder.module';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { SystemMetricsService } from '../system/system-metrics.service';

@Module({
  imports: [
    // свои Queue-инстансы для getJobCounts (статус очередей)
    BullModule.registerQueue({ name: CHAT_QUEUE }, { name: EMBED_QUEUE }),
    AuthModule, // JwtAuthGuard + RolesGuard
    UsageRecorderModule, // AnalyticsLive (та же шина, что у recorder'а)
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, SystemMetricsService],
})
export class UsageModule {}
