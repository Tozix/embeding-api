import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  EmbeddingsRequest,
  EmbeddingsResponse,
  ModelObject,
  ModelsList,
} from '@embeding/schemas/openai';
import { PrismaService } from '../prisma/prisma.service';
import { ModelKind } from '../prisma/client';
import type { OllamaChatBody } from '../ollama/ollama.service';
import { InferenceService } from '../queue/inference.service';
import type { UsageMeta } from '../queue/inference.types';
import { openAiErrors } from '../common/http/openai-error';
import type { ApiKeyContext } from '../common/types/auth-request';
import type { Env } from '../config/env';

type DbModel = {
  id: string;
  ollamaName: string;
  displayName: string;
  kind: ModelKind;
  isEnabled: boolean;
  createdAt: Date;
};

function genId(prefix: string): string {
  return `${prefix}-${randomBytes(16).toString('hex')}`;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function mapFinishReason(reason: string | undefined): string {
  return reason === 'length' ? 'length' : 'stop';
}

function encodeEmbedding(
  vec: number[],
  format: 'float' | 'base64' | undefined,
): number[] | string {
  if (format === 'base64') {
    return Buffer.from(new Float32Array(vec).buffer).toString('base64');
  }
  return vec;
}

@Injectable()
export class OpenAiService {
  private readonly maxItems: number;
  private readonly maxChars: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inference: InferenceService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.maxItems = config.get('MAX_EMBED_INPUT_ITEMS', { infer: true });
    this.maxChars = config.get('MAX_EMBED_INPUT_CHARS', { infer: true });
  }

  private meta(
    key: ApiKeyContext,
    model: DbModel,
    endpoint: 'embeddings' | 'chat',
    stream: boolean,
  ): UsageMeta {
    return {
      userId: key.userId,
      apiKeyId: key.id,
      modelName: model.displayName,
      endpoint,
      stream,
    };
  }

  // ---------- /v1/embeddings ----------

  async embeddings(
    req: EmbeddingsRequest,
    key: ApiKeyContext,
  ): Promise<EmbeddingsResponse> {
    // dimensions OpenAI поддерживает только для Matryoshka-моделей; Ollama его не применяет —
    // не молчим, а честно отклоняем, иначе клиент получит вектор неожиданной длины.
    if (req.dimensions !== undefined) {
      throw openAiErrors.invalidRequest(
        'Параметр dimensions не поддерживается этим шлюзом',
        'dimensions',
      );
    }
    const inputs = this.normalizeEmbedInput(req.input);
    const model = await this.resolveModel(req.model, key, ModelKind.EMBEDDING);

    const { embeddings, promptTokens } = await this.inference.embeddings(
      model.ollamaName,
      inputs,
      this.meta(key, model, 'embeddings', false),
    );

    // OpenAI гарантирует ровно один embedding на каждый элемент input (SDK сопоставляет по index).
    // Частичный/пустой ответ Ollama → явная 502, а не тихий усечённый 200 с потерей данных.
    if (embeddings.length !== inputs.length) {
      throw openAiErrors.upstream(
        `Ollama вернул ${embeddings.length} эмбеддингов вместо ${inputs.length}`,
      );
    }

    return {
      object: 'list',
      data: embeddings.map((emb, index) => ({
        object: 'embedding',
        index,
        embedding: encodeEmbedding(emb, req.encoding_format),
      })),
      model: model.displayName,
      usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
    };
  }

  private normalizeEmbedInput(input: EmbeddingsRequest['input']): string[] {
    const arr =
      typeof input === 'string'
        ? [input]
        : Array.isArray(input) && input.every((i) => typeof i === 'string')
          ? (input as string[])
          : null;
    if (!arr) {
      throw openAiErrors.invalidRequest(
        'Числовой (token) input не поддерживается — передайте строку или массив строк',
        'input',
        'invalid_value',
      );
    }
    if (arr.length === 0) {
      throw openAiErrors.invalidRequest('input не может быть пустым', 'input');
    }
    if (arr.length > this.maxItems) {
      throw openAiErrors.invalidRequest(
        `Слишком много элементов input (> ${this.maxItems})`,
        'input',
      );
    }
    const totalChars = arr.reduce((n, s) => n + s.length, 0);
    if (totalChars > this.maxChars) {
      throw openAiErrors.invalidRequest(
        `Суммарная длина input превышает лимит (${this.maxChars})`,
        'input',
      );
    }
    return arr;
  }

  // ---------- /v1/chat/completions (non-stream) ----------

  async chatOnce(
    req: ChatCompletionRequest,
    key: ApiKeyContext,
  ): Promise<ChatCompletionResponse> {
    const model = await this.resolveModel(req.model, key, ModelKind.CHAT);
    const res = await this.inference.chatOnce(
      this.toOllamaChatBody(req, model.ollamaName),
      this.meta(key, model, 'chat', false),
    );
    const promptTokens = res.prompt_eval_count ?? 0;
    const completionTokens = res.eval_count ?? 0;
    return {
      id: genId('chatcmpl'),
      object: 'chat.completion',
      created: nowSec(),
      model: model.displayName,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: res.message?.content ?? '' },
          finish_reason: mapFinishReason(res.done_reason ?? 'stop'),
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  }

  // ---------- /v1/chat/completions (stream) ----------

  /** Резолвит модель СИНХРОННО (до SSE-заголовков), затем возвращает генератор OpenAI-чанков. */
  async startChatStream(
    req: ChatCompletionRequest,
    key: ApiKeyContext,
    signal: AbortSignal,
  ): Promise<AsyncGenerator<ChatCompletionChunk>> {
    const model = await this.resolveModel(req.model, key, ModelKind.CHAT);
    const body = this.toOllamaChatBody(req, model.ollamaName);
    const includeUsage = req.stream_options?.include_usage ?? false;
    // Модель уже зарезолвлена выше (auth/visibility-ошибки — до SSE-заголовков).
    // Сам стрим идёт через очередь: воркер пишет сырые чанки в мост, читаем их здесь.
    const upstream = this.inference.chatStream(
      body,
      this.meta(key, model, 'chat', true),
      signal,
    );

    return (async function* (): AsyncGenerator<ChatCompletionChunk> {
      const id = genId('chatcmpl');
      const created = nowSec();
      const displayName = model.displayName;
      let roleSent = false;
      let last: { prompt_eval_count?: number; eval_count?: number } | undefined;

      for await (const chunk of upstream) {
        const delta: { role?: 'assistant'; content?: string } = {};
        if (!roleSent) {
          delta.role = 'assistant';
          roleSent = true;
        }
        const content = chunk.message?.content ?? '';
        if (content) delta.content = content;

        yield {
          id,
          object: 'chat.completion.chunk',
          created,
          model: displayName,
          choices: [
            {
              index: 0,
              delta,
              finish_reason: chunk.done ? mapFinishReason(chunk.done_reason) : null,
            },
          ],
          ...(includeUsage ? { usage: null } : {}),
        };
        if (chunk.done) last = chunk;
      }

      if (includeUsage) {
        const prompt = last?.prompt_eval_count ?? 0;
        const completion = last?.eval_count ?? 0;
        yield {
          id,
          object: 'chat.completion.chunk',
          created,
          model: displayName,
          choices: [],
          usage: {
            prompt_tokens: prompt,
            completion_tokens: completion,
            total_tokens: prompt + completion,
          },
        };
      }
    })();
  }

  // ---------- /v1/models ----------

  async listModels(key: ApiKeyContext): Promise<ModelsList> {
    const models = await this.visibleModels(key);
    return {
      object: 'list',
      data: models.map((m) => this.toModelObject(m)),
    };
  }

  /** Доступные ключу модели с типом — для песочницы/чата (фильтрация по kind на фронте). */
  async availableModels(
    key: ApiKeyContext,
  ): Promise<{ id: string; kind: ModelKind }[]> {
    const models = await this.visibleModels(key);
    return models.map((m) => ({ id: m.displayName, kind: m.kind }));
  }

  async retrieveModel(
    displayName: string,
    key: ApiKeyContext,
  ): Promise<ModelObject> {
    const model = await this.resolveModel(displayName, key);
    return this.toModelObject(model);
  }

  // ---------- общее ----------

  /** Модель должна существовать, быть видимой пользователю и разрешённой ключу. */
  private async resolveModel(
    displayName: string,
    key: ApiKeyContext,
    expectedKind?: ModelKind,
  ): Promise<DbModel> {
    const model = await this.prisma.model.findUnique({ where: { displayName } });
    if (!model || !(await this.isVisible(model, key.userId))) {
      throw openAiErrors.modelNotFound(displayName);
    }
    if (key.allowedModelIds && !key.allowedModelIds.includes(model.id)) {
      throw openAiErrors.modelNotFound(displayName);
    }
    if (expectedKind && model.kind !== expectedKind) {
      throw openAiErrors.invalidRequest(
        `Модель '${displayName}' не поддерживает этот эндпоинт`,
        'model',
      );
    }
    return model;
  }

  private async isVisible(model: DbModel, userId: string): Promise<boolean> {
    if (model.isEnabled) return true;
    const access = await this.prisma.modelAccess.findUnique({
      where: { userId_modelId: { userId, modelId: model.id } },
    });
    return access !== null;
  }

  private async visibleModels(key: ApiKeyContext): Promise<DbModel[]> {
    const enabled = await this.prisma.model.findMany({ where: { isEnabled: true } });
    const personal = await this.prisma.modelAccess.findMany({
      where: { userId: key.userId },
      include: { model: true },
    });

    const byId = new Map<string, DbModel>();
    for (const m of enabled) byId.set(m.id, m);
    for (const a of personal) byId.set(a.model.id, a.model);

    let list = [...byId.values()];
    if (key.allowedModelIds) {
      const allow = new Set(key.allowedModelIds);
      list = list.filter((m) => allow.has(m.id));
    }
    return list.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  private toModelObject(m: DbModel): ModelObject {
    return {
      id: m.displayName,
      object: 'model',
      created: Math.floor(m.createdAt.getTime() / 1000),
      owned_by: 'ollama',
    };
  }

  private toOllamaChatBody(
    req: ChatCompletionRequest,
    ollamaName: string,
  ): OllamaChatBody {
    const options: Record<string, unknown> = {};
    if (req.temperature !== undefined) options.temperature = req.temperature;
    if (req.top_p !== undefined) options.top_p = req.top_p;
    if (req.max_tokens !== undefined) options.num_predict = req.max_tokens;
    if (req.seed !== undefined) options.seed = req.seed;
    if (req.stop !== undefined) {
      options.stop = Array.isArray(req.stop) ? req.stop : [req.stop];
    }
    return {
      model: ollamaName,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content ?? '',
      })),
      options,
    };
  }
}
