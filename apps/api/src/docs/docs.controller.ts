import { Controller, Get, Header } from '@nestjs/common';
import { buildOpenApiDocument } from './openapi';

const REFERENCE_HTML = `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>embeding API — справочник</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        defaultModelsExpandDepth: 1,
        tryItOutEnabled: true,
      });
    </script>
  </body>
</html>`;

/** Публичная документация API: спека OpenAPI + интерактивный Swagger UI. Без аутентификации. */
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
}
