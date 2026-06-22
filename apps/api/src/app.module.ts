import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { DocsController } from './docs/docs.controller';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { QueueConnectionModule } from './queue/queue-connection.module';
import { AuthModule } from './auth/auth.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { OpenAiModule } from './openai/openai.module';
import { AdminModule } from './admin/admin.module';
import { UsageModule } from './usage/usage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    QueueConnectionModule, // глобальное подключение BullMQ к Redis
    PrismaModule,
    AuthModule,
    ApiKeysModule,
    OpenAiModule, // /v1/* (импортирует ApiKeys + очередь → Ollama)
    AdminModule, // /admin/* (импортирует Auth + ApiKeys + Ollama)
    UsageModule, // /admin/analytics/* (метрики + live SSE)
  ],
  controllers: [HealthController, DocsController],
  providers: [
    // Единственный глобальный фильтр: OpenAI-конверт для /v1/*, обычный JSON — для остального.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
