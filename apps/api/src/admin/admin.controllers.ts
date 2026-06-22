import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AdminCreateKeySchema,
  AdminKeysQuerySchema,
  AdminUpdateUserSchema,
  CreateModelSchema,
  ListQuerySchema,
  UpdateModelSchema,
  type AdminCreateKeyInput,
  type AdminKeysQuery,
  type AdminUpdateUserInput,
  type CreateModelInput,
  type ListQuery,
  type UpdateModelInput,
} from '@embeding/schemas/admin';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ApiKeyService } from '../api-keys/api-key.service';
import { AdminUsersService } from './admin-users.service';
import { AdminModelsService } from './admin-models.service';

// ---------- пользователи ----------

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly keys: ApiKeyService,
  ) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListQuerySchema)) query: ListQuery) {
    return this.users.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.users.get(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminUpdateUserSchema)) dto: AdminUpdateUserInput,
  ) {
    return this.users.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.users.remove(id);
  }

  /** Создать ключ пользователю — сразу APPROVED. Сырой ключ возвращается один раз. */
  @Post(':id/keys')
  @HttpCode(201)
  async createKey(
    @Param('id') userId: string,
    @CurrentUser('id') adminId: string,
    @Body(new ZodValidationPipe(AdminCreateKeySchema)) dto: AdminCreateKeyInput,
  ) {
    await this.users.get(userId); // 404, если пользователя нет
    return this.keys.create(userId, dto, {
      autoApprove: true,
      approvedBy: adminId,
    });
  }
}

// ---------- ключи ----------

@Controller('admin/keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
export class AdminKeysController {
  constructor(private readonly keys: ApiKeyService) {}

  @Get()
  list(@Query(new ZodValidationPipe(AdminKeysQuerySchema)) query: AdminKeysQuery) {
    return this.keys.listAll(query);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.keys.approve(id, adminId);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  revoke(@Param('id') id: string) {
    return this.keys.revoke(id);
  }
}

// ---------- модели ----------

@Controller('admin/models')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
export class AdminModelsController {
  constructor(private readonly models: AdminModelsService) {}

  @Get()
  list() {
    return this.models.list();
  }

  @Post()
  @HttpCode(201)
  create(@Body(new ZodValidationPipe(CreateModelSchema)) dto: CreateModelInput) {
    return this.models.create(dto);
  }

  @Post('sync')
  @HttpCode(200)
  sync() {
    return this.models.sync();
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateModelSchema)) dto: UpdateModelInput,
  ) {
    return this.models.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.models.remove(id);
  }
}
