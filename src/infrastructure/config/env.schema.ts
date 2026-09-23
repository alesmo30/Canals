import { z } from 'zod';

/**
 * All config comes from env and is validated at boot: refuse to start on
 * bad config instead of failing on first use.
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

    // Changes per deployment, so an env var. Comma-separated.
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),

    // Dev-only; off by default so containers emit JSON. z.enum, not
    // z.coerce.boolean(): the latter treats "false" as true.
    LOG_PRETTY: z.enum(['true', 'false']).default('false'),
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
 * Throws during bootstrap so the app never reaches a half-started state.
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
