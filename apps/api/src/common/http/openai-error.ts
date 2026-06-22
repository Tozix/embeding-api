import { HttpException } from '@nestjs/common';

export type OpenAIErrorBody = {
  message: string;
  type: string;
  param?: string | null;
  code?: string | null;
};

/**
 * Носитель OpenAI-конверта ошибки. Бросается на маршрутах /v1/*; рендерит его
 * ТОЛЬКО глобальный AllExceptionsFilter (он уважает заданные здесь type/code).
 */
export class OpenAiHttpException extends HttpException {
  constructor(status: number, error: OpenAIErrorBody) {
    super({ error }, status);
  }
}

/** Фабрики типовых OpenAI-ошибок. */
export const openAiErrors = {
  invalidRequest: (message: string, param?: string, code?: string) =>
    new OpenAiHttpException(400, {
      message,
      type: 'invalid_request_error',
      param: param ?? null,
      code: code ?? null,
    }),
  authentication: (message = 'Invalid authentication credentials') =>
    new OpenAiHttpException(401, {
      message,
      type: 'authentication_error',
      code: 'invalid_api_key',
    }),
  permission: (message = 'You do not have access to this resource') =>
    new OpenAiHttpException(403, { message, type: 'permission_error' }),
  modelNotFound: (model: string) =>
    new OpenAiHttpException(404, {
      message: `The model '${model}' does not exist or you do not have access to it.`,
      type: 'invalid_request_error',
      param: 'model',
      code: 'model_not_found',
    }),
  upstream: (message = 'The upstream model server is unavailable') =>
    new OpenAiHttpException(502, {
      message,
      type: 'api_error',
      code: 'upstream_error',
    }),
};
