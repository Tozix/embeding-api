import { expect, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { OpenAiHttpException } from '../../src/common/http/openai-error';

function fakeHost(method: string, url: string) {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(c: number) {
      captured.status = c;
      return res;
    },
    json(b: unknown) {
      captured.body = b;
      return res;
    },
  };
  const req = { method, url, originalUrl: url };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { host: host as any, captured };
}

const filter = new AllExceptionsFilter();

test('/v1/* валидация → OpenAI-конверт', () => {
  const { host, captured } = fakeHost('POST', '/v1/embeddings');
  filter.catch(new BadRequestException({ message: 'bad', issues: [] }), host);
  expect(captured.status).toBe(400);
  const b = captured.body as { error?: { type: string } };
  expect(b.error?.type).toBe('invalid_request_error');
});

test('/auth/* → обычный Nest JSON (не конверт)', () => {
  const { host, captured } = fakeHost('POST', '/auth/login');
  filter.catch(new BadRequestException({ message: 'bad' }), host);
  expect(captured.status).toBe(400);
  const b = captured.body as { statusCode?: number; error?: unknown };
  expect(b.statusCode).toBe(400);
  expect(b.error).toBeUndefined();
});

test('/v1/* 5xx → generic message, без утечки', () => {
  const { host, captured } = fakeHost('POST', '/v1/chat/completions');
  filter.catch(new Error('secret prisma path'), host);
  expect(captured.status).toBe(500);
  const b = captured.body as { error: { message: string } };
  expect(b.error.message).toBe('Internal server error');
});

test('/v1/* уважает заданный OpenAiHttpException', () => {
  const { host, captured } = fakeHost('GET', '/v1/models/foo');
  filter.catch(
    new OpenAiHttpException(404, {
      message: 'no',
      type: 'invalid_request_error',
      code: 'model_not_found',
    }),
    host,
  );
  expect(captured.status).toBe(404);
  const b = captured.body as { error: { code: string } };
  expect(b.error.code).toBe('model_not_found');
});
