import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';
import { randomBytes } from 'node:crypto';
import type {
  OllamaChatBody,
  OllamaChatChunk,
} from '../ollama/ollama.service';
import type { Env } from '../config/env';
import { StreamHub } from './stream-hub';
import { deserializeJobError } from './queue-error';
import {
  CHAT_QUEUE,
  EMBED_QUEUE,
  type ChatOnceJob,
  type ChatOnceResult,
  type ChatStreamJob,
  type EmbedJob,
  type EmbedResult,
  type UsageMeta,
} from './inference.types';

const JOB_OPTS = { removeOnComplete: 1000, removeOnFail: 500 };

/**
 * Фасад очереди: ставит задачи в BullMQ и ждёт результат. Реальный инференс выполняет воркер
 * (процессор), что даёт контроль конкуренции (CPU-only) и метрики. Для стрима используется
 * in-process мост StreamHub: воркер пишет сырые чанки Ollama, обработчик читает их здесь.
 */
@Injectable()
export class InferenceService implements OnModuleDestroy {
  private readonly chatEvents: QueueEvents;
  private readonly embedEvents: QueueEvents;

  constructor(
    @InjectQueue(CHAT_QUEUE) private readonly chatQueue: Queue,
    @InjectQueue(EMBED_QUEUE) private readonly embedQueue: Queue,
    private readonly hub: StreamHub,
    config: ConfigService<Env, true>,
  ) {
    const connection = {
      host: config.get('REDIS_HOST', { infer: true }),
      port: config.get('REDIS_PORT', { infer: true }),
    };
    this.chatEvents = new QueueEvents(CHAT_QUEUE, { connection });
    this.embedEvents = new QueueEvents(EMBED_QUEUE, { connection });
  }

  async embeddings(
    ollamaName: string,
    inputs: string[],
    meta: UsageMeta,
  ): Promise<EmbedResult> {
    const job = await this.embedQueue.add(
      'embed',
      { ollamaName, inputs, meta } satisfies EmbedJob,
      JOB_OPTS,
    );
    try {
      return (await job.waitUntilFinished(this.embedEvents)) as EmbedResult;
    } catch (e) {
      throw deserializeJobError(e); // восстанавливаем статус/конверт ошибки воркера
    }
  }

  async chatOnce(
    ollamaBody: OllamaChatBody,
    meta: UsageMeta,
  ): Promise<ChatOnceResult> {
    const job = await this.chatQueue.add(
      'chatOnce',
      { kind: 'once', ollamaBody, meta } satisfies ChatOnceJob,
      JOB_OPTS,
    );
    try {
      return (await job.waitUntilFinished(this.chatEvents)) as ChatOnceResult;
    } catch (e) {
      throw deserializeJobError(e);
    }
  }

  async *chatStream(
    ollamaBody: OllamaChatBody,
    meta: UsageMeta,
    signal?: AbortSignal,
  ): AsyncGenerator<OllamaChatChunk> {
    const bridgeId = randomBytes(12).toString('hex');
    const channel = this.hub.create<OllamaChatChunk>(bridgeId);
    const onAbort = () => channel.abort.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    await this.chatQueue.add(
      'chatStream',
      { kind: 'stream', ollamaBody, bridgeId, meta } satisfies ChatStreamJob,
      JOB_OPTS,
    );
    try {
      yield* channel; // бросит, если воркер вызвал channel.fail()
    } finally {
      signal?.removeEventListener('abort', onAbort);
      this.hub.remove(bridgeId);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.chatEvents.close(),
      this.embedEvents.close(),
    ]);
  }
}
