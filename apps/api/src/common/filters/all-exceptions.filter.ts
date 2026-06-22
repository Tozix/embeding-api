import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { V1_PREFIX } from '../constants';

type OpenAIEnvelope = {
  error: {
    message: string;
    type: string;
    param?: string | null;
    code?: string | null;
  };
};

/**
 * Единственный глобальный фильтр. Для /v1/* отдаёт конверт ошибки OpenAI, для остального —
 * обычный JSON Nest. Уважает заранее заданный OpenAI-конверт в payload (OpenAiHttpException)
 * и не перетирает его type/code. Для 5xx прячет детали (generic message), логируя полную ошибку.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const url = req.originalUrl ?? req.url ?? '';
    const isV1 = url.startsWith(V1_PREFIX);

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let payload: unknown;
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      payload = exception.getResponse();
    }

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body = isV1
      ? this.toOpenAIEnvelope(status, payload)
      : this.toNestJson(status, payload, url);
    res.status(status).json(body);
  }

  private isOpenAIEnvelope(p: unknown): p is OpenAIEnvelope {
    if (typeof p !== 'object' || p === null || !('error' in p)) return false;
    const err = (p as { error: unknown }).error;
    return (
      typeof err === 'object' &&
      err !== null &&
      typeof (err as { type?: unknown }).type === 'string'
    );
  }

  private toOpenAIEnvelope(status: number, payload: unknown): OpenAIEnvelope {
    if (this.isOpenAIEnvelope(payload)) return payload; // уважаем заданный конверт
    if (status >= 500) {
      return {
        error: {
          message: 'Internal server error',
          type: 'api_error',
          code: 'internal_error',
        },
      };
    }
    return {
      error: {
        message: this.extractMessage(payload) ?? 'Request failed',
        type: this.statusToType(status),
        param: null,
        code: null,
      },
    };
  }

  private toNestJson(
    status: number,
    payload: unknown,
    url: string,
  ): Record<string, unknown> {
    if (status >= 500) {
      return { statusCode: status, message: 'Internal server error', path: url };
    }
    if (typeof payload === 'object' && payload !== null) {
      return { statusCode: status, ...(payload as Record<string, unknown>) };
    }
    return {
      statusCode: status,
      message: this.extractMessage(payload) ?? 'Request failed',
    };
  }

  private extractMessage(payload: unknown): string | undefined {
    if (typeof payload === 'string') return payload;
    if (typeof payload === 'object' && payload !== null) {
      const obj = payload as Record<string, unknown>;
      if (typeof obj.message === 'string') return obj.message;
      if (Array.isArray(obj.message)) return obj.message.join('; ');
      if (typeof obj.pretty === 'string') return obj.pretty;
    }
    return undefined;
  }

  private statusToType(status: number): string {
    switch (status) {
      case 400:
        return 'invalid_request_error';
      case 401:
        return 'authentication_error';
      case 403:
        return 'permission_error';
      case 404:
        return 'not_found_error';
      case 429:
        return 'rate_limit_error';
      default:
        return status >= 500 ? 'api_error' : 'invalid_request_error';
    }
  }
}
