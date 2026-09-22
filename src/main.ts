// SPEC 04 step 7: must be the first import — see tracing.ts's own comment
// on why (auto-instrumentation patches http/pg by hooking their
// require(), so anything imported before this leaves them
// un-instrumented).
import './infrastructure/observability/tracing';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { ApiModule } from './modules/api.module';
import type { AppConfig } from './infrastructure/config/env.schema';
import { redact } from './infrastructure/http/redaction';

/** SPEC 07 R6.6 — a value nobody tunes per deployment, so a constant, not an env var (references/coding-conventions.md). */
const BODY_LIMIT = '16kb';

async function bootstrap() {
  // abortOnError: false — without it, Nest's own bootstrap exception zone
  // catches a thrown `validate` error (see env.schema.ts), logs its own
  // stack trace and calls process.exit(1) itself, before the promise below
  // ever rejects. Disabling it means every bootstrap failure, config or
  // otherwise, is reported the same deliberate way below.
  // bufferLogs: true — Nest's own bootstrap logs (module init, route
  // mapping) are held until useLogger() below installs the redacting
  // pino logger, instead of going to Nest's default console logger first.
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, {
    abortOnError: false,
    bufferLogs: true,
  });
  // SPEC 03 step 2: every log line from here on — app logs, and
  // pino-http's own request/response logging — goes through redact()
  // (SharedModule's LoggerModule.forRoot(pinoOptions)).
  app.useLogger(app.get(Logger));
  // Without this, SIGTERM kills the process directly and
  // PgBossShutdownHook.onApplicationShutdown() never runs — the api's own
  // pg-boss pool (and its internal timers) would leak instead of closing
  // (SPEC 04 step 9 finding — surfaced by this file's e2e test never
  // exiting cleanly).
  app.enableShutdownHooks();
  // R0.1: global ValidationPipe, no DTOs to validate yet — P4 only writes
  // DTOs, this file does not change again for that.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );

  // SPEC 07 R6.6 — HTTP hardening.
  app.use(helmet());
  const corsOrigins = app
    .get<ConfigService<AppConfig, true>>(ConfigService)
    .get('CORS_ORIGINS', { infer: true });
  app.enableCors({ origin: corsOrigins, methods: ['GET', 'POST'] });
  // Registered before listen()/init() so the express adapter's own
  // default json parser (same middleware name, "jsonParser") is never
  // added on top of this one — this becomes the only json body parser.
  app.useBodyParser('json', { limit: BODY_LIMIT });

  await app.listen(process.env.PORT ?? 3000);
}

// R0.3: the app refuses to start on invalid config rather than failing
// later. ConfigModule's `validate` (env.schema.ts) throws during
// NestFactory.create() on a bad or missing variable; caught here so the
// process exits non-zero with the reason instead of an unhandled rejection.
bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console -- last resort: the pino logger may not exist yet if boot itself failed. redact() still guards this line.
  console.error(redact(error));
  process.exit(1);
});
