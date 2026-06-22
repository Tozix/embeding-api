import { z } from 'zod';
import { ApiKeyStatusSchema, ModelKindSchema, RoleSchema } from '../common/enums.js';

// displayName модели не должен содержать '/' — иначе ломается путь /v1/models/:model в Express.
const ModelDisplayName = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[^/]+$/, 'displayName не может содержать "/"');

// ---------- пользователи ----------

export const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;

export const AdminUpdateUserSchema = z
  .object({
    role: RoleSchema.optional(),
    isActive: z.boolean().optional(),
    displayName: z.string().min(1).max(80).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Пустое обновление' });
export type AdminUpdateUserInput = z.infer<typeof AdminUpdateUserSchema>;

// ---------- ключи ----------

const futureOrAbsent = z.iso
  .datetime()
  .refine((s) => new Date(s).getTime() > Date.now(), 'expiresAt должен быть в будущем')
  .optional();

/** Супер-админ создаёт ключ пользователю — сразу APPROVED. */
export const AdminCreateKeySchema = z.object({
  name: z.string().min(1).max(80),
  modelIds: z.array(z.string()).optional(),
  expiresAt: futureOrAbsent,
});
export type AdminCreateKeyInput = z.infer<typeof AdminCreateKeySchema>;

export const AdminKeysQuerySchema = ListQuerySchema.extend({
  status: ApiKeyStatusSchema.optional(),
  userId: z.string().optional(),
});
export type AdminKeysQuery = z.infer<typeof AdminKeysQuerySchema>;

// ---------- модели ----------

export const CreateModelSchema = z.object({
  ollamaName: z.string().min(1).max(120),
  displayName: ModelDisplayName.optional(), // по умолчанию = ollamaName
  kind: ModelKindSchema.default('CHAT'),
  isEnabled: z.boolean().default(false),
});
export type CreateModelInput = z.infer<typeof CreateModelSchema>;

export const UpdateModelSchema = z
  .object({
    displayName: ModelDisplayName.optional(),
    kind: ModelKindSchema.optional(),
    isEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Пустое обновление' });
export type UpdateModelInput = z.infer<typeof UpdateModelSchema>;

// ---------- аналитика ----------

export const AnalyticsRangeSchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export type AnalyticsRange = z.infer<typeof AnalyticsRangeSchema>;

export const TimeseriesQuerySchema = AnalyticsRangeSchema.extend({
  bucket: z.enum(['minute', 'hour', 'day']).default('hour'),
});
export type TimeseriesQuery = z.infer<typeof TimeseriesQuerySchema>;

export const TopQuerySchema = AnalyticsRangeSchema.extend({
  by: z.enum(['user', 'apiKey', 'model']),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type TopQuery = z.infer<typeof TopQuerySchema>;
