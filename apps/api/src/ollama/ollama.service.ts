import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiHttpException, openAiErrors } from '../common/http/openai-error';
import type { Env } from '../config/env';

export type OllamaMessage = { role: string; content: string };

export type OllamaChatBody = {
  model: string;
  messages: OllamaMessage[];
  options?: Record<string, unknown>;
  keep_alive?: string;
};

export type OllamaChatChunk = {
  model: string;
  message?: OllamaMessage;
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
};

type OllamaEmbedResponse = {
  embeddings?: number[][];
  prompt_eval_count?: number;
};

type OllamaTagsResponse = {
  models?: { name: string; model?: string }[];
};

/** Построчный разбор NDJSON-потока Ollama. */
async function* parseNdjson<T>(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<T> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) yield JSON.parse(line) as T;
      }
    }
    const tail = buf.trim();
    if (tail) yield JSON.parse(tail) as T;
  } finally {
    reader.releaseLock();
  }
}

@Injectable()
export class OllamaService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly keepAlive: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.baseUrl = config
      .get('OLLAMA_BASE_URL', { infer: true })
      .replace(/\/$/, '');
    this.timeoutMs = config.get('OLLAMA_TIMEOUT_MS', { infer: true });
    this.keepAlive = config.get('OLLAMA_KEEP_ALIVE', { infer: true });
  }

  get keepAliveValue(): string {
    return this.keepAlive;
  }

  async embed(
    ollamaName: string,
    input: string[],
  ): Promise<{ embeddings: number[][]; promptTokens: number }> {
    const res = await this.post('/api/embed', {
      model: ollamaName,
      input,
      keep_alive: this.keepAlive,
    });
    const data = (await res.json()) as OllamaEmbedResponse;
    return {
      embeddings: data.embeddings ?? [],
      promptTokens: data.prompt_eval_count ?? 0,
    };
  }

  async chatOnce(body: OllamaChatBody): Promise<OllamaChatChunk> {
    const res = await this.post('/api/chat', {
      ...body,
      keep_alive: this.keepAlive,
      stream: false,
    });
    return (await res.json()) as OllamaChatChunk;
  }

  /**
   * Открывает chat-поток: соединение (и возможные upstream-ошибки) устанавливается здесь,
   * до начала итерации — чтобы вызывающий мог отдать HTTP-ошибку ДО SSE-заголовков.
   */
  async openChatStream(
    body: OllamaChatBody,
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<OllamaChatChunk>> {
    // Таймаут применяется ТОЛЬКО к установке соединения (до заголовков), а не к телу:
    // длинная генерация на CPU может идти дольше OLLAMA_TIMEOUT_MS и не должна обрываться.
    const res = await this.connect(
      '/api/chat',
      { ...body, keep_alive: this.keepAlive, stream: true },
      signal,
    );
    if (!res.body) throw openAiErrors.upstream('Ollama не вернул поток');
    return parseNdjson<OllamaChatChunk>(res.body);
  }

  /** Список моделей, реально доступных в Ollama (для admin sync). */
  async listTags(): Promise<string[]> {
    const res = await this.request('/api/tags', { method: 'GET' });
    const data = (await res.json()) as OllamaTagsResponse;
    return (data.models ?? []).map((m) => m.name);
  }

  private post(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    return this.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  }

  private async request(
    path: string,
    init: RequestInit & { signal?: AbortSignal },
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeout])
      : timeout;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...init, signal });
    } catch (e) {
      throw openAiErrors.upstream(
        `Не удалось обратиться к Ollama: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw this.mapUpstreamError(res.status, text);
    }
    return res;
  }

  /**
   * Как request(), но таймаут снимается, как только получены заголовки ответа —
   * чтение тела (стрим) дальше не ограничено по времени. Клиентский signal (обрыв) сохраняется.
   */
  private async connect(
    path: string,
    body: unknown,
    clientSignal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const signal = clientSignal
      ? AbortSignal.any([clientSignal, controller.signal])
      : controller.signal;
    const timer = setTimeout(
      () => controller.abort(new Error('Ollama connection timeout')),
      this.timeoutMs,
    );
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      throw openAiErrors.upstream(
        `Не удалось обратиться к Ollama: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      clearTimeout(timer); // заголовки получены (или ошибка) — тело стримим без таймаута
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw this.mapUpstreamError(res.status, text);
    }
    return res;
  }

  private mapUpstreamError(status: number, text: string): OpenAiHttpException {
    const message = text || `Ollama ответил статусом ${status}`;
    if (status === 404) {
      return new OpenAiHttpException(404, {
        message,
        type: 'invalid_request_error',
        code: 'model_not_found',
        param: 'model',
      });
    }
    if (status < 500) {
      return new OpenAiHttpException(400, {
        message,
        type: 'invalid_request_error',
      });
    }
    return openAiErrors.upstream(message);
  }
}
