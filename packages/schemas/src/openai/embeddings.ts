import { z } from 'zod';

/** POST /v1/embeddings — совместимо с OpenAI SDK. */
export const EmbeddingsRequestSchema = z.object({
  model: z.string().min(1),
  input: z.union([
    z.string(),
    z.array(z.string()),
    z.array(z.number()), // массив токенов
    z.array(z.array(z.number())),
  ]),
  encoding_format: z.enum(['float', 'base64']).optional(),
  dimensions: z.number().int().positive().optional(),
  user: z.string().optional(),
});
export type EmbeddingsRequest = z.infer<typeof EmbeddingsRequestSchema>;

export const EmbeddingObjectSchema = z.object({
  object: z.literal('embedding'),
  index: z.number().int().nonnegative(),
  // float[] при encoding_format=float, base64-строка при base64
  embedding: z.union([z.array(z.number()), z.string()]),
});

export const EmbeddingsResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(EmbeddingObjectSchema),
  model: z.string(),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }),
});
export type EmbeddingsResponse = z.infer<typeof EmbeddingsResponseSchema>;
