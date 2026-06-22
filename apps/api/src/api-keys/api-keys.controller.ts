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
  type AuthUser,
  type CreateApiKeyInput,
} from '@embeding/schemas/auth';
import { ApiKeyService } from './api-key.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

/** Управление СВОИМИ ключами (веб-кабинет). Ключ PENDING; у супер-админа — сразу APPROVED. */
@Controller('keys')
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(private readonly service: ApiKeyService) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateApiKeySchema)) dto: CreateApiKeyInput,
  ): Promise<ApiKeyCreated> {
    // Супер-админ может выпустить себе рабочий ключ без отдельного одобрения.
    const opts =
      user.role === 'SUPERADMIN'
        ? { autoApprove: true, approvedBy: user.id }
        : undefined;
    return this.service.create(user.id, dto, opts);
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
