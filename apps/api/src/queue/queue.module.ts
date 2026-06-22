import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OllamaModule } from '../ollama/ollama.module';
import { UsageRecorderModule } from '../usage/usage-recorder.module';
import { CHAT_QUEUE, EMBED_QUEUE } from './inference.types';
import { StreamHub } from './stream-hub';
import { InferenceService } from './inference.service';
import { ChatProcessor, EmbeddingsProcessor } from './inference.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: CHAT_QUEUE }, { name: EMBED_QUEUE }),
    OllamaModule,
    UsageRecorderModule, // запись UsageRecord из процессоров
  ],
  providers: [StreamHub, InferenceService, ChatProcessor, EmbeddingsProcessor],
  exports: [InferenceService],
})
export class QueueModule {}
