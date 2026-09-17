import { Module } from '@nestjs/common';

import { SharedModule } from './shared.module';

/**
 * SharedModule + job handlers (infrastructure.md §3). main.worker.ts's
 * entrypoint. No job handlers yet — pg-boss wiring is P3's job (R0.1
 * acceptance criterion 5: the worker starts, connects to the database and
 * stays up doing nothing).
 */
@Module({
  imports: [SharedModule],
})
export class WorkerModule {}
