import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ChatCompletionRequestSchema,
  EmbeddingsRequestSchema,
  type ChatCompletionRequest,
  type EmbeddingsRequest,
  type EmbeddingsResponse,
} from '@embeding/schemas/openai';
import { OpenAiService } from './openai.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { OpenAiHttpException } from '../common/http/openai-error';
import { deserializeJobError } from '../queue/queue-error';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyStatus } from '../prisma/client';
import type { ApiKeyContext } from '../common/types/auth-request';

/**
 * Песочница/чат для залогиненного пользователя: инференс выполняется ЕГО одобренным ключом
 * (по id), авторизация — по JWT-сессии. Так фронт не держит сырой ключ (его нельзя получить
 * повторно), а выбирает ключ из select. Переиспользует OpenAiService (тот же путь через очередь).
 */
@Controller('me/playground')
@UseGuards(JwtAuthGuard)
export class PlaygroundController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openai: OpenAiService,
  ) {}

  /** Одобренные ключи пользователя — для выпадающего списка. */
  @Get('keys')
  keys(@CurrentUser('id') userId: string) {
    return this.prisma.apiKey.findMany({
      where: { userId, status: ApiKeyStatus.APPROVED },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, keyPrefix: true },
    });
  }

  /** Модели, доступные ключу, с типом (chat/embedding) — для фильтра на фронте. */
  @Get('keys/:keyId/models')
  async models(
    @CurrentUser('id') userId: string,
    @Param('keyId') keyId: string,
  ) {
    return this.openai.availableModels(await this.ctx(userId, keyId));
  }

  @Post('keys/:keyId/embeddings')
  @HttpCode(200)
  async embeddings(
    @CurrentUser('id') userId: string,
    @Param('keyId') keyId: string,
    @Body(new ZodValidationPipe(EmbeddingsRequestSchema)) dto: EmbeddingsRequest,
  ): Promise<EmbeddingsResponse> {
    return this.openai.embeddings(dto, await this.ctx(userId, keyId));
  }

  @Post('keys/:keyId/chat')
  async chat(
    @CurrentUser('id') userId: string,
    @Param('keyId') keyId: string,
    @Body(new ZodValidationPipe(ChatCompletionRequestSchema))
    dto: ChatCompletionRequest,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = await this.ctx(userId, keyId);
    if (!dto.stream) {
      res.status(200).json(await this.openai.chatOnce(dto, ctx));
      return;
    }
    const abort = new AbortController();
    const stream = await this.openai.startChatStream(dto, ctx, abort.signal);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    try {
      for await (const chunk of stream) {
        if (res.writableEnded || abort.signal.aborted) break;
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      if (!res.writableEnded) res.write('data: [DONE]\n\n');
    } catch (e) {
      if (!res.writableEnded && !abort.signal.aborted) {
        const err = e instanceof OpenAiHttpException ? e : deserializeJobError(e);
        res.write(`data: ${JSON.stringify(err.getResponse())}\n\n`);
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  /** Строит контекст ключа из ОДОБРЕННОГО ключа, принадлежащего пользователю. */
  private async ctx(userId: string, keyId: string): Promise<ApiKeyContext> {
    const key = await this.prisma.apiKey.findFirst({
      where: { id: keyId, userId },
      include: { allowedModels: { select: { modelId: true } } },
    });
    if (!key) throw new NotFoundException('Ключ не найден');
    if (key.status !== ApiKeyStatus.APPROVED) {
      throw new ForbiddenException('Ключ не одобрен');
    }
    return {
      id: key.id,
      userId: key.userId,
      keyPrefix: key.keyPrefix,
      allowedModelIds: key.allowedModels.length
        ? key.allowedModels.map((m) => m.modelId)
        : null,
    };
  }
}
