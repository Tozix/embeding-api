import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { API_KEY_PREFIX } from '../constants';

/**
 * Генерирует новый API-ключ. Сырой ключ возвращается ОДИН раз (показать пользователю),
 * в БД хранится только HMAC-хэш и публичный префикс.
 */
export function generateApiKey(): { raw: string; prefix: string } {
  const secret = randomBytes(32).toString('base64url'); // 256 бит энтропии
  const raw = `${API_KEY_PREFIX}${secret}`;
  const prefix = `${API_KEY_PREFIX}${secret.slice(0, 6)}…`;
  return { raw, prefix };
}

/**
 * HMAC-SHA256(ключ, pepper). Pepper (APIKEY_HMAC_SECRET) — серверный секрет:
 * при утечке дампа БД без него подтвердить/перебрать ключи невозможно.
 * Детерминирован → пригоден для lookup по keyHash @unique.
 */
export function hashApiKey(raw: string, pepper: string): string {
  return createHmac('sha256', pepper).update(raw).digest('hex');
}

/** Константное по времени сравнение hex-строк равной длины. */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
