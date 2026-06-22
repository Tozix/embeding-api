import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../constants';

/** Помечает маршрут публичным (опт-аут из JwtAuthGuard, если тот применён глобально). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
