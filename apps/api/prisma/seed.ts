// Сид супер-админа из ENV. Идемпотентен (upsert по email).
// Запуск: `bun run db:seed` (требует сгенерированного клиента и доступной БД).
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from '../src/prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main(): Promise<void> {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'SUPERADMIN_EMAIL и SUPERADMIN_PASSWORD должны быть заданы в окружении',
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: Role.SUPERADMIN, isActive: true },
    create: {
      email,
      passwordHash,
      role: Role.SUPERADMIN,
      displayName: 'Super Admin',
    },
  });

  console.log(`Супер-админ готов: ${admin.email} (${admin.id})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
