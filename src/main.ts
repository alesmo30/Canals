// Must be the first import — see tracing.ts.
import './infrastructure/observability/tracing';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { ApiModule } from './modules/api.module';
import type { AppConfig } from './infrastructure/config/env.schema';
import { redact } from './infrastructure/http/redaction';

/** Not tuned per deployment, so a constant. */
const BODY_LIMIT = '16kb';

/** Helmet's default CSP blocks Swagger UI's inline assets; relaxed for /docs only. */
const DOCS_PATH_PREFIX = '/docs';

async function bootstrap() {
  // abortOnError: false — otherwise Nest logs and exits on a boot error
  // itself, before the catch below ever runs.
  // bufferLogs: true — hold Nest's boot logs until the redacting pino
  // logger is installed, instead of the default console logger.
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, {
    abortOnError: false,
    bufferLogs: true,
  });
  // Every log line from here on (app and pino-http) goes through redact().
  app.useLogger(app.get(Logger));
  // Without shutdown hooks SIGTERM skips PgBossShutdownHook and the api's
  // pg-boss pool leaks.
  app.enableShutdownHooks();
  // Global ValidationPipe: unknown body properties are rejected.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );

  // /docs gets Helmet without CSP (Swagger inline assets); every other
  // route keeps the full policy.
  const defaultHelmet = helmet();
  const docsHelmet = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) => {
    (req.path.startsWith(DOCS_PATH_PREFIX) ? docsHelmet : defaultHelmet)(
      req,
      res,
      next,
    );
  });
  const corsOrigins = app
    .get<ConfigService<AppConfig, true>>(ConfigService)
    .get('CORS_ORIGINS', { infer: true });
  app.enableCors({ origin: corsOrigins, methods: ['GET', 'POST'] });
  // Registered before listen() so it replaces, rather than stacks on,
  // the express adapter's default json parser.
  app.useBodyParser('json', { limit: BODY_LIMIT });

  // OpenAPI at /docs: request DTOs via the CLI plugin; response types are
  // interfaces, documented with @ApiResponse.
  const openApiDocument = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Canals API')
      .setDescription(
        'Order creation (three-phase saga, Idempotency-Key) and read endpoints.',
      )
      .setVersion('1.0')
      .build(),
  );
  SwaggerModule.setup('docs', app, openApiDocument);

  await app.listen(process.env.PORT ?? 3000);
}

// Invalid config throws during create(); caught here so the process exits
// non-zero with the reason.
bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console -- last resort: the pino logger may not exist yet if boot itself failed. redact() still guards this line.
  console.error(redact(error));
  process.exit(1);
});
