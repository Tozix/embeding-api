import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { OllamaModule } from '../ollama/ollama.module';
import { AdminUsersService } from './admin-users.service';
import { AdminModelsService } from './admin-models.service';
import {
  AdminKeysController,
  AdminModelsController,
  AdminUsersController,
} from './admin.controllers';

@Module({
  imports: [AuthModule, ApiKeysModule, OllamaModule],
  controllers: [
    AdminUsersController,
    AdminKeysController,
    AdminModelsController,
  ],
  providers: [AdminUsersService, AdminModelsService],
})
export class AdminModule {}
