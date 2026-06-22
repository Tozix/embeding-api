import { z } from 'zod';

/** Схема переменных окружения. Невалидный конфиг роняет приложение на старте. */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),

  // --- Ollama ---
  OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  OLLAMA_KEEP_ALIVE: z.string().default('5m'),

  // --- Redis (очередь BullMQ) ---
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),

  // --- Конкуренция инференса (CPU-only): chat сериализуем, embeddings допускаем параллель ---
  CHAT_CONCURRENCY: z.coerce.number().int().positive().default(1),
  EMBED_CONCURRENCY: z.coerce.number().int().positive().default(3),

  // --- JWT (access — JWT, refresh — opaque) ---
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16), // зарезервировано (refresh opaque, в JWT не подписывается)
  JWT_ACCESS_TTL: z.string().default('15m'), // формат vercel/ms: 15m, 1h, 30d
  JWT_REFRESH_TTL: z.string().default('30d'),

  // --- API-ключи ---
  APIKEY_HMAC_SECRET: z.string().min(32), // pepper для HMAC-SHA256 хэша ключей

  // --- Веб / CORS / cookie ---
  WEB_ORIGIN: z.string().default('http://localhost:3001'), // список через запятую
  COOKIE_DOMAIN: z.string().optional(),

  // --- Лимиты ---
  HTTP_BODY_LIMIT: z.string().default('25mb'),
  MAX_EMBED_INPUT_ITEMS: z.coerce.number().int().positive().default(2048),
  MAX_EMBED_INPUT_CHARS: z.coerce.number().int().positive().default(1_000_000),

  // --- Супер-админ (сид) ---
  SUPERADMIN_EMAIL: z.email(),
  SUPERADMIN_PASSWORD: z.string().min(8),
});

export type Env = z.infer<typeof EnvSchema>;

/** Валидатор для ConfigModule.forRoot({ validate }). */
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(
      `Некорректные переменные окружения:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}
