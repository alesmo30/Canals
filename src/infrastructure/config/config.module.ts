import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { validateEnv } from './env.schema';

/**
 * Typed ConfigService<AppConfig> instead of process.env. validate runs once
 * at boot; a throw aborts before any provider exists.
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // Loads a local .env if present; in Docker, compose injects the
      // environment directly.
      envFilePath: '.env',
    }),
  ],
})
export class ConfigModule {}
