import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { getAbsoluteFSPath } from 'swagger-ui-dist';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOpenApiDocument } from './openapi';

// Ассеты Swagger UI отдаём ЛОКАЛЬНО (из пакета swagger-ui-dist), без CDN — иначе белый экран,
// если внешний CDN недоступен.
const SWAGGER_DIR = getAbsoluteFSPath();
const ASSETS: Record<string, string> = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'application/javascript; charset=utf-8',
  'swagger-ui-standalone-preset.js': 'application/javascript; charset=utf-8',
};
const assetCache = new Map<string, Buffer>();

const REFERENCE_HTML = `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>embeding API — справочник</title>
    <link rel="stylesheet" href="/reference/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .swagger-ui .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/reference/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        tryItOutEnabled: true,
        defaultModelsExpandDepth: 1,
        presets: [SwaggerUIBundle.presets.apis],
      });
    </script>
  </body>
</html>`;

/** Публичная документация API: спека OpenAPI + интерактивный Swagger UI (self-hosted). Без auth. */
@Controller()
export class DocsController {
  @Get('openapi.json')
  spec(): Record<string, unknown> {
    return buildOpenApiDocument();
  }

  @Get('reference')
  @Header('content-type', 'text/html; charset=utf-8')
  reference(): string {
    return REFERENCE_HTML;
  }

  @Get('reference/:file')
  asset(@Param('file') file: string, @Res() res: Response): void {
    const type = ASSETS[file];
    if (!type) throw new NotFoundException();
    let buf = assetCache.get(file);
    if (!buf) {
      buf = readFileSync(join(SWAGGER_DIR, file));
      assetCache.set(file, buf);
    }
    res.setHeader('content-type', type);
    res.setHeader('cache-control', 'public, max-age=86400');
    res.send(buf);
  }
}
