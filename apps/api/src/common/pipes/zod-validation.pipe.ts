import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { z, type ZodType } from 'zod';

/**
 * Нейтральный pipe: валидирует значение Zod-схемой и бросает обычный BadRequestException.
 * Конверт ошибки (OpenAI vs Nest) выбирает ЕДИНСТВЕННЫЙ глобальный AllExceptionsFilter —
 * pipe про /v1/ ничего не знает. Использование: @Body(new ZodValidationPipe(LoginSchema)).
 */
@Injectable()
export class ZodValidationPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Ошибка валидации запроса',
        issues: result.error.issues,
        pretty: z.prettifyError(result.error),
      });
    }
    return result.data;
  }
}
