import { z } from 'zod';

/** Конверт ошибки в формате OpenAI — отдаём его на любой провал в /v1/*. */
export const OpenAIErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    param: z.string().nullable().optional(),
    code: z.string().nullable().optional(),
  }),
});
export type OpenAIError = z.infer<typeof OpenAIErrorSchema>;

export const UsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative().optional(),
});
export type Usage = z.infer<typeof UsageSchema>;
