import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type {
  AuthResult,
  LoginInput,
  PublicUser,
  RefreshResult,
  RegisterInput,
} from '@embeding/schemas/auth';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Role } from '../prisma/client';
import { toPublicUser, type DbUserLike } from '../common/mappers/user.mapper';
import { TokenService } from './token.service';

const BCRYPT_COST = 12;

@Injectable()
export class AuthService {
  // Фейковый хэш для выравнивания тайминга при несуществующем пользователе.
  private readonly dummyHash = bcrypt.hashSync('timing-dummy-password', BCRYPT_COST);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async register(
    input: RegisterInput,
  ): Promise<AuthResult & { refreshToken: string }> {
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
    try {
      const user = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          displayName: input.displayName ?? null,
          role: Role.USER,
        },
      });
      return this.buildAuthResult(user);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Пользователь с таким email уже существует');
      }
      throw e;
    }
  }

  async login(input: LoginInput): Promise<AuthResult & { refreshToken: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
    if (!user) {
      await bcrypt.compare(input.password, this.dummyHash); // тайминг
      throw new UnauthorizedException('Неверный email или пароль');
    }
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Неверный email или пароль');
    if (!user.isActive) throw new ForbiddenException('Учётная запись заблокирована');
    return this.buildAuthResult(user);
  }

  async refresh(
    raw: string | undefined,
  ): Promise<RefreshResult & { refreshToken: string }> {
    if (!raw) throw new UnauthorizedException('Отсутствует refresh-токен');
    const { userId, newRawToken } = await this.tokens.rotateRefreshToken(raw);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      await this.tokens.revokeAllForUser(userId);
      throw new UnauthorizedException('Учётная запись недоступна');
    }
    const access = await this.tokens.issueAccessToken(user);
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: newRawToken,
    };
  }

  async logout(raw: string | undefined): Promise<void> {
    if (raw) await this.tokens.revokeRefreshToken(raw);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return toPublicUser(user);
  }

  private async buildAuthResult(
    user: DbUserLike,
  ): Promise<AuthResult & { refreshToken: string }> {
    const access = await this.tokens.issueAccessToken(user);
    const refreshToken = await this.tokens.issueRefreshToken(user.id);
    return {
      user: toPublicUser(user),
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken,
    };
  }
}
