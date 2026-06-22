import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CreateApiKeySchema,
  type ApiKeyCreated,
  type ApiKeyPublic,
  type CreateApiKeyInput,
} from '@embeding/schemas/auth';
import { ApiKeyService } from './api-key.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

/** Управление СВОИМИ ключами (веб-кабинет). Новый ключ — всегда PENDING. */
@Controller('keys')
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(private readonly service: ApiKeyService) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(CreateApiKeySchema)) dto: CreateApiKeyInput,
  ): Promise<ApiKeyCreated> {
    return this.service.create(userId, dto);
  }

  @Get()
  list(@CurrentUser('id') userId: string): Promise<ApiKeyPublic[]> {
    return this.service.listForUser(userId);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.revokeOwn(userId, id);
  }
}
