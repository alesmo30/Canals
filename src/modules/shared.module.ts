import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';

import { AppConfig } from '../infrastructure/config/env.schema';
import { ConfigModule } from '../infrastructure/config/config.module';
import { pinoOptions } from '../infrastructure/logging/pino.config';
import { HttpPaymentGateway } from '../infrastructure/payments/http-payment-gateway';
import { CachingGeocodingProvider } from '../infrastructure/geocoding/caching-geocoding.provider';
import { StaticGeocodingProvider } from '../infrastructure/geocoding/static-geocoding.provider';
import { GeoapifyGeocodingProvider } from '../infrastructure/geocoding/geoapify-geocoding.provider';
import { PERSISTENCE_ENTITIES } from '../infrastructure/database/persistence-entities';
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
 * infrastructure.md §3: "config, TypeORM, pg-boss, all ports — THE SHARED
 * PART". Both ApiModule and WorkerModule import this and nothing else for
 * their infrastructure needs, so the api and the worker share one DI graph
 * shape even though they boot through different entrypoints.
 *
 * P0 wires all three port tokens now so the graph is closed from day one —
 * P2/P3 swap a `useValue` stub for a real `useClass` adapter, they do not
 * add a new provider to this frozen module (specs/01-foundation.md,
 * Decisions).
 */

/** No-op: publish() resolves without enqueuing anything. Safe to call before P3 lands the pg-boss adapter — nothing observes the missing side effect yet, nothing in P0/P1 calls this. */
const noOpEventPublisher: EventPublisher = {
  publish(): Promise<void> {
    return Promise.resolve();
  },
};

@Module({
  imports: [
    ConfigModule,
    // SPEC 03 step 2: every log object — Nest's own logger, pino-http's
    // request/response logging, and future adapters — runs through
    // redact() before it is serialised (pinoOptions).
    LoggerModule.forRoot({ pinoHttp: pinoOptions }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        type: 'postgres',
        url: configService.get('DATABASE_URL', { infer: true }),
        entities: PERSISTENCE_ENTITIES,
        synchronize: false,
        // R0.4/R0.7: migrations run from exactly one place, the one-shot
        // `migrate` compose service (step 11) — never from the app itself.
        migrationsRun: false,
        logging: false,
      }),
    }),
  ],
  providers: [
    { provide: EVENT_PUBLISHER, useValue: noOpEventPublisher },
    {
      provide: GEOCODING_PROVIDER,
      inject: [ConfigService],
      useFactory: (
        configService: ConfigService<AppConfig, true>,
      ): GeocodingProvider => {
        // R2.7 (phases/02-external-adapters.md): the active adapter is
        // chosen once, here, from the environment variable — no
        // `if (driver === ...)` anywhere else in application code.
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
    EVENT_PUBLISHER,
    GEOCODING_PROVIDER,
    PAYMENT_GATEWAY,
  ],
})
export class SharedModule {}

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
