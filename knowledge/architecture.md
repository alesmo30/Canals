# Architecture

How the codebase is layered, how the two processes (api and worker) boot,
and how the Nest DI graph is shared between them. For the frozen layer
rules themselves see [references/layering.md](../references/layering.md).

## Layers

HTTP controllers → application services / use cases → domain →
infrastructure adapters.

- `src/domain/**` has no NestJS or TypeORM imports and never imports
  `src/infrastructure/**`. It declares **ports** (interfaces in
  `src/domain/ports/`); infrastructure **adapters** implement them.
- The boundary is enforced by `eslint.config.mjs`'s `no-restricted-imports`
  rules, not by comments.
- Only `Order` and `OrderItem` are rich domain classes. Every other table
  is used directly through its TypeORM entity, because the database
  already guarantees its rules (see the domain-service test in
  [references/layering.md](../references/layering.md) and
  [database.md#entities](database.md#entities)).
- Small additive types that the application needs from an adapter's world
  (payment failure codes, geocoding failure reasons) live in
  `src/domain/ports/` beside the port, so the application layer never has to
  import infrastructure. See
  [http-payments.md#failure-codes](http-payments.md#failure-codes) and
  [geocoding.md#errors](geocoding.md#errors).

## Ports

Code:
- `src/domain/ports/event-publisher.ts` → `EVENT_PUBLISHER`
- `src/domain/ports/geocoding-provider.ts` → `GEOCODING_PROVIDER`
- `src/domain/ports/payment-gateway.ts` → `PAYMENT_GATEWAY`

Each port is a TypeScript interface, which has no runtime value Nest can
use as an injection key. Every port therefore exports a `Symbol` DI token
next to it; providers are registered and injected by that token
(`@Inject(PAYMENT_GATEWAY)`). `PgBoss` gets the same treatment (`PG_BOSS`,
see [messaging-jobs.md#pgboss-roles](messaging-jobs.md#pgboss-roles)).

The three ports and their adapters:

| Port | Adapter(s) | Notes |
|---|---|---|
| `EventPublisher` | `PgBossEventPublisher` | [messaging-jobs.md#transactional-outbox](messaging-jobs.md#transactional-outbox) |
| `PaymentGateway` | `HttpPaymentGateway` | [http-payments.md#port](http-payments.md#port) |
| `GeocodingProvider` | `StaticGeocodingProvider`, `GeoapifyGeocodingProvider`, wrapped by `CachingGeocodingProvider` | [geocoding.md#port](geocoding.md#port) |

## Configuration

Code:
- `src/infrastructure/config/config.module.ts` → `ConfigModule`
- `src/infrastructure/config/env.schema.ts` → `envSchema`, `validateEnv`
- `src/main.ts` → `bootstrap` (the outer `catch`)

All configuration comes from the process environment and is validated
against one Zod schema (`envSchema`) at boot. The rule is: **refuse to
start on bad config rather than fail on first use** (for example, a bad
`DATABASE_URL` must not surface only when the first query runs).

- `ConfigModule` wraps `@nestjs/config` so every provider, in the api or
  the worker, injects a typed `ConfigService<AppConfig>` instead of reading
  `process.env` directly.
- `validateEnv` is passed as `ConfigModule.forRoot({ validate })`. Nest calls
  it synchronously inside `NestFactory.create()` /
  `createApplicationContext()`. A throw there aborts bootstrap before any
  controller, repository or queue connection exists, so the app never
  reaches a half-started state.
- `main.ts`'s `bootstrap` catches that rejection and exits non-zero with the
  reason, instead of leaving an unhandled rejection. (`abortOnError: false`
  is what lets the error reach that `catch`; see [Bootstrap](#bootstrap).)
- `envFilePath`: a local `.env` is loaded if present (copy `.env.example`
  and fill it in) and silently ignored otherwise. In Docker there is no
  `.env`; compose injects `environment:` straight into `process.env`, which
  `validate` reads either way.
- Env var vs constant: only values an operator changes per deployment are
  env vars (for example `CORS_ORIGINS`, comma-separated, split and trimmed
  into the array `enableCors()` needs). Everything else is a named
  constant; see
  [references/coding-conventions.md](../references/coding-conventions.md).
- The TypeORM CLI entrypoint validates `process.env` with the same schema;
  see [database.md#data-source](database.md#data-source).
- `tracing.ts` runs before `ConfigModule` exists and reads `OTEL_*`
  variables from `process.env` directly; see
  [observability.md#tracing-bootstrap](observability.md#tracing-bootstrap).

Note: `envSchema` also declares `RESERVATION_TTL_MINUTES`, but the
reservation code uses the `RESERVATION_TTL_MINUTES` constant in
`inventory.service.ts`, not the env var
([allocation.md#reservation-ttl](allocation.md#reservation-ttl)).

Source: [spec 01, Configuration schema and Decisions › “Configuration and validation”](../specs/01-foundation.md#configuration-schema).

## Bootstrap

Code:
- `src/main.ts` → `bootstrap`
- `src/main.worker.ts` → `bootstrap`

There is one repository and one Docker image with two entrypoints
([infrastructure.md, section 3](../engineering:documentation/infrastructure.md#3-one-repo-two-entrypoints)):

- **api** (`main.ts`): `NestFactory.create(ApiModule, …)` and `listen()`.
- **worker** (`main.worker.ts`):
  `NestFactory.createApplicationContext(WorkerModule, …)` boots the whole DI
  graph (every provider, repository and database connection) without an
  HTTP listener, then calls `app.get(JobRunner).start()`, which registers one
  `boss.work()` per queue. There is no `listen()`: the open pg-boss and
  TypeORM pools are what keep the process alive.

**Import order.** The first import of both files must be
`./infrastructure/observability/tracing`. OpenTelemetry auto-instrumentation
patches `http` and `pg` when they are first `require()`d, so anything that
loads them earlier (Nest, TypeORM, pg-boss) stays un-instrumented. No lint
rule can catch an ordering mistake. Details:
[observability.md#tracing-bootstrap](observability.md#tracing-bootstrap).

**Options passed to create/createApplicationContext:**

- `abortOnError: false`. Without it, Nest's own bootstrap exception zone
  catches a thrown `validate` error, prints its own stack trace and calls
  `process.exit(1)` before the bootstrap promise ever rejects. Disabling it
  makes every bootstrap failure (config or otherwise) go through the same
  deliberate `catch`.
- `bufferLogs: true`. Nest's own bootstrap logs (module init, route mapping)
  are held until `useLogger()` installs the redacting pino logger, instead
  of going to Nest's default console logger first.

**Shutdown hooks.** Both entrypoints call `app.enableShutdownHooks()`.
Without it, SIGTERM kills the process directly and:

- in the api, `PgBossShutdownHook.onApplicationShutdown()` never runs, so
  the api's pg-boss pool and internal timers leak (this was found because
  the api's e2e test never exited cleanly);
- in the worker, `JobRunner.onApplicationShutdown()` never runs, so an
  in-flight job is cut off mid-handler. See
  [messaging-jobs.md#graceful-shutdown](messaging-jobs.md#graceful-shutdown).

**Validation.** `main.ts` installs a global
`ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`. It validates
the request DTOs (`CreateOrderDto`); unknown properties are rejected, not
stripped. The read endpoints add their own local pipe with
`transform: true` ([orders-saga.md#read-side](orders-saga.md#read-side)).

**Body parser.** `app.useBodyParser('json', { limit: BODY_LIMIT })` is
registered before `listen()`/`init()`. The Express adapter's default JSON
parser has the same middleware name (`jsonParser`), so registering ours
first means it is the only JSON body parser, not a second one on top.

**Last-resort logging.** If boot fails, the `catch` uses `console.error`
(the pino logger may not exist yet). `redact()` still wraps that line; see
[observability.md#redaction](observability.md#redaction).

Source: [spec 01, Decisions](../specs/01-foundation.md#decisions);
[spec 04, Decisions › “The worker, its connections and shutdown”](../specs/04-queue-worker-observability.md#decisions).

## HTTP hardening

Code:
- `src/main.ts` → `BODY_LIMIT`, `DOCS_PATH_PREFIX`, `bootstrap`
- `src/modules/api.module.ts` → `RATE_LIMIT_PER_MINUTE`

- **Body limit** (`BODY_LIMIT = '16kb'`): nobody tunes it per deployment,
  so it is a constant. A body over the limit is rejected by Express
  middleware before Nest runs; the problem-details filter still shapes it
  ([orders-saga.md#error-contract](orders-saga.md#error-contract)).
- **Helmet**: Helmet's default Content Security Policy blocks Swagger UI's
  inline assets. So requests under `/docs` (`DOCS_PATH_PREFIX`) get Helmet's
  other headers but no CSP, and every other route keeps the full default
  policy. It is not relaxed globally.
- **Rate limit** (`RATE_LIMIT_PER_MINUTE = 600` per IP per minute, via the
  throttler guard registered as `APP_GUARD`): this covers the end-to-end
  concurrency burst (N + 20 requests, 70 by default). It is a constant, not
  an env var. It is exported so `scripts/concurrency-e2e.ts` can refuse an N
  whose burst would exceed it
  ([scripts.md#concurrency-e2e](scripts.md#concurrency-e2e)).
- **CORS**: origins come from `CORS_ORIGINS` (see
  [Configuration](#configuration)).
- **OpenAPI** at `/docs`: request DTOs (`CreateOrderDto`,
  `ListOrdersQueryDto`) are introspected by the Nest CLI Swagger plugin
  (`nest-cli.json`). Response types are plain interfaces with no runtime
  metadata, so each route documents its outcomes with `@ApiResponse`
  descriptions instead of a generated schema.

The e2e test re-applies these exactly as `main.ts` does, because
`Test.createTestingModule` does not run `bootstrap()`
([testing.md#e2e-tests](testing.md#e2e-tests)).

Source: [spec 07, HTTP hardening and Risks](../specs/07-hardening-demo.md#risks).

## Shared module

Code: `src/modules/shared.module.ts` → `SharedModule`, `SharedModule.register`

`SharedModule` is "the shared part" from
[infrastructure.md, section 3](../engineering:documentation/infrastructure.md#3-one-repo-two-entrypoints):
config, TypeORM, pg-boss, the redacting logger and all three port
providers. `ApiModule` and `WorkerModule` import it and nothing else for
their infrastructure, so both processes share one DI graph shape even
though they boot through different entrypoints.

- All three port tokens were wired from the start so the graph was closed
  from day one. Later work replaced a `useValue` stub with a real
  `useClass` adapter; it never added a new provider to this module
  ([spec 01, Decisions › “Layering and contracts”](../specs/01-foundation.md#decisions)).
- `register(role)`: the only difference between the api's and the worker's
  copy is which `PgBoss` instance they get
  ([messaging-jobs.md#pgboss-roles](messaging-jobs.md#pgboss-roles)).
  `role` is a structural fact about which entrypoint is booting, not an
  operator-tunable value, so it is a method argument, not an env var.
- The logger import (`LoggerModule.forRoot(pinoOptions)`) is what makes
  every log object go through `redact()`
  ([observability.md#redaction](observability.md#redaction)).
- The TypeORM import never runs migrations
  ([database.md#migrations](database.md#migrations)).

## Adapter selection

Code:
- `src/modules/shared.module.ts` → `SharedModule.register` (the `useFactory`
  for `GEOCODING_PROVIDER`), `requireGeoapifyApiKey`

The active adapter is chosen **once**, in `SharedModule`'s provider factory,
from an environment variable (`GEOCODING_DRIVER=static|geoapify`). No
application code branches on the driver anywhere else. The chosen driver is
always wrapped in `CachingGeocodingProvider`
([geocoding.md#cache](geocoding.md#cache)).

`requireGeoapifyApiKey` is a defensive fallback: the Zod schema already
refuses to boot when `GEOCODING_DRIVER=geoapify` and `GEOAPIFY_API_KEY` is
unset, so it is never reached through normal configuration.

Source: [phase plan, external adapters](../phases/02-external-adapters.md).

## Worker module

Code: `src/modules/worker.module.ts` → `WorkerModule`

`WorkerModule` = `SharedModule.register('worker')` + the job handlers +
`JobRunner`. The handlers are registered as a multi-provider array under
the `JOB_HANDLERS` token, so `JobRunner` takes one array instead of one
constructor parameter per handler (staying within the max-3-parameters rule
in [references/coding-conventions.md](../references/coding-conventions.md)).
`main.worker.ts` then runs `await app.get(JobRunner).start()`
([messaging-jobs.md#job-runner](messaging-jobs.md#job-runner)).
