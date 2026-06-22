// Клиент к NestJS API. Access-токен держим в памяти, refresh — в httpOnly cookie (credentials:include).
// В проде фронт и API за одним хостовым nginx (same-origin) → BASE пуст. Для кросс-порт dev: WAKU_PUBLIC_API_URL.

const BASE = (
  (import.meta as { env?: Record<string, string | undefined> }).env
    ?.WAKU_PUBLIC_API_URL ?? ''
).replace(/\/$/, '');

/** База API (пусто = same-origin за nginx). Нужна, напр., для ссылки на /reference (Swagger). */
export const API_BASE = BASE;

let accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

/** Пытается обновить access-токен по refresh-cookie. Дедуплицирует параллельные попытки. */
async function refresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (r) => {
        if (!r.ok) return false;
        const d = (await r.json()) as { accessToken: string };
        accessToken = d.accessToken;
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

/** Восстановление сессии при загрузке приложения. */
export async function bootstrapSession(): Promise<boolean> {
  return refresh();
}

type Opts = { method?: string; body?: unknown; retry?: boolean };

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && opts.retry !== false && (await refresh())) {
    return api<T>(path, { ...opts, retry: false });
  }

  const raw = await res.text();
  const data: unknown = raw ? JSON.parse(raw) : undefined;
  if (!res.ok) {
    const d = data as { error?: { message?: string }; message?: string | string[] };
    const m = d?.error?.message ?? d?.message ?? `Ошибка ${res.status}`;
    throw new ApiError(res.status, Array.isArray(m) ? m.join('; ') : m, data);
  }
  return data as T;
}

/**
 * SSE через fetch-стрим (а не EventSource, т.к. нужен заголовок Authorization).
 * Вызывает onEvent для каждого распарсенного data-объекта; останавливается по signal.
 */
export async function streamSse(
  path: string,
  onEvent: (data: unknown) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    signal,
  });
  if (!res.ok || !res.body) throw new ApiError(res.status, 'SSE недоступен');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (line) {
        try {
          onEvent(JSON.parse(line.slice(5).trim()));
        } catch {
          /* пропускаем некорректный кадр */
        }
      }
    }
  }
}
