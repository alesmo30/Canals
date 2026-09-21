import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ApiModule } from './../src/modules/api.module';

/**
 * Requires DATABASE_URL (+ PAYMENTS_URL, OTEL_EXPORTER_OTLP_ENDPOINT) and a
 * migrated Postgres reachable — ApiModule pulls in SharedModule's real
 * TypeOrmModule connection. Same prerequisites as the integration tests
 * under src/infrastructure/database/.
 */
describe('ApiModule (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ApiModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  interface HealthResponseBody {
    status: string;
    details: Record<string, { status: string }>;
  }

  it('/health (GET) is a pure liveness check — 200 with no indicators, no database call', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        const body = res.body as HealthResponseBody;
        expect(body.status).toBe('ok');
        expect(body.details).toEqual({});
      });
  });

  it('/health/ready (GET) reports 200 with the database and queue checks up, separately', () => {
    return request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect((res) => {
        const body = res.body as HealthResponseBody;
        expect(body.status).toBe('ok');
        expect(body.details.database.status).toBe('up');
        expect(body.details.queue.status).toBe('up');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
