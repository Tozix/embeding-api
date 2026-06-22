// Запускается Bun'ом ДО загрузки приложения (см. bunfig.toml preload).
// msgpackr (через BullMQ) пытается подгрузить нативный msgpackr-extract, который крашит Bun
// (uv_version_string не реализован). Отключаем нативный ускоритель — msgpackr работает на чистом JS.
process.env.MSGPACKR_NATIVE_ACCELERATION_DISABLED ??= 'true';
