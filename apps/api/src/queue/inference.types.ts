import type { OllamaChatBody, OllamaChatChunk } from '../ollama/ollama.service';

export const CHAT_QUEUE = 'chat';
export const EMBED_QUEUE = 'embeddings';

/** Метаданные для записи UsageRecord (кто/что/как считаем). */
export type UsageMeta = {
  userId: string;
  apiKeyId: string;
  modelName: string;
  endpoint: 'embeddings' | 'chat';
  stream: boolean;
};

export type EmbedJob = {
  ollamaName: string;
  inputs: string[];
  meta: UsageMeta;
};
export type EmbedResult = { embeddings: number[][]; promptTokens: number };

export type ChatOnceJob = {
  kind: 'once';
  ollamaBody: OllamaChatBody;
  meta: UsageMeta;
};
export type ChatStreamJob = {
  kind: 'stream';
  ollamaBody: OllamaChatBody;
  bridgeId: string;
  meta: UsageMeta;
};
export type ChatJob = ChatOnceJob | ChatStreamJob;

export type ChatOnceResult = OllamaChatChunk;
