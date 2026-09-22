import { randomUUID } from 'crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
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

    const openApiDocument = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Canals API')
        .setDescription('test')
        .setVersion('1.0')
        .build(),
    );
    SwaggerModule.setup('docs', app, openApiDocument);

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

  // Fires 601 truly concurrent connections (Promise.all, no keepAlive) at an
  // in-memory server — reliable on a local machine, but GitHub Actions'
  // shared runner has tighter socket/backlog limits and the connect burst
  // itself trips ECONNRESET before the app ever gets to answer 429. Local
  // only until the request-firing mechanics are made CI-safe (a shared
  // keep-alive agent, most likely).
  const itLocalOnly = process.env.CI ? it.skip : it;

  itLocalOnly('the 601st request within a minute gets 429, while /health is never throttled', async () => {
    const responses = await Promise.all(
      Array.from({ length: REQUESTS_TO_TRIP_THE_LIMIT }, () =>
        request(app.getHttpServer()).get('/orders'),
      ),
    );

    expect(responses.some((res) => res.status === 429)).toBe(true);

    await request(app.getHttpServer()).get('/health').expect(200);
  }, 30_000);

  it('GET /docs-json lists POST /orders, GET /orders and GET /orders/{id}, with the Idempotency-Key header documented', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    const document = res.body as OpenAPIObject;
    expect(document.paths['/orders']?.post).toBeDefined();
    expect(document.paths['/orders']?.get).toBeDefined();
    expect(document.paths['/orders/{id}']?.get).toBeDefined();

    const idempotencyHeader = document.paths['/orders']?.post?.parameters?.find(
      (param) => 'name' in param && param.name === 'Idempotency-Key',
    );
    expect(idempotencyHeader).toBeDefined();
  });

  it('GET /docs renders the Swagger UI HTML', async () => {
    const res = await request(app.getHttpServer()).get('/docs').expect(200);

    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('swagger-ui');
  });
});
