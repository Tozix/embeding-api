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

export type PullProgress = {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
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

  /** Загрузить модель в память (прогрев). keep_alive=-1 — держать до явной выгрузки. */
  async loadModel(ollamaName: string, kind: 'EMBEDDING' | 'CHAT'): Promise<void> {
    if (kind === 'EMBEDDING') {
      await this.post('/api/embed', {
        model: ollamaName,
        input: 'warmup',
        keep_alive: -1,
      });
    } else {
      await this.post('/api/generate', { model: ollamaName, keep_alive: -1 });
    }
  }

  /** Выгрузить модель из памяти (keep_alive=0). */
  async unloadModel(ollamaName: string, kind: 'EMBEDDING' | 'CHAT'): Promise<void> {
    if (kind === 'EMBEDDING') {
      await this.post('/api/embed', {
        model: ollamaName,
        input: 'x',
        keep_alive: 0,
      });
    } else {
      await this.post('/api/generate', { model: ollamaName, keep_alive: 0 });
    }
  }

  /** Модели, сейчас загруженные в память (Ollama /api/ps). */
  async listRunning(): Promise<
    { name: string; sizeBytes: number; sizeVramBytes: number; expiresAt: string | null }[]
  > {
    const res = await this.request('/api/ps', { method: 'GET' });
    const data = (await res.json()) as {
      models?: {
        name: string;
        size?: number;
        size_vram?: number;
        expires_at?: string;
      }[];
    };
    return (data.models ?? []).map((m) => ({
      name: m.name,
      sizeBytes: m.size ?? 0,
      sizeVramBytes: m.size_vram ?? 0,
      expiresAt: m.expires_at ?? null,
    }));
  }

  /** Скачивание модели (Ollama /api/pull) со стримингом прогресса. Без таймаута — может идти долго. */
  async openPull(name: string): Promise<AsyncGenerator<PullProgress>> {
    const res = await this.connect('/api/pull', { name, stream: true });
    if (!res.body) throw openAiErrors.upstream('Ollama не вернул поток');
    return parseNdjson<PullProgress>(res.body);
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
    // Ollama отвечает телом вида {"error":"model \"x\" not found, try pulling it first"} —
    // разворачиваем вложенный JSON в человекочитаемое сообщение, не отдаём сырую строку.
    let detail = text || `Ollama ответил статусом ${status}`;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j?.error) detail = j.error;
    } catch {
      /* не JSON — оставляем как есть */
    }
    const notPulled = /not found|try pulling|no such model|file does not exist/i.test(
      detail,
    );
    if (notPulled || status === 404) {
      return new OpenAiHttpException(404, {
        message: notPulled
          ? `Модель не скачана в Ollama — сначала скачайте её («Скачать»/pull). [${detail}]`
          : detail,
        type: 'invalid_request_error',
        code: notPulled ? 'model_not_pulled' : 'model_not_found',
        param: 'model',
      });
    }
    if (status < 500) {
      return new OpenAiHttpException(400, {
        message: detail,
        type: 'invalid_request_error',
      });
    }
    return openAiErrors.upstream(detail);
  }
}
