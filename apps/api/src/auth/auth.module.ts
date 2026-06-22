import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import type { Env } from '../config/env';

@Module({
  imports: [
    // access-JWT: секрет и TTL — из валидированного ENV. refresh — opaque (не JWT).
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_ACCESS_TTL', { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, JwtAuthGuard, RolesGuard],
  // Экспортируем guard'ы и TokenService — их используют ApiKeys/Admin/OpenAI модули.
  exports: [TokenService, JwtAuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
