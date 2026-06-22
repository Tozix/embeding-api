import { z } from 'zod';

// Дубликаты enum'ов Prisma на уровне контрактов: слои НЕ зависят от сгенерированного
// Prisma-клиента, а фронтенд вообще его не имеет. Значения обязаны совпадать со schema.prisma.
export const RoleSchema = z.enum(['USER', 'SUPERADMIN']);
export type Role = z.infer<typeof RoleSchema>;

export const ApiKeyStatusSchema = z.enum(['PENDING', 'APPROVED', 'REVOKED']);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;

export const ModelKindSchema = z.enum(['EMBEDDING', 'CHAT']);
export type ModelKind = z.infer<typeof ModelKindSchema>;

/** Email с нормализацией (trim + lowercase) ДО валидации — чтобы User.email @unique был устойчив к регистру. */
export const EmailSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.email(),
);
