// Конфиг Prisma CLI (Prisma v7). URL миграций берётся из ENV здесь,
// а runtime-подключение PrismaClient идёт через driver adapter (@prisma/adapter-pg).
import { defineConfig, env } from 'prisma/config';

type Env = {
  DATABASE_URL: string;
};

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env<Env>('DATABASE_URL'),
  },
});
