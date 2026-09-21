import { z } from 'zod';

/**
 * R0.3 — every configuration value the app needs comes from the process
 * environment and is validated against this schema at boot. The app must
 * refuse to start on invalid config rather than failing later on first use
 * (e.g. a bad DATABASE_URL surfacing only when the first query runs).
 */
export const envSchema = z
  .object({
    DATABASE_URL: z
      .url({ message: 'DATABASE_URL must be a valid URL' })
      .refine(
        (value) =>
          value.startsWith('postgres://') || value.startsWith('postgresql://'),
        {
          message:
            'DATABASE_URL must use the postgres:// or postgresql:// scheme',
        },
      ),

    PORT: z.coerce.number().int().positive().default(3000),

    PAYMENTS_URL: z.url({ message: 'PAYMENTS_URL must be a valid URL' }),

    GEOCODING_DRIVER: z.enum(['static', 'geoapify']).default('static'),

    GEOAPIFY_API_KEY: z.string().optional(),

    OTEL_EXPORTER_OTLP_ENDPOINT: z.url({
      message: 'OTEL_EXPORTER_OTLP_ENDPOINT must be a valid URL',
    }),

    PGBOSS_POLL_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(15),

    RESERVATION_TTL_MINUTES: z.coerce.number().int().positive().default(15),

    // z.coerce.boolean() is a known trap: it runs `Boolean(value)`, so the
    // *string* "false" coerces to `true` (any non-empty string is truthy).
    // Compare against the literal instead — anything but "true" is false,
    // matching the default. An operator must be able to turn the dev
    // publisher on locally without a rebuild, which is what makes this an
    // env var rather than a constant (SPEC 04 Decisions).
    ENABLE_DEV_ENDPOINTS: z
      .string()
      .default('false')
      .transform((value) => value === 'true'),
  })
  .refine(
    (config) =>
      config.GEOCODING_DRIVER !== 'geoapify' ||
      Boolean(config.GEOAPIFY_API_KEY),
    {
      message: 'GEOAPIFY_API_KEY is required when GEOCODING_DRIVER=geoapify',
      path: ['GEOAPIFY_API_KEY'],
    },
  );

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Validates the raw process environment against {@link envSchema}.
 *
 * Called from `ConfigModule.forRoot({ validate })` (see config.module.ts),
 * which NestJS invokes synchronously during `NestFactory.create()`. Throwing
 * here aborts the bootstrap promise before any controller, repository or
 * queue connection is created — the app never reaches a half-started state.
 */
export function validateEnv(raw: Record<string, unknown>): AppConfig {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}
