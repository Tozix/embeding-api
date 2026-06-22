import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  // bodyParser:false — настраиваем парсеры сами (нужен увеличенный лимит для embeddings).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config: ConfigService<Env, true> = app.get(ConfigService);

  app.set('trust proxy', 1); // за хостовым nginx (Secure-cookie, req.ip)

  const bodyLimit = config.get('HTTP_BODY_LIMIT', { infer: true });
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { extended: true, limit: bodyLimit });

  app.use(cookieParser());

  app.enableCors({
    origin: config
      .get('WEB_ORIGIN', { infer: true })
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    credentials: true,
  });

  app.enableShutdownHooks();

  // ВАЖНО: глобальный префикс НЕ ставим — /v1/* должен совпадать с путями OpenAI 1:1.
  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  console.log(`API слушает http://0.0.0.0:${port}`);
}

void bootstrap();
