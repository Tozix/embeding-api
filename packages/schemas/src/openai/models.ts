import { z } from 'zod';

/** GET /v1/models — отдаём только модели, разрешённые супер-админом. */
export const ModelObjectSchema = z.object({
  id: z.string(),
  object: z.literal('model'),
  created: z.number().int(),
  owned_by: z.string(),
});
export type ModelObject = z.infer<typeof ModelObjectSchema>;

export const ModelsListSchema = z.object({
  object: z.literal('list'),
  data: z.array(ModelObjectSchema),
});
export type ModelsList = z.infer<typeof ModelsListSchema>;
