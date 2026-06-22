export type UsageRecordInput = {
  userId: string | null;
  apiKeyId: string | null;
  modelName: string;
  endpoint: 'embeddings' | 'chat';
  stream: boolean;
  status: number;
  ok: boolean;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  queueWaitMs: number;
};

/** Событие для live-дашборда (SSE). */
export type LiveUsageEvent = Omit<UsageRecordInput, 'userId' | 'apiKeyId'> & {
  id: string;
  userId: string | null;
  apiKeyId: string | null;
  totalTokens: number;
  createdAt: string;
};
