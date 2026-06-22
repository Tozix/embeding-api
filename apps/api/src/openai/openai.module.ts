import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { QueueModule } from '../queue/queue.module';
import { OpenAiController } from './openai.controller';
import { OpenAiService } from './openai.service';

@Module({
  imports: [ApiKeysModule, QueueModule], // ApiKeyGuard + InferenceService (очередь → Ollama)
  controllers: [OpenAiController],
  providers: [OpenAiService],
})
export class OpenAiModule {}
