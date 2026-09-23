import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import type { PgBoss } from 'pg-boss';

import { AppConfig } from '../infrastructure/config/env.schema';
import { ConfigModule } from '../infrastructure/config/config.module';
import { pinoOptions } from '../infrastructure/logging/pino.config';
import { HttpPaymentGateway } from '../infrastructure/payments/http-payment-gateway';
import { CachingGeocodingProvider } from '../infrastructure/geocoding/caching-geocoding.provider';
import { StaticGeocodingProvider } from '../infrastructure/geocoding/static-geocoding.provider';
import { GeoapifyGeocodingProvider } from '../infrastructure/geocoding/geoapify-geocoding.provider';
import { PgBossEventPublisher } from '../infrastructure/messaging/pg-boss-event-publisher';
import { PERSISTENCE_ENTITIES } from '../infrastructure/database/persistence-entities';
import {
  PG_BOSS,
  PgBossRole,
  pgBossProvider,
} from '../infrastructure/messaging/pg-boss.provider';
import {
  PaymentGateway,
  PAYMENT_GATEWAY,
} from '../domain/ports/payment-gateway';
import {
  EventPublisher,
  EVENT_PUBLISHER,
} from '../domain/ports/event-publisher';
import {
  GeocodingProvider,
  GEOCODING_PROVIDER,
} from '../domain/ports/geocoding-provider';

/**
 * Config, TypeORM, pg-boss and all ports, shared by ApiModule and
 * WorkerModule. `role` only selects the PgBoss flavour.
 * See knowledge/architecture.md#shared-module
 */

@Module({})
export class SharedModule {
  static register(role: PgBossRole): DynamicModule {
    return {
      module: SharedModule,
      imports: [
        ConfigModule,
        // Every log object runs through redact() before serialisation.
        LoggerModule.forRoot({ pinoHttp: pinoOptions }),
        TypeOrmModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (configService: ConfigService<AppConfig, true>) => ({
            type: 'postgres',
            url: configService.get('DATABASE_URL', { infer: true }),
            entities: PERSISTENCE_ENTITIES,
            synchronize: false,
            // Migrations run only from the one-shot migrate service, never
            // from the app.
            migrationsRun: false,
            logging: false,
          }),
        }),
      ],
      providers: [
        pgBossProvider(role),
        {
          provide: EVENT_PUBLISHER,
          inject: [PG_BOSS],
          useFactory: (boss: PgBoss): EventPublisher =>
            new PgBossEventPublisher(boss),
        },
        {
          provide: GEOCODING_PROVIDER,
          inject: [ConfigService],
          useFactory: (
            configService: ConfigService<AppConfig, true>,
          ): GeocodingProvider => {
            // The adapter is chosen once here from env — no driver checks
            // anywhere else.
            const driver = configService.get('GEOCODING_DRIVER', {
              infer: true,
            });
            const delegate: GeocodingProvider =
              driver === 'geoapify'
                ? new GeoapifyGeocodingProvider({
                    apiKey: requireGeoapifyApiKey(configService),
                  })
                : new StaticGeocodingProvider();
            return new CachingGeocodingProvider(delegate);
          },
        },
        {
          provide: PAYMENT_GATEWAY,
          inject: [ConfigService],
          useFactory: (
            configService: ConfigService<AppConfig, true>,
          ): PaymentGateway =>
            new HttpPaymentGateway({
              baseUrl: configService.get('PAYMENTS_URL', { infer: true }),
            }),
        },
      ],
      exports: [
        LoggerModule,
        TypeOrmModule,
        PG_BOSS,
        EVENT_PUBLISHER,
        GEOCODING_PROVIDER,
        PAYMENT_GATEWAY,
      ],
    };
  }
}

/**
 * env.schema.ts's Zod refinement already refuses to boot when
 * GEOCODING_DRIVER=geoapify and GEOAPIFY_API_KEY is unset — this is a
 * defensive fallback, never reachable through normal configuration.
 */
function requireGeoapifyApiKey(
  configService: ConfigService<AppConfig, true>,
): string {
  const apiKey = configService.get('GEOAPIFY_API_KEY', { infer: true });
  if (!apiKey) {
    throw new Error(
      'GEOAPIFY_API_KEY is required when GEOCODING_DRIVER=geoapify.',
    );
  }
  return apiKey;
}
