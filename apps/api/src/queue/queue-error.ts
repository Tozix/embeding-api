import { OpenAiHttpException } from '../common/http/openai-error';

// BullMQ передаёт ошибку между воркером и ожидающим обработчиком как строку (failedReason).
// Чтобы не терять HTTP-статус и OpenAI-конверт, кодируем их в message и восстанавливаем на той стороне.
const MARKER = '__OAIERR__';

export function serializeJobError(e: unknown): string {
  if (e instanceof OpenAiHttpException) {
    return MARKER + JSON.stringify({ status: e.getStatus(), body: e.getResponse() });
  }
  return (
    MARKER +
    JSON.stringify({
      status: 500,
      body: {
        error: {
          message: 'Internal server error',
          type: 'api_error',
          code: 'internal_error',
        },
      },
    })
  );
}

export function deserializeJobError(e: unknown): OpenAiHttpException {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.startsWith(MARKER)) {
    try {
      const parsed = JSON.parse(msg.slice(MARKER.length)) as {
        status: number;
        body: { error: { message: string; type: string; param?: string | null; code?: string | null } };
      };
      return new OpenAiHttpException(parsed.status, parsed.body.error);
    } catch {
      /* не наш формат — ниже */
    }
  }
  // BullMQ stalled/timeout или иная инфраструктурная ошибка → трактуем как недоступность upstream
  return new OpenAiHttpException(502, {
    message: 'Upstream model server error',
    type: 'api_error',
    code: 'upstream_error',
  });
}
