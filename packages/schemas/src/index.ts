// Единый источник правды для контрактов API.
// Эти схемы переиспользуются и бэкендом (DTO/валидация), и фронтендом (типы) — не дублируй формы данных.
export * as openai from './openai/index.js';
export * as auth from './auth/index.js';
export * as admin from './admin/index.js';
export * as enums from './common/enums.js';
