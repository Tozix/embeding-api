import { SetMetadata } from '@nestjs/common';
import type { Role } from '@embeding/schemas/enums';
import { ROLES_KEY } from '../constants';

/** Ограничивает маршрут ролями (проверяется RolesGuard после JwtAuthGuard). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
