import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfig } from '../infrastructure/config/env.schema';
import { ConfigModule } from '../infrastructure/config/config.module';
import { PERSISTENCE_ENTITIES } from '../infrastructure/database/persistence-entities';
import {
  ChargeResult,
  PaymentGateway,
  PAYMENT_GATEWAY,
} from '../domain/ports/payment-gateway';
import { Coordinates } from '../domain/value-objects/coordinates';
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

/** Throws if actually invoked: a fake geocode would be silently wrong, not merely absent. Real implementation is P2's job. */
const notImplementedGeocodingProvider: GeocodingProvider = {
  geocode(): Promise<Coordinates> {
    return Promise.reject(
      new Error('GeocodingProvider has no implementation yet (P2).'),
    );
  },
};

/** Throws if actually invoked: a fake charge would be silently wrong, not merely absent. Real implementation is P2's job. */
const notImplementedPaymentGateway: PaymentGateway = {
  charge(): Promise<ChargeResult> {
    return Promise.reject(
      new Error('PaymentGateway has no implementation yet (P2).'),
    );
  },
  getStatus(): Promise<ChargeResult> {
    return Promise.reject(
      new Error('PaymentGateway has no implementation yet (P2).'),
    );
  },
};

@Module({
  imports: [
    ConfigModule,
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
    { provide: GEOCODING_PROVIDER, useValue: notImplementedGeocodingProvider },
    { provide: PAYMENT_GATEWAY, useValue: notImplementedPaymentGateway },
  ],
  exports: [
    TypeOrmModule,
    EVENT_PUBLISHER,
    GEOCODING_PROVIDER,
    PAYMENT_GATEWAY,
  ],
})
export class SharedModule {}
