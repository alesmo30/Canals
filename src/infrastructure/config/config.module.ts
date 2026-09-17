import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { validateEnv } from './env.schema';

/**
 * Wraps @nestjs/config so every provider in the app — api or worker — can
 * inject a typed `ConfigService<AppConfig>` instead of reading
 * `process.env` directly. `validate` runs once, synchronously, during
 * `NestFactory.create()`/`createApplicationContext()`; a thrown error there
 * aborts boot before any other provider is instantiated.
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // Loads a local .env if one exists (dev convenience — copy
      // .env.example to .env and fill it in) and silently no-ops when it
      // doesn't. Docker never has one: docker-compose injects
      // `environment:` directly into process.env, which validate() reads
      // either way.
      envFilePath: '.env',
    }),
  ],
})
export class ConfigModule {}
