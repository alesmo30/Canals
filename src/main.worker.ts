import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { WorkerModule } from './modules/worker.module';
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
  // No job runner yet — pg-boss wiring is P3's job. R0.1 acceptance
  // criterion 5: the worker starts, connects to the database (via
  // SharedModule's TypeOrmModule) and stays up doing nothing. The open
  // TypeORM/pg connection pool is what keeps the process alive; nothing
  // else here holds the event loop open.
}

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console -- last resort: the pino logger may not exist yet if boot itself failed. redact() still guards this line.
  console.error(redact(error));
  process.exit(1);
});
