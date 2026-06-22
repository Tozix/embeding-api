// Префикс OpenAI-совместимых маршрутов — по нему AllExceptionsFilter выбирает формат ошибки.
export const V1_PREFIX = '/v1/';

// Ключи метаданных для guard'ов.
export const ROLES_KEY = 'roles';
export const IS_PUBLIC_KEY = 'isPublic';

// Refresh-токен: httpOnly cookie, ограниченная путём /auth.
export const REFRESH_COOKIE_NAME = 'embeding_refresh';
export const REFRESH_COOKIE_PATH = '/auth';

// Префикс API-ключей (виден в открытом виде, не секрет).
export const API_KEY_PREFIX = 'sk-emb-';
