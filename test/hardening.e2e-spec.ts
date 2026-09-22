import { randomUUID } from 'crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import helmet from 'helmet';
import request from 'supertest';

import { ApiModule } from '../src/modules/api.module';
import { AppDataSource } from '../src/infrastructure/database/data-source';

const BODY_LIMIT = '16kb';
const ALLOWED_ORIGIN = 'http://localhost:3000';
/** One over RATE_LIMIT_PER_MINUTE (api.module.ts) — the request that must trip 429. */
const REQUESTS_TO_TRIP_THE_LIMIT = 601;

/**
 * specs/07-hardening-demo.md, R6.6 — e2e: DATABASE_URL, PAYMENTS_URL and
 * OTEL_EXPORTER_OTLP_ENDPOINT exported, a migrated Postgres reachable.
 * `Test.createTestingModule` does not run main.ts's `bootstrap()`, so
 * helmet/CORS/body-parser are re-applied here exactly as main.ts applies
 * them — the throttler guard itself is already wired through ApiModule
 * (APP_GUARD), needing no re-application.
 */
describe('HTTP hardening (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    await AppDataSource.initialize();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ApiModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    app.use(helmet());
    app.enableCors({ origin: [ALLOWED_ORIGIN], methods: ['GET', 'POST'] });
    app.useBodyParser('json', { limit: BODY_LIMIT });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await AppDataSource.destroy();
  });

  it('carries helmet security headers', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
  });

  it('a disallowed Origin gets no Access-Control-Allow-Origin header', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'https://evil.example.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('an allowed Origin gets Access-Control-Allow-Origin echoed back', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', ALLOWED_ORIGIN);

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  it('a body over 16kb is rejected with 413', async () => {
    const oversizedBody = { padding: 'x'.repeat(20 * 1024) };

    await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send(oversizedBody)
      .expect(413);
  });

  it('the 601st request within a minute gets 429, while /health is never throttled', async () => {
    const responses = await Promise.all(
      Array.from({ length: REQUESTS_TO_TRIP_THE_LIMIT }, () =>
        request(app.getHttpServer()).get('/orders'),
      ),
    );

    expect(responses.some((res) => res.status === 429)).toBe(true);

    await request(app.getHttpServer()).get('/health').expect(200);
  }, 30_000);
});
