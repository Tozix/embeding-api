import type { CookieOptions } from 'express';
import { REFRESH_COOKIE_PATH } from './constants';

/**
 * Опции refresh-cookie: httpOnly (защита от XSS-кражи), SameSite=Strict (защита от CSRF),
 * Path=/auth (cookie уходит только на /auth/refresh|logout), Secure в проде.
 */
export function refreshCookieOptions(opts: {
  maxAgeMs: number;
  secure: boolean;
  domain?: string;
}): CookieOptions {
  return {
    httpOnly: true,
    secure: opts.secure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: opts.maxAgeMs,
    ...(opts.domain ? { domain: opts.domain } : {}),
  };
}
