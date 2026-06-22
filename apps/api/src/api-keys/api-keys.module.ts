import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApiKeyService } from './api-key.service';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeysController } from './api-keys.controller';

@Module({
  imports: [AuthModule], // JwtAuthGuard + его зависимости (TokenService)
  controllers: [ApiKeysController],
  providers: [ApiKeyService, ApiKeyGuard],
  // ApiKeyGuard и сервис переиспользуют OpenAI- и Admin-модули — единственный владелец логики ключей.
  exports: [ApiKeyService, ApiKeyGuard],
})
export class ApiKeysModule {}
