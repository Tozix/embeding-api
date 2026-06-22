import { z } from 'zod';
import {
  ChatCompletionRequestSchema,
  ChatCompletionResponseSchema,
  EmbeddingsRequestSchema,
  EmbeddingsResponseSchema,
  ModelsListSchema,
  OpenAIErrorSchema,
} from '@embeding/schemas/openai';
import {
  ApiKeyCreatedSchema,
  ApiKeyPublicSchema,
  AuthResultSchema,
  CreateApiKeySchema,
  LoginSchema,
  PublicUserSchema,
  RegisterSchema,
} from '@embeding/schemas/auth';

/** Zod → JSON Schema (для OpenAPI components). io:'input' для тел запросов, 'output' для ответов. */
function jsonSchema(
  schema: z.ZodType,
  io: 'input' | 'output' = 'output',
): Record<string, unknown> {
  const s = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
  delete s.$schema;
  return s;
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const ERROR_RESPONSES = (...codes: [number, string][]) =>
  Object.fromEntries(
    codes.map(([code, description]) => [
      String(code),
      {
        description,
        content: { 'application/json': { schema: ref('Error') } },
      },
    ]),
  );

let cached: Record<string, unknown> | null = null;

/** Строит OpenAPI 3.1 документ. Кэшируется (схемы статичны). */
export function buildOpenApiDocument(): Record<string, unknown> {
  if (cached) return cached;

  cached = {
    openapi: '3.1.0',
    info: {
      title: 'embeding API',
      version: '1.0.0',
      description: [
        'OpenAI-совместимый шлюз к локальным моделям Ollama (эмбеддинги и чат).',
        '',
        '## Аутентификация',
        '- **API-ключ** (`Authorization: Bearer sk-emb-…`) — для `/v1/*`. Ключ работает,',
        '  только когда супер-админ перевёл его в статус `APPROVED`.',
        '- **JWT** (`Authorization: Bearer <access>`) — для кабинета (`/auth/*`, `/keys`).',
        '',
        '## Как начать',
        '1. Зарегистрируйтесь (`POST /auth/register`).',
        '2. Создайте ключ (`POST /keys`) — он будет в статусе `pending`.',
        '3. Дождитесь одобрения супер-админом (`approved`).',
        '4. Используйте ключ с любым OpenAI SDK: `base_url=<хост>/v1`.',
      ].join('\n'),
    },
    servers: [{ url: '/', description: 'Текущий хост (same-origin)' }],
    tags: [
      { name: 'OpenAI', description: 'OpenAI-совместимые эндпоинты `/v1/*` (Bearer API-ключ)' },
      { name: 'Auth', description: 'Регистрация и вход в кабинет (JWT)' },
      { name: 'API Keys', description: 'Управление своими API-ключами (JWT)' },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'API-ключ вида `sk-emb-…` (статус APPROVED)',
        },
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT access-токен из `/auth/login`',
        },
      },
      schemas: {
        Error: jsonSchema(OpenAIErrorSchema),
        EmbeddingsRequest: jsonSchema(EmbeddingsRequestSchema, 'input'),
        EmbeddingsResponse: jsonSchema(EmbeddingsResponseSchema),
        ChatCompletionRequest: jsonSchema(ChatCompletionRequestSchema, 'input'),
        ChatCompletionResponse: jsonSchema(ChatCompletionResponseSchema),
        ModelsList: jsonSchema(ModelsListSchema),
        RegisterInput: jsonSchema(RegisterSchema, 'input'),
        LoginInput: jsonSchema(LoginSchema, 'input'),
        AuthResult: jsonSchema(AuthResultSchema),
        PublicUser: jsonSchema(PublicUserSchema),
        CreateApiKeyInput: jsonSchema(CreateApiKeySchema, 'input'),
        ApiKeyPublic: jsonSchema(ApiKeyPublicSchema),
        ApiKeyCreated: jsonSchema(ApiKeyCreatedSchema),
      },
    },
    paths: {
      '/v1/embeddings': {
        post: {
          tags: ['OpenAI'],
          summary: 'Создать эмбеддинги',
          description:
            'Возвращает по одному вектору на каждый элемент `input`. Модель должна быть включена админом и доступна ключу.',
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: ref('EmbeddingsRequest'),
                example: { model: 'nomic-embed-text', input: 'Привет, мир!' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Список эмбеддингов',
              content: {
                'application/json': {
                  schema: ref('EmbeddingsResponse'),
                  example: {
                    object: 'list',
                    data: [
                      {
                        object: 'embedding',
                        index: 0,
                        embedding: [0.0023, -0.0091, 0.0145, '…(768 чисел)'],
                      },
                    ],
                    model: 'nomic-embed-text',
                    usage: { prompt_tokens: 5, total_tokens: 5 },
                  },
                },
              },
            },
            ...ERROR_RESPONSES(
              [400, 'Некорректный запрос'],
              [401, 'Невалидный ключ'],
              [403, 'Ключ не одобрен / нет доступа к модели'],
              [502, 'Ollama недоступна'],
            ),
          },
        },
      },
      '/v1/chat/completions': {
        post: {
          tags: ['OpenAI'],
          summary: 'Чат-комплишены (со стримингом)',
          description:
            'При `stream: false` возвращает один JSON. При `stream: true` — поток `text/event-stream`: строки `data: {chat.completion.chunk}` и финальная `data: [DONE]`.',
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: ref('ChatCompletionRequest'),
                examples: {
                  simple: {
                    summary: 'Обычный запрос',
                    value: {
                      model: 'qwen2.5:7b',
                      messages: [{ role: 'user', content: 'Столица Франции?' }],
                    },
                  },
                  streaming: {
                    summary: 'Стриминг + usage',
                    value: {
                      model: 'qwen2.5:7b',
                      messages: [{ role: 'user', content: 'Считай до 5' }],
                      stream: true,
                      stream_options: { include_usage: true },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description:
                'Ответ (non-stream) или SSE-поток чанков (stream). Ниже — non-stream.',
              content: {
                'application/json': {
                  schema: ref('ChatCompletionResponse'),
                  example: {
                    id: 'chatcmpl-abc123',
                    object: 'chat.completion',
                    created: 1782119276,
                    model: 'qwen2.5:7b',
                    choices: [
                      {
                        index: 0,
                        message: { role: 'assistant', content: 'Париж.' },
                        finish_reason: 'stop',
                      },
                    ],
                    usage: {
                      prompt_tokens: 12,
                      completion_tokens: 2,
                      total_tokens: 14,
                    },
                  },
                },
                'text/event-stream': {
                  example:
                    'data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Па"},"finish_reason":null}]}\n\ndata: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"риж"},"finish_reason":null}]}\n\ndata: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
                },
              },
            },
            ...ERROR_RESPONSES(
              [400, 'Некорректный запрос'],
              [401, 'Невалидный ключ'],
              [403, 'Ключ не одобрен / нет доступа к модели'],
              [502, 'Ollama недоступна'],
            ),
          },
        },
      },
      '/v1/models': {
        get: {
          tags: ['OpenAI'],
          summary: 'Список доступных моделей',
          security: [{ ApiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Модели, доступные ключу',
              content: {
                'application/json': {
                  schema: ref('ModelsList'),
                  example: {
                    object: 'list',
                    data: [
                      {
                        id: 'nomic-embed-text',
                        object: 'model',
                        created: 1782105730,
                        owned_by: 'ollama',
                      },
                    ],
                  },
                },
              },
            },
            ...ERROR_RESPONSES([401, 'Невалидный ключ'], [403, 'Ключ не одобрен']),
          },
        },
      },
      '/v1/models/{model}': {
        get: {
          tags: ['OpenAI'],
          summary: 'Получить модель по id',
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: 'model',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              example: 'nomic-embed-text',
            },
          ],
          responses: {
            '200': {
              description: 'Объект модели',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            ...ERROR_RESPONSES([404, 'Модель не найдена']),
          },
        },
      },
      '/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Регистрация',
          description: 'Создаёт пользователя и возвращает access-токен (+ refresh в httpOnly cookie).',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: ref('RegisterInput'),
                example: {
                  email: 'user@example.com',
                  password: 'надёжный-пароль',
                  displayName: 'Имя',
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Пользователь создан',
              content: { 'application/json': { schema: ref('AuthResult') } },
            },
            ...ERROR_RESPONSES([400, 'Ошибка валидации'], [409, 'Email уже занят']),
          },
        },
      },
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Вход',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: ref('LoginInput'),
                example: { email: 'user@example.com', password: 'надёжный-пароль' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Успешный вход',
              content: { 'application/json': { schema: ref('AuthResult') } },
            },
            ...ERROR_RESPONSES([401, 'Неверный email или пароль']),
          },
        },
      },
      '/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'Текущий пользователь',
          security: [{ BearerAuth: [] }],
          responses: {
            '200': {
              description: 'Профиль',
              content: { 'application/json': { schema: ref('PublicUser') } },
            },
            ...ERROR_RESPONSES([401, 'Не авторизован']),
          },
        },
      },
      '/keys': {
        get: {
          tags: ['API Keys'],
          summary: 'Мои ключи',
          security: [{ BearerAuth: [] }],
          responses: {
            '200': {
              description: 'Список ключей',
              content: {
                'application/json': {
                  schema: { type: 'array', items: ref('ApiKeyPublic') },
                },
              },
            },
          },
        },
        post: {
          tags: ['API Keys'],
          summary: 'Создать ключ (→ pending)',
          description:
            'Возвращает СЫРОЙ ключ один раз (поле `key`). Он не работает, пока супер-админ не одобрит его.',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: ref('CreateApiKeyInput'),
                example: { name: 'Мой ключ' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Ключ создан (сырой ключ показан один раз)',
              content: {
                'application/json': {
                  schema: ref('ApiKeyCreated'),
                  example: {
                    id: 'cmq…',
                    name: 'Мой ключ',
                    keyPrefix: 'sk-emb-0aGOuq…',
                    status: 'PENDING',
                    createdAt: '2026-06-22T05:21:40.316Z',
                    approvedAt: null,
                    expiresAt: null,
                    lastUsedAt: null,
                    key: 'sk-emb-0aGOuqmd3dA6euxV-JBd2bn2BQAoRl0oyLAeQcYxmTA',
                  },
                },
              },
            },
          },
        },
      },
      '/keys/{id}': {
        delete: {
          tags: ['API Keys'],
          summary: 'Отозвать свой ключ',
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { '204': { description: 'Отозван' } },
        },
      },
    },
  };

  return cached;
}
