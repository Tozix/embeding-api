import { HttpException } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  OllamaService,
  type OllamaChatChunk,
} from '../ollama/ollama.service';
import { StreamHub } from './stream-hub';
import { serializeJobError } from './queue-error';
import { UsageRecorderService } from '../usage/usage-recorder.service';
import {
  CHAT_QUEUE,
  EMBED_QUEUE,
  type ChatJob,
  type ChatOnceResult,
  type EmbedJob,
  type EmbedResult,
  type UsageMeta,
} from './inference.types';

function statusOf(e: unknown): number {
  return e instanceof HttpException ? e.getStatus() : 500;
}

function queueWait(job: Job): number {
  return job.processedOn ? Math.max(0, job.processedOn - job.timestamp) : 0;
}

/** Воркер chat-очереди (concurrency из CHAT_CONCURRENCY; по умолчанию 1 — строгая сериализация). */
@Processor(CHAT_QUEUE, {
  concurrency: Number(process.env.CHAT_CONCURRENCY ?? '1'),
})
export class ChatProcessor extends WorkerHost {
  constructor(
    private readonly ollama: OllamaService,
    private readonly hub: StreamHub,
    private readonly recorder: UsageRecorderService,
  ) {
    super();
  }

  async process(job: Job<ChatJob>): Promise<ChatOnceResult | void> {
    const startedAt = Date.now();
    const wait = queueWait(job);
    const data = job.data;

    if (data.kind === 'once') {
      try {
        const res = await this.ollama.chatOnce(data.ollamaBody);
        await this.record(data.meta, res, 200, true, startedAt, wait);
        return res;
      } catch (e) {
        await this.record(data.meta, undefined, statusOf(e), false, startedAt, wait);
        throw new Error(serializeJobError(e)); // сохраняем статус/конверт через границу очереди
      }
    }

    const channel = this.hub.get<OllamaChatChunk>(data.bridgeId);
    let last: OllamaChatChunk | undefined;
    try {
      // channel.signal прерывает генерацию, если клиент отвалился.
      const stream = await this.ollama.openChatStream(
        data.ollamaBody,
        channel?.signal,
      );
      for await (const chunk of stream) {
        channel?.push(chunk);
        if (chunk.done) last = chunk;
      }
      channel?.end();
      await this.record(data.meta, last, 200, true, startedAt, wait);
    } catch (e) {
      channel?.fail(serializeJobError(e)); // конверт ошибки доедет до SSE-обработчика
      await this.record(data.meta, undefined, statusOf(e), false, startedAt, wait);
      throw new Error(serializeJobError(e));
    }
  }

  private record(
    meta: UsageMeta,
    chunk: OllamaChatChunk | undefined,
    status: number,
    ok: boolean,
    startedAt: number,
    queueWaitMs: number,
  ): Promise<void> {
    return this.recorder.record({
      userId: meta.userId,
      apiKeyId: meta.apiKeyId,
      modelName: meta.modelName,
      endpoint: 'chat',
      stream: meta.stream,
      status,
      ok,
      promptTokens: chunk?.prompt_eval_count ?? 0,
      completionTokens: chunk?.eval_count ?? 0,
      latencyMs: Date.now() - startedAt,
      queueWaitMs,
    });
  }
}

/** Воркер embeddings-очереди (concurrency из EMBED_CONCURRENCY). */
@Processor(EMBED_QUEUE, {
  concurrency: Number(process.env.EMBED_CONCURRENCY ?? '3'),
})
export class EmbeddingsProcessor extends WorkerHost {
  constructor(
    private readonly ollama: OllamaService,
    private readonly recorder: UsageRecorderService,
  ) {
    super();
  }

  async process(job: Job<EmbedJob>): Promise<EmbedResult> {
    const startedAt = Date.now();
    const wait = queueWait(job);
    const { ollamaName, inputs, meta } = job.data;
    try {
      const res = await this.ollama.embed(ollamaName, inputs);
      await this.recorder.record({
        userId: meta.userId,
        apiKeyId: meta.apiKeyId,
        modelName: meta.modelName,
        endpoint: 'embeddings',
        stream: false,
        status: 200,
        ok: true,
        promptTokens: res.promptTokens,
        completionTokens: 0,
        latencyMs: Date.now() - startedAt,
        queueWaitMs: wait,
      });
      return res;
    } catch (e) {
      await this.recorder.record({
        userId: meta.userId,
        apiKeyId: meta.apiKeyId,
        modelName: meta.modelName,
        endpoint: 'embeddings',
        stream: false,
        status: statusOf(e),
        ok: false,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - startedAt,
        queueWaitMs: wait,
      });
      throw new Error(serializeJobError(e));
    }
  }
}
