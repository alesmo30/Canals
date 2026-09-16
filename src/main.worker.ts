import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './modules/worker.module';

async function bootstrap() {
  // createApplicationContext(), not create(): boots the entire DI graph —
  // every provider, repository and database connection — without starting
  // an HTTP listener (infrastructure.md §3). No app.listen() here.
  await NestFactory.createApplicationContext(WorkerModule, {
    abortOnError: false,
  });
  // No job runner yet — pg-boss wiring is P3's job. R0.1 acceptance
  // criterion 5: the worker starts, connects to the database (via
  // SharedModule's TypeOrmModule) and stays up doing nothing. The open
  // TypeORM/pg connection pool is what keeps the process alive; nothing
  // else here holds the event loop open.
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
