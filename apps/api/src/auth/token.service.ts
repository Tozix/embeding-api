import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import {
  JwtAccessPayloadSchema,
  type JwtAccessPayload,
} from '@embeding/schemas/auth';
import { PrismaService } from '../prisma/prisma.service';
import { parseDurationMs, parseDurationSec } from '../common/crypto/ms';
import type { Env } from '../config/env';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Подписывает короткоживущий access-JWT. */
  async issueAccessToken(user: {
    id: string;
    email: string;
    role: JwtAccessPayload['role'];
  }): Promise<{ token: string; expiresIn: number }> {
    const payload: JwtAccessPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const token = await this.jwt.signAsync(payload);
    const expiresIn = parseDurationSec(
      this.config.get('JWT_ACCESS_TTL', { infer: true }),
    );
    return { token, expiresIn };
  }

  /** Создаёт refresh-токен: в БД кладётся только sha256-хэш, наружу уходит сырой токен. */
  async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + parseDurationMs(this.config.get('JWT_REFRESH_TTL', { infer: true })),
    );
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: this.hashToken(raw), expiresAt },
    });
    return raw;
  }

  /**
   * Ротация: гасит предъявленный токен и выпускает новый.
   * Если предъявлен УЖЕ отозванный токен — это reuse-инцидент: гасим все сессии пользователя.
   */
  async rotateRefreshToken(
    raw: string,
  ): Promise<{ userId: string; newRawToken: string }> {
    const tokenHash = this.hashToken(raw);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!record) throw new UnauthorizedException('Невалидный refresh-токен');
    if (record.revokedAt) {
      await this.revokeAllForUser(record.userId);
      throw new UnauthorizedException(
        'Повторное использование refresh-токена — все сессии отозваны',
      );
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh-токен истёк');
    }
    // Атомарный захват: гасим строку, только если она ВСЁ ЕЩЁ активна (revokedAt:null).
    // count===0 → конкурентный запрос уже захватил тот же токен (гонка/reuse) → гасим все
    // сессии. Так read-check-update больше не гонится: из двух параллельных запросов с одним
    // токеном выигрывает ровно один, второй трактуется как reuse.
    const claim = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claim.count === 0) {
      await this.revokeAllForUser(record.userId);
      throw new UnauthorizedException(
        'Повторное использование refresh-токена — все сессии отозваны',
      );
    }
    const newRawToken = await this.issueRefreshToken(record.userId);
    return { userId: record.userId, newRawToken };
  }

  async revokeRefreshToken(raw: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Проверяет access-JWT и валидирует payload Zod-схемой. */
  async verifyAccessToken(token: string): Promise<JwtAccessPayload> {
    const raw: unknown = await this.jwt.verifyAsync(token);
    return JwtAccessPayloadSchema.parse(raw);
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
