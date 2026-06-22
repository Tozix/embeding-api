import { expect, test } from 'bun:test';
import { LoginSchema, RegisterSchema } from '../src/auth/index';
import { EmbeddingsRequestSchema } from '../src/openai/embeddings';
import { ChatCompletionRequestSchema } from '../src/openai/chat';
import { AdminCreateUserSchema } from '../src/admin/index';

test('AdminCreateUserSchema: нормализация email, дефолт роли USER, минимум пароля', () => {
  const r = AdminCreateUserSchema.parse({ email: ' Boss@X.COM ', password: 'password123' });
  expect(r.email).toBe('boss@x.com');
  expect(r.role).toBe('USER');
  expect(
    AdminCreateUserSchema.safeParse({ email: 'a@b.co', password: 'short' }).success,
  ).toBe(false);
  expect(
    AdminCreateUserSchema.safeParse({
      email: 'a@b.co',
      password: 'password123',
      role: 'SUPERADMIN',
    }).data?.role,
  ).toBe('SUPERADMIN');
});

test('email нормализуется (trim + lowercase)', () => {
  const r = RegisterSchema.parse({
    email: '  User@Example.COM ',
    password: 'password123',
  });
  expect(r.email).toBe('user@example.com');
  const l = LoginSchema.parse({ email: 'A@B.Co', password: 'x' });
  expect(l.email).toBe('a@b.co');
});

test('register: пароль < 8 символов отклоняется', () => {
  expect(
    RegisterSchema.safeParse({ email: 'a@b.co', password: 'short' }).success,
  ).toBe(false);
});

test('embeddings: строка и массив строк валидны', () => {
  expect(EmbeddingsRequestSchema.safeParse({ model: 'm', input: 'hi' }).success).toBe(
    true,
  );
  expect(
    EmbeddingsRequestSchema.safeParse({ model: 'm', input: ['a', 'b'] }).success,
  ).toBe(true);
});

test('chat: stream_options ок, неизвестные поля игнорируются (forward-compat)', () => {
  const r = ChatCompletionRequestSchema.parse({
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
    stream_options: { include_usage: true },
    logprobs: true, // незнакомое поле OpenAI SDK — не strict, отбрасывается
  });
  expect(r.stream).toBe(true);
  expect(r.stream_options?.include_usage).toBe(true);
  expect((r as Record<string, unknown>).logprobs).toBeUndefined();
});
