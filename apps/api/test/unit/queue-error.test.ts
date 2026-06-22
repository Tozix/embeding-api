import { expect, test } from 'bun:test';
import {
  deserializeJobError,
  serializeJobError,
} from '../../src/queue/queue-error';
import { OpenAiHttpException } from '../../src/common/http/openai-error';

test('round-trip сохраняет статус и конверт OpenAiHttpException', () => {
  const original = new OpenAiHttpException(404, {
    message: 'no model',
    type: 'invalid_request_error',
    param: 'model',
    code: 'model_not_found',
  });
  const restored = deserializeJobError(new Error(serializeJobError(original)));
  expect(restored).toBeInstanceOf(OpenAiHttpException);
  expect(restored.getStatus()).toBe(404);
  const body = restored.getResponse() as { error: { code: string; type: string } };
  expect(body.error.code).toBe('model_not_found');
  expect(body.error.type).toBe('invalid_request_error');
});

test('обычная ошибка → 500 generic через границу', () => {
  const restored = deserializeJobError(new Error(serializeJobError(new Error('boom'))));
  expect(restored.getStatus()).toBe(500);
  const body = restored.getResponse() as { error: { message: string } };
  expect(body.error.message).toBe('Internal server error');
});

test('не наш формат (BullMQ stalled) → 502 upstream', () => {
  const restored = deserializeJobError(new Error('job stalled more than allowable limit'));
  expect(restored.getStatus()).toBe(502);
  const body = restored.getResponse() as { error: { code: string } };
  expect(body.error.code).toBe('upstream_error');
});
