// SPEC 04 step 7: must be the first import — see tracing.ts's own comment
// on why (auto-instrumentation patches http/pg by hooking their
// require(), so anything imported before this leaves them
// un-instrumented).
import './infrastructure/observability/tracing';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { WorkerModule } from './modules/worker.module';
import { JobRunner } from './infrastructure/messaging/job-runner';
import { redact } from './infrastructure/http/redaction';

async function bootstrap() {
  // createApplicationContext(), not create(): boots the entire DI graph —
  // every provider, repository and database connection — without starting
  // an HTTP listener (infrastructure.md §3). No app.listen() here.
  // bufferLogs: true — see main.ts.
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    abortOnError: false,
    bufferLogs: true,
  });
  // SPEC 03 step 2: same redacting pino logger as the api (SharedModule's
  // LoggerModule.forRoot(pinoOptions)).
  app.useLogger(app.get(Logger));
  // Without this, SIGTERM (docker stop) kills the process directly and
  // JobRunner.onApplicationShutdown() (boss.stop({ graceful: true })) never
  // runs — an in-flight job would be cut off mid-handler instead of
  // finishing (SPEC 04 Decisions, "The worker, its connections and
  // shutdown").
  app.enableShutdownHooks();
  // boss.work() per queue (infrastructure.md §3's `main.worker.ts`
  // example). The open pg-boss/TypeORM pools keep the process alive from
  // here; nothing else holds the event loop open.
  await app.get(JobRunner).start();
}

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console -- last resort: the pino logger may not exist yet if boot itself failed. redact() still guards this line.
  console.error(redact(error));
  process.exit(1);
});
