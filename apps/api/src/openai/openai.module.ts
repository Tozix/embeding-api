import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../queue/queue.module';
import { OpenAiController } from './openai.controller';
import { PlaygroundController } from './playground.controller';
import { OpenAiService } from './openai.service';

@Module({
  // ApiKeyGuard + InferenceService (очередь → Ollama); AuthModule — JwtAuthGuard для песочницы.
  imports: [ApiKeysModule, AuthModule, QueueModule],
  controllers: [OpenAiController, PlaygroundController],
  providers: [OpenAiService],
})
export class OpenAiModule {}
