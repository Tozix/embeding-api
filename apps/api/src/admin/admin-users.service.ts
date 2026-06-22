import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PublicUser } from '@embeding/schemas/auth';
import type { AdminUpdateUserInput, ListQuery } from '@embeding/schemas/admin';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Role } from '../prisma/client';
import { toPublicUser } from '../common/mappers/user.mapper';

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListQuery): Promise<{
    items: PublicUser[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.user.count(),
    ]);
    return {
      items: rows.map(toPublicUser),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return toPublicUser(user);
  }

  async update(id: string, dto: AdminUpdateUserInput): Promise<PublicUser> {
    return this.serializable(async (tx) => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw new NotFoundException('Пользователь не найден');

      const willBeActiveAdmin =
        (dto.role ?? user.role) === Role.SUPERADMIN &&
        (dto.isActive ?? user.isActive);
      const wasActiveAdmin = user.role === Role.SUPERADMIN && user.isActive;
      if (wasActiveAdmin && !willBeActiveAdmin) {
        await this.assertAnotherActiveAdminExists(tx, id);
      }

      const updated = await tx.user.update({
        where: { id },
        data: {
          role: dto.role,
          isActive: dto.isActive,
          // undefined = без изменения; null = очистить displayName
          displayName: dto.displayName === undefined ? undefined : dto.displayName,
        },
      });
      return toPublicUser(updated);
    });
  }

  async remove(id: string): Promise<void> {
    await this.serializable(async (tx) => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw new NotFoundException('Пользователь не найден');
      if (user.role === Role.SUPERADMIN && user.isActive) {
        await this.assertAnotherActiveAdminExists(tx, id);
      }
      // refresh-токены и ключи удалятся каскадно (onDelete: Cascade в схеме)
      await tx.user.delete({ where: { id } });
    });
  }

  private async assertAnotherActiveAdminExists(
    tx: Prisma.TransactionClient,
    excludeId: string,
  ): Promise<void> {
    const others = await tx.user.count({
      where: { role: Role.SUPERADMIN, isActive: true, id: { not: excludeId } },
    });
    if (others === 0) {
      throw new ConflictException(
        'Нельзя оставить систему без активного супер-админа',
      );
    }
  }

  /** Serializable-транзакция с одной повторной попыткой при write-conflict (P2034). */
  private async serializable<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: 'Serializable',
        });
      } catch (e) {
        if (
          attempt === 0 &&
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2034'
        ) {
          continue;
        }
        throw e;
      }
    }
  }
}
