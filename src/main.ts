import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { ApiModule } from './modules/api.module';

async function bootstrap() {
  // abortOnError: false — without it, Nest's own bootstrap exception zone
  // catches a thrown `validate` error (see env.schema.ts), logs its own
  // stack trace and calls process.exit(1) itself, before the promise below
  // ever rejects. Disabling it means every bootstrap failure, config or
  // otherwise, is reported the same deliberate way below.
  const app = await NestFactory.create(ApiModule, { abortOnError: false });
  // R0.1: global ValidationPipe, no DTOs to validate yet — P4 only writes
  // DTOs, this file does not change again for that.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.listen(process.env.PORT ?? 3000);
}

// R0.3: the app refuses to start on invalid config rather than failing
// later. ConfigModule's `validate` (env.schema.ts) throws during
// NestFactory.create() on a bad or missing variable; caught here so the
// process exits non-zero with the reason instead of an unhandled rejection.
bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
