// Must be the first import — see tracing.ts.
import './infrastructure/observability/tracing';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { WorkerModule } from './modules/worker.module';
import { JobRunner } from './infrastructure/messaging/job-runner';
import { redact } from './infrastructure/http/redaction';

async function bootstrap() {
  // createApplicationContext(): the full DI graph without an HTTP listener.
  // abortOnError/bufferLogs: see main.ts.
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    abortOnError: false,
    bufferLogs: true,
  });
  // Same redacting pino logger as the api.
  app.useLogger(app.get(Logger));
  // Without shutdown hooks, SIGTERM skips JobRunner's graceful stop and
  // cuts in-flight jobs off mid-handler.
  app.enableShutdownHooks();
  // The open pg-boss/TypeORM pools keep the process alive.
  await app.get(JobRunner).start();
}

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console -- last resort: the pino logger may not exist yet if boot itself failed. redact() still guards this line.
  console.error(redact(error));
  process.exit(1);
});
