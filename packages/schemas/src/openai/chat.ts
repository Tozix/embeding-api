import { z } from 'zod';
import { UsageSchema } from './common.js';

export const ChatRole = z.enum(['system', 'user', 'assistant', 'tool']);

export const ChatMessageSchema = z.object({
  role: ChatRole,
  content: z.string().nullable(),
  name: z.string().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** Доп. опции стриминга OpenAI. */
export const StreamOptionsSchema = z.object({
  include_usage: z.boolean().optional(),
});

/** POST /v1/chat/completions — совместимо с OpenAI SDK. */
// Схема НЕ strict: незнакомые поля OpenAI SDK (logprobs, response_format, tools…) игнорируются
// ради forward-совместимости. Обрабатываем только то, что реально маппим в Ollama.
export const ChatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(ChatMessageSchema).min(1),
  stream: z.boolean().optional(),
  stream_options: StreamOptionsSchema.optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  seed: z.number().int().optional(),
  user: z.string().optional(),
});
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

export const ChatChoiceSchema = z.object({
  index: z.number().int().nonnegative(),
  message: ChatMessageSchema,
  finish_reason: z.string().nullable(),
});

/** Полный (нестриминговый) ответ. */
export const ChatCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  created: z.number().int(),
  model: z.string(),
  choices: z.array(ChatChoiceSchema),
  usage: UsageSchema.optional(),
});
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;

/** Один SSE-чанк при stream=true (формат OpenAI delta). */
export const ChatCompletionChunkSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion.chunk'),
  created: z.number().int(),
  model: z.string(),
  choices: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      delta: z.object({
        role: ChatRole.optional(),
        content: z.string().optional(),
      }),
      finish_reason: z.string().nullable(),
    }),
  ),
  // При stream_options.include_usage OpenAI шлёт usage:null в промежуточных чанках
  // и финальный чанк с choices:[] и заполненным usage.
  usage: UsageSchema.nullable().optional(),
});
export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunkSchema>;
