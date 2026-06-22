import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ChatCompletionRequestSchema,
  EmbeddingsRequestSchema,
  type ChatCompletionRequest,
  type EmbeddingsRequest,
  type EmbeddingsResponse,
  type ModelObject,
  type ModelsList,
} from '@embeding/schemas/openai';
import { OpenAiService } from './openai.service';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { CurrentApiKey } from '../common/decorators/current-api-key.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { OpenAiHttpException } from '../common/http/openai-error';
import { deserializeJobError } from '../queue/queue-error';
import type { ApiKeyContext } from '../common/types/auth-request';

/** OpenAI-совместимые маршруты. Аутентификация — только Bearer API-ключ (APPROVED). */
@Controller('v1')
@UseGuards(ApiKeyGuard)
export class OpenAiController {
  constructor(private readonly service: OpenAiService) {}

  @Post('embeddings')
  @HttpCode(200) // OpenAI отдаёт 200, а не дефолтный для POST 201
  embeddings(
    @CurrentApiKey() key: ApiKeyContext,
    @Body(new ZodValidationPipe(EmbeddingsRequestSchema)) dto: EmbeddingsRequest,
  ): Promise<EmbeddingsResponse> {
    return this.service.embeddings(dto, key);
  }

  @Get('models')
  listModels(@CurrentApiKey() key: ApiKeyContext): Promise<ModelsList> {
    return this.service.listModels(key);
  }

  @Get('models/:model')
  retrieveModel(
    @CurrentApiKey() key: ApiKeyContext,
    @Param('model') model: string,
  ): Promise<ModelObject> {
    return this.service.retrieveModel(model, key);
  }

  @Post('chat/completions')
  async chat(
    @CurrentApiKey() key: ApiKeyContext,
    @Body(new ZodValidationPipe(ChatCompletionRequestSchema))
    dto: ChatCompletionRequest,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!dto.stream) {
      const result = await this.service.chatOnce(dto, key);
      res.status(200).json(result);
      return;
    }

    // Резолв модели и открытие upstream — ДО SSE-заголовков: ошибки уйдут в AllExceptionsFilter.
    const abort = new AbortController();
    const stream = await this.service.startChatStream(dto, key, abort.signal);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    req.on('close', () => abort.abort());

    try {
      for await (const chunk of stream) {
        if (res.writableEnded || req.destroyed) break;
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      if (!res.writableEnded) res.write('data: [DONE]\n\n');
    } catch (e) {
      // Клиентский обрыв (abort) — в мёртвый сокет писать нельзя и незачем.
      // Иначе — ошибка upstream/парсинга: отдаём её событием в уже открытом потоке.
      if (!res.writableEnded && !req.destroyed && !abort.signal.aborted) {
        res.write(this.streamErrorEvent(e));
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  private streamErrorEvent(e: unknown): string {
    // Ошибка из моста очереди приходит как Error с сериализованным конвертом — восстанавливаем его.
    const err = e instanceof OpenAiHttpException ? e : deserializeJobError(e);
    return `data: ${JSON.stringify(err.getResponse())}\n\n`;
  }
}
