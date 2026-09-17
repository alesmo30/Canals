import { validateEnv } from './env.schema';

const validEnv = {
  DATABASE_URL: 'postgres://canals:canals@localhost:5432/canals',
  PAYMENTS_URL: 'http://localhost:4000',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
};

describe('validateEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const config = validateEnv(validEnv);

    expect(config.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(config.PORT).toBe(3000);
    expect(config.GEOCODING_DRIVER).toBe('static');
    expect(config.PGBOSS_POLL_INTERVAL_SECONDS).toBe(15);
    expect(config.RESERVATION_TTL_MINUTES).toBe(15);
  });

  it('coerces numeric strings from the environment', () => {
    const config = validateEnv({
      ...validEnv,
      PORT: '4000',
      PGBOSS_POLL_INTERVAL_SECONDS: '30',
      RESERVATION_TTL_MINUTES: '20',
    });

    expect(config.PORT).toBe(4000);
    expect(config.PGBOSS_POLL_INTERVAL_SECONDS).toBe(30);
    expect(config.RESERVATION_TTL_MINUTES).toBe(20);
  });

  it('throws naming DATABASE_URL when it is missing', () => {
    const withoutDatabaseUrl = {
      PAYMENTS_URL: validEnv.PAYMENTS_URL,
      OTEL_EXPORTER_OTLP_ENDPOINT: validEnv.OTEL_EXPORTER_OTLP_ENDPOINT,
    };

    expect(() => validateEnv(withoutDatabaseUrl)).toThrow(/DATABASE_URL/);
  });

  it('throws when DATABASE_URL does not use the postgres scheme', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        DATABASE_URL: 'mysql://canals:canals@localhost:3306/canals',
      }),
    ).toThrow(/postgres/i);
  });

  it('throws naming every invalid field at once, not just the first', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    try {
      validateEnv({});
      throw new Error('expected validateEnv to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/DATABASE_URL/);
      expect(message).toMatch(/PAYMENTS_URL/);
      expect(message).toMatch(/OTEL_EXPORTER_OTLP_ENDPOINT/);
    }
  });

  it('rejects GEOCODING_DRIVER=geoapify without a GEOAPIFY_API_KEY', () => {
    expect(() =>
      validateEnv({ ...validEnv, GEOCODING_DRIVER: 'geoapify' }),
    ).toThrow(/GEOAPIFY_API_KEY/);
  });

  it('accepts GEOCODING_DRIVER=geoapify when GEOAPIFY_API_KEY is present', () => {
    const config = validateEnv({
      ...validEnv,
      GEOCODING_DRIVER: 'geoapify',
      GEOAPIFY_API_KEY: 'test-key',
    });

    expect(config.GEOCODING_DRIVER).toBe('geoapify');
    expect(config.GEOAPIFY_API_KEY).toBe('test-key');
  });
});
