import { z } from 'zod';
import { ApiKeyStatusSchema, EmailSchema, RoleSchema } from '../common/enums.js';

// ---------- входные DTO ----------

/** Регистрация пользователя (веб-кабинет). */
export const RegisterSchema = z.object({
  email: EmailSchema,
  password: z.string().min(8, 'Пароль не короче 8 символов').max(200),
  displayName: z.string().min(1).max(80).optional(),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

/** Вход пользователя. */
export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginSchema>;

/** Создание пользователем API-ключа (попадает в статус PENDING до одобрения супер-админом). */
export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(80),
  // ограничить ключ списком id моделей; пусто/отсутствует = доступ ко всем globally enabled
  modelIds: z.array(z.string()).optional(),
  expiresAt: z.iso.datetime().optional(),
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;

// ---------- ответы / payload ----------

/** Пользователь в том виде, в каком он уходит наружу (без passwordHash). createdAt — ISO-строка. */
export const PublicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  role: RoleSchema,
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

/** Ответ register/login: access — в теле, refresh уходит httpOnly cookie (в теле его нет). */
export const AuthResultSchema = z.object({
  user: PublicUserSchema,
  accessToken: z.string(),
  expiresIn: z.number().int().positive(), // секунды жизни access
});
export type AuthResult = z.infer<typeof AuthResultSchema>;

/** Ответ /auth/refresh. */
export const RefreshResultSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type RefreshResult = z.infer<typeof RefreshResultSchema>;

/** Полезная нагрузка access-JWT (плюс iat/exp добавляет сам jwt). */
export const JwtAccessPayloadSchema = z.object({
  sub: z.string(),
  email: z.string(),
  role: RoleSchema,
});
export type JwtAccessPayload = z.infer<typeof JwtAccessPayloadSchema>;

/** Нормализованный аутентифицированный пользователь (кладётся guard'ом в req.user). */
export type AuthUser = {
  id: string;
  email: string;
  role: z.infer<typeof RoleSchema>;
};

// ---------- представления API-ключа ----------

export const ApiKeyPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  keyPrefix: z.string(),
  status: ApiKeyStatusSchema,
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
});
export type ApiKeyPublic = z.infer<typeof ApiKeyPublicSchema>;

/** Возвращается ОДИН раз при создании ключа: содержит сырой ключ (`key`), больше его не показать. */
export const ApiKeyCreatedSchema = ApiKeyPublicSchema.extend({
  key: z.string(),
});
export type ApiKeyCreated = z.infer<typeof ApiKeyCreatedSchema>;
