# SPEC 08 — Canals Console: guided request runner + order lifecycle view

> **Status:** Approved
> **Depends on:** SPEC 04 (pg-boss queues, `X-Correlation-Id`), SPEC 05
> (`POST /orders`, idempotency, saga), SPEC 06 (`GET /orders`,
> `GET /orders/:id`, `OrdersReadRepository`)
> **Date:** 2026-09-22
> **Objective:** Give a reviewer a single browser app to *drive* the API
> (pre-filled, guided forms instead of Postman/curl) and to *see* what
> each request did — the response rendered cleanly, a persistent log of
> every execution, and a visual timeline of the order's lifecycle from
> idempotency check to fan-out jobs. Grafana (SPEC 04) stays as the deep
> trace tool; this is the interactive front door.

## Scope

**In:**

- **Backend, CORS:** `exposedHeaders: ['X-Correlation-Id']` so browser JS
  can read the echoed id; `http://localhost:5173` (Vite dev server) added
  to the `CORS_ORIGINS` default, `.env.example` and the compose `api`
  service.
- **Backend, `GET /orders/:id/timeline`:** read-only endpoint that
  assembles, from data the system already writes, an ordered list of
  lifecycle events for one order: idempotency record, order creation,
  inventory movements, payment attempts, settlement outcome
  (confirmed/failed/cancelled), shipment, and every pg-boss job (incl.
  DLQ copies) whose payload references the order. Same `404` semantics as
  `GET /orders/:id`.
- **Frontend, new `web/` package** (Vite + React + TypeScript, MUI,
  React Router, Formik + Yup). English UI. Three routes:
  - `/` **Console** — Postman-like runner for the three order requests
    with guided forms, a confirmation dialog before `POST`, and a
    pretty/raw response pane.
  - `/executions` **Executions** — table of every request the console
    sent (persisted in `localStorage`).
  - `/executions/:id` **Execution detail** — request (URL, params,
    headers, body), response (status, headers, body), and the
    **Lifecycle** timeline fed by `GET /orders/:id/timeline`.
- README section "Console" (how to run it, what each test card does).

**Out of scope:**

- Auth, users, customer creation — the console uses the single seeded
  customer (`c0000000-0000-0000-0000-000000000001`) and says so on screen.
- New catalogue endpoints (`/products`, `/warehouses`). The console
  hardcodes the seed catalogue (Decisions).
- Querying Tempo/Loki from the browser. The console links out to
  Grafana Explore instead.
- DLQ replay, job retry buttons or any write beyond `POST /orders`.
- Adding the console to `npm run verify`, CI or docker-compose.
- Any change to SPEC 05/06 files beyond an additive route in
  `orders-read.controller.ts`, additive methods on
  `OrdersReadRepository` and one additive `enableCors` option.

## API contract — `GET /orders/:id/timeline`

`200 application/json`:

```ts
export type TimelinePhase =
  | 'IDEMPOTENCY'   // idempotency_keys row
  | 'RESERVE'       // order inserted + inventory RESERVE
  | 'CHARGE'        // payment attempts
  | 'SETTLE'        // COMMIT/RELEASE + CONFIRMED/PAYMENT_FAILED/CANCELLED
  | 'JOBS'          // pg-boss jobs (shipment.create, customer.notify, analytics.record, *.dlq)
  | 'FULFILMENT';   // shipment row — after JOBS: it is written by the shipment.create job

export type TimelineOutcome = 'OK' | 'PENDING' | 'FAILED';

export interface TimelineEvent {
  at: string;                 // ISO — sort key
  phase: TimelinePhase;
  kind: string;               // e.g. 'ORDER_CREATED', 'INVENTORY_RESERVE', 'PAYMENT_ATTEMPT', 'JOB'
  title: string;              // short human label, e.g. 'Payment attempt #1 CAPTURED'
  outcome: TimelineOutcome;
  detail: Record<string, string | number | null>; // flat, display-only
}

export interface OrderTimelineResponse {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  correlationId: string | null;
  events: TimelineEvent[];    // ascending by `at`, ties broken by phase order above
}
```

Example (card `4242…`, happy path, abbreviated):

```json
{
  "orderId": "…", "orderNumber": "ORD-…", "status": "CONFIRMED",
  "correlationId": "7f3c…",
  "events": [
    { "phase": "IDEMPOTENCY", "kind": "IDEMPOTENCY_KEY", "title": "Idempotency key accepted", "outcome": "OK", "detail": { "state": "COMPLETED", "responseStatus": 201 } },
    { "phase": "RESERVE", "kind": "ORDER_CREATED", "title": "Order created (PENDING_PAYMENT)", "outcome": "OK", "detail": { "reservationExpiresAt": "…" } },
    { "phase": "RESERVE", "kind": "INVENTORY_RESERVE", "title": "Reserved 1 × APL-IP16-128-BLK at Newark DC, NJ", "outcome": "OK", "detail": { "availableAfter": 9, "reservedAfter": 1 } },
    { "phase": "CHARGE", "kind": "PAYMENT_ATTEMPT", "title": "Payment attempt #1 CAPTURED", "outcome": "OK", "detail": { "amountCents": 69900, "failureCode": null } },
    { "phase": "SETTLE", "kind": "INVENTORY_COMMIT", "title": "Committed 1 × APL-IP16-128-BLK", "outcome": "OK", "detail": {} },
    { "phase": "SETTLE", "kind": "ORDER_CONFIRMED", "title": "Order CONFIRMED", "outcome": "OK", "detail": {} },
    { "phase": "JOBS", "kind": "JOB", "title": "shipment.create completed", "outcome": "OK", "detail": { "queue": "shipment.create", "state": "completed", "retryCount": 0 } },
    { "phase": "FULFILMENT", "kind": "SHIPMENT", "title": "Shipment PENDING_DISPATCH", "outcome": "PENDING", "detail": { "carrier": null } }
  ]
}
```

Errors: unknown or non-UUID-shaped id → `404 urn:problem-type:not-found`
(reuses `OrderNotFoundError`, SPEC 06).

### Data sources (all existing tables, no migration)

| Source | Filter | Produces |
|---|---|---|
| `orders` | `id = $1` | `ORDER_CREATED` (`created_at`), `ORDER_CONFIRMED` (`confirmed_at`), `ORDER_CANCELLED` (`cancelled_at`, `cancellation_reason`), `ORDER_PAYMENT_FAILED` (`updated_at` when status is `PAYMENT_FAILED`), `reservation_expires_at` in detail |
| `idempotency_keys` | `order_id = $1` | `IDEMPOTENCY_KEY` (`created_at`, `state`, `response_status`); `response_body->>'correlationId'` as a correlation fallback |
| `inventory_movements` ⋈ `products`, `warehouses` | `order_id = $1` (indexed: `idx_inventory_movements_order`) | `INVENTORY_RESERVE` (phase RESERVE), `INVENTORY_COMMIT` / `INVENTORY_RELEASE` (phase SETTLE) |
| `payments` | reuse `findPaymentsByOrderId` | `PAYMENT_ATTEMPT` per row (`created_at`); `CAPTURED`→OK, `PENDING`/`UNKNOWN`→PENDING, `DECLINED`/`FAILED`→FAILED |
| `shipments` | reuse `findShipmentByOrderId` | `SHIPMENT` (`dispatched_at` ?? job completion ?? order `confirmed_at`) |
| `pgboss.job` | `name = ANY($2) AND data->'payload'->>'orderId' = $1` | `JOB` per row (`completed_on` ?? `started_on` ?? `created_on`); `completed`→OK, `created`/`retry`/`active`→PENDING, `failed`/`cancelled` or a `*.dlq` queue→FAILED; `data->'meta'->>'correlationId'` is the primary correlation id |

pg-boss 12.33 (confirmed against the running DB): there is **no**
`pgboss.archive` table. Completed and failed jobs stay in `pgboss.job`
until `deletion_seconds` (7 days); DLQ copies are ordinary rows in
`pgboss.job` under `<queue>.dlq`. `pgboss.job` is `PARTITION BY LIST
(name)`, so filtering on `name = ANY(<the 6 fan-out/DLQ queues>)` prunes
to those partitions before the JSON predicate runs. Queue names come from
`event-routing.ts` / `queue-setup.ts`, not a new literal list.

## Code layout

**Backend**

- `src/infrastructure/database/repositories/orders-read.repository.ts` —
  additive: `findTimelineOrderById`, `findIdempotencyRecordByOrderId`,
  `findInventoryMovementsByOrderId`, `findJobsByOrderId`. Typed row
  interfaces as in SPEC 06.
- `src/application/orders/get-order-timeline.service.ts` — same shape as
  `GetOrderService`: UUID-shape check → `Promise.all` of the six reads →
  `OrderNotFoundError` if no order → build events → sort.
- `src/application/orders/helpers/timeline.helpers.ts` — mechanical
  row→event mappers (`toMovementEvent`, `toPaymentEvent`, `toJobEvent`,
  …) and `sortTimeline` (pure, unit-tested). The service body keeps the
  *decisions* (which order-status events exist, which correlation source
  wins) per `references/coding-conventions.md`.
- `src/infrastructure/http/dto/order-timeline.response.dto.ts` —
  `toOrderTimelineResponse`, explicit projection.
- `src/infrastructure/http/controllers/orders-read.controller.ts` —
  additive `@Get(':id/timeline')`.

**Frontend (`web/`)**

```
web/
  package.json  vite.config.ts  tsconfig.json  index.html
  src/
    main.tsx  App.tsx  theme.ts
    api/catalog.ts        # seed customer, products, warehouses, cities, test cards
    api/client.ts         # execute(): fetch + timing + X-Correlation-Id + problem+json
    api/types.ts          # response types mirrored from the backend DTOs
    store/executions.ts   # localStorage list (cap 200) + useExecutions hook
    store/settings.ts     # base URL (default http://localhost:3000)
    pages/ConsolePage.tsx
    pages/ExecutionsPage.tsx
    pages/ExecutionDetailPage.tsx
    components/…          # RequestSelector, HeadersPanel, CreateOrderForm,
                          # ListOrdersForm, GetOrderForm, ConfirmDialog,
                          # ResponseView (Pretty/Raw), OrderCard, ProblemCard,
                          # LifecycleTimeline, JsonBlock, MethodChip, StatusChip
```

### Visual design — Canals brand palette

Taken from the public site https://www.canals.ai/ (its own CSS custom
properties, read 2026-09-22). Encoded once in `web/src/theme.ts` as the
MUI theme; components never hardcode hex values.

| Token | Hex | Site variable | Console use |
|---|---|---|---|
| `primary.main` | `#1355FF` | `--blue-500` | Primary buttons, links, active nav, `POST` chip |
| `navy.dark` | `#061237` | `--blue-800` | Top app bar background, headings |
| `navy.main` | `#18264E` | `--blue-600` | Secondary surfaces on dark (code blocks / Raw JSON background) |
| `navy.mid` | `#0B1A46` | `--blue-700` | App bar hover / selected nav |
| `primary.light` | `#E1E9FE` | `--blue-100` | Selected table row, info banner background |
| `background.default` | `#F9F9FB` | `--grey-100` | Page background |
| `background.paper` | `#FFFFFF` | `--white` | Cards, panels |
| `surface.subtle` | `#F5F9FF` | `--blue-300` (light) | Form section background, JSON preview on light |
| `divider` | `#E9EDF2` | `--grey-400` | Dividers, table borders |
| `border.strong` | `#B6BCCE` | `--grey-500` | Input and card outlines |
| `text.primary` | `#000000` / `#33373D` | `--black` / `--grey-600` | Body text |
| `text.secondary` | `#515561` | `--grey` | Labels, helper text |
| `text.disabled` | `#6B7280` | `--black-300` | Timestamps, muted metadata |
| `success.main` | `#0E9F6E` | `--green` | `2xx`, timeline OK |
| `secondary.main` | `#4058FF` | `--purple` | `GET` chip, JOBS phase accent |
| `warning.main` | `#A46200` | (amber used on site) | Timeline PENDING, `502` |
| `error.main` | `#D92D20` | — (site has none; standard red) | `4xx`/`5xx`, timeline FAILED |

Typography mirrors the site: **Playfair Display** (serif) for page titles
and the brand word "Canals Console", **Raleway** (sans) for everything
else, loaded from Google Fonts; monospace (`JetBrains Mono`, fallback
`ui-monospace`) for JSON, ids and URLs. Shapes: small radius (6 px) on
buttons/inputs like the site's "Get a Demo" button, 12 px on cards;
light 1 px `divider` borders instead of heavy shadows. Brand mark in the
app bar: the site's wave glyph approximated with an MUI `Waves` icon +
"canals" wordmark in white, followed by "Console" — no copied logo asset.

### Console behaviour

- Top bar: app name, nav (Console / Executions), editable base URL.
- Banner: "All requests run as the fixed test customer *Fixed Test
  Customer* (`c000…0001`)."
- Request selector: `POST /orders` · `GET /orders` · `GET /orders/:id`,
  with the resolved URL preview.
- Headers panel (POST only): `Idempotency-Key` pre-filled with
  `crypto.randomUUID()`, *Regenerate* button, editable (to demo replay /
  `422` on reuse with a different body); optional `X-Correlation-Id`.
- **POST form** (Formik + Yup mirroring `CreateOrderDto`): recipient,
  line1/line2, city+state picked from the geocoder's city list, postal
  code, country fixed `US`; items = product select + quantity, add/remove,
  duplicate products blocked; card select showing the expected outcome:

  | Card | Label | Expected |
  |---|---|---|
  | `4242424242424242` | Approved | `201` · `CONFIRMED` |
  | `4000000000000002` | Declined | `402` · `PAYMENT_FAILED`, stock released |
  | `4000000000090003` | Provider error | `502` with `orderId` · payment `UNKNOWN` |
  | `4000000000080004` | Provider timeout | `502` with `orderId` · reconciled later by the worker |

  Scenario hints next to products (MacBook Pro 16" qty ≥ 3 → `422`
  no-fulfilment; iPad Pro 11" only 5 in Newark). Live JSON preview of the
  body. *Send* opens a confirmation dialog showing method, URL, headers
  and the exact JSON; *Confirm* executes.
- **GET /orders form:** status, warehouse, created-from/to, page size;
  *Load next page* re-runs with `nextCursor`.
- **GET /orders/:id form:** order id with autocomplete from order ids seen
  in previous executions.
- Response pane: status chip, duration, correlation id, tabs *Pretty*
  (order card / list table / problem card with `errors[]`) and *Raw*.
  Link to the execution's detail page.

### Execution record (localStorage)

```ts
interface Execution {
  id: string;                  // uuid
  startedAt: string;
  durationMs: number;
  request: { kind: 'CREATE_ORDER' | 'LIST_ORDERS' | 'GET_ORDER';
             method: 'GET' | 'POST'; url: string;
             query: Record<string, string>; headers: Record<string, string>;
             body: unknown | null };
  response: { status: number | null;      // null = network/CORS failure
              headers: Record<string, string>; body: unknown | null;
              error: string | null };
  orderId: string | null;      // from body.id, problem.orderId, or the GET path
  correlationId: string | null;
}
```

### Lifecycle view

When `orderId` is known, the detail page fetches the timeline and renders
an MUI Lab `Timeline` grouped by phase, dot colour by outcome (OK green,
PENDING amber, FAILED red), each item expandable to its `detail`.
*Refresh* re-fetches (watch a `502` order get reconciled or jobs move from
`created` to `completed`). With no `orderId` (e.g. `404`/`422` before an
order row exists) the view shows a request-level strip: *Received →
Validated → Rejected at <phase>* derived from the status and problem
`type`. A "View trace in Grafana" link opens Explore on `:3001` with the
correlation id.

## Implementation plan

Each step: `npm run lint` + `npm run build` green (backend) or
`npm --prefix web run build` + `npm --prefix web run lint` green
(frontend). Frontend steps are validated in Chrome via the
Claude-in-Chrome MCP (drive the UI, check console + network, screenshot)
before the step summary.

1. **CORS.** `exposedHeaders: ['X-Correlation-Id']` in `main.ts`;
   `CORS_ORIGINS` default + `.env.example` + compose `api` env include
   `http://localhost:5173`.
   *Verify:* `curl -i -H 'Origin: http://localhost:5173' localhost:3000/health`
   shows `Access-Control-Allow-Origin: http://localhost:5173` and
   `Access-Control-Expose-Headers: X-Correlation-Id`; unit test on the
   env schema default.

2. **Timeline repository reads.** The four new `OrdersReadRepository`
   methods.
   *Verify:* integration test (`references/testing.md` fixtures) — an
   order with RESERVE+COMMIT movements, an idempotency row and two
   pg-boss jobs (one in a `.dlq` queue) is returned by each query; an
   unknown id returns empty/null.

3. **`timeline.helpers.ts` + `GetOrderTimelineService`.**
   *Verify:* unit tests — happy path ordering; declined path
   (RESERVE → PAYMENT_ATTEMPT FAILED → RELEASE → PAYMENT_FAILED);
   `UNKNOWN` payment → PENDING; DLQ job → FAILED; correlation id prefers
   job meta over idempotency body; malformed id → `OrderNotFoundError`
   without touching the repository.

4. **DTO + controller route.** `toOrderTimelineResponse`,
   `@Get(':id/timeline')`.
   *Verify:* unit test on projection (no `raw_response`/card field, no
   `data` blob from pg-boss); e2e in `test/orders.e2e-spec.ts` — `POST`
   then `GET …/timeline` returns `IDEMPOTENCY`, `RESERVE`, `CHARGE`,
   `SETTLE` events; bad id → `404`.

5. **`web/` scaffold.** Vite React-TS, MUI theme, router with the three
   routes, top bar + base URL setting, `catalog.ts`, `client.ts`,
   executions store.
   *Verify:* dev server renders the shell; Chrome: nav works, base URL
   persists across reload, no console errors.

6. **Console: GET requests + response pane.** Request selector, GET
   list/by-id forms, `ResponseView` with Pretty/Raw, executions recorded.
   *Verify:* Chrome: list orders, load next page, get by id, bad id shows
   problem card; correlation id visible.

7. **Console: POST form.** Formik/Yup form, card outcome chips, headers
   panel, confirm dialog.
   *Verify:* Chrome: each of the 4 cards gives the expected status; reuse
   key + same body → replayed response; reuse key + changed body → `422`;
   MBP16 × 3 → `422`; unknown city blocked client-side.

8. **Executions page.** Table (time, method, path, status, duration,
   order id, correlation id), filters, clear-all, row → detail.
   *Verify:* Chrome: rows persist across reload; filters work.

9. **Execution detail + Lifecycle.** Request/response sections,
   `LifecycleTimeline`, refresh, Grafana link.
   *Verify:* Chrome: 4242 order shows full timeline through jobs; 0002
   shows RELEASE + PAYMENT_FAILED; 0004 shows PENDING then (after
   refresh, once the worker reconciles) settled. GIF of the full flow.

10. **README "Console" section + root `web:dev`/`web:build` scripts.**
    *Verify:* fresh-clone instructions run as written.

## Acceptance criteria

- [ ] Browser JS can read `X-Correlation-Id` from API responses.
- [ ] `GET /orders/:id/timeline` returns ordered events covering idempotency, reservation, every payment attempt, settlement, shipment and every fan-out/DLQ job for the order.
- [ ] The timeline response contains no card data, `raw_response`, or raw pg-boss `data`.
- [ ] Each of the four test cards can be sent from the console without typing JSON, and the result matches the card's stated outcome.
- [ ] Every request sent from the console appears in Executions, survives a reload, and its detail shows URL, params, headers, sent body and received body.
- [ ] An order's lifecycle is shown as a phase-grouped timeline with success/pending/failure clearly distinguished.
- [ ] `npm run verify` stays green.

## Decisions

- **Yes:** a server-side timeline endpoint built from existing tables.
  The data that describes the saga (`inventory_movements`, `payments`,
  `idempotency_keys`, `pgboss.job`) is already persisted; a read endpoint
  is the cheapest honest source.
- **No:** deriving the lifecycle only in the browser from `POST`/`GET`
  responses. Neither response exposes reservations, commits/releases or
  jobs, so the "diagram" would be guesswork.
- **No:** reading Tempo from the browser. Tempo/Loki ports are not
  published, Grafana sends no CORS headers, and app logs are not shipped
  to Loki (SPEC 04 decision). A link to Grafana Explore keeps traces one
  click away without a proxy.
- **Yes:** no `order_status_history` table / no migration. `PAID` has no
  timestamp of its own (it is transient inside `confirmCaptured`'s single
  transaction), so the timeline shows `CONFIRMED` at `confirmed_at` and
  does not invent a `PAID` event.
- **Yes:** timeline queries live on `OrdersReadRepository` (SPEC 06's
  read-side home) rather than a new repository; reading `pgboss.job` is
  raw SQL there, same as any other table, filtered by the known queue
  names so partition pruning applies.
- **Yes:** the timeline is a *projection* (`title`, `outcome`, flat
  `detail`), not the raw rows. Keeps the frontend dumb and guarantees
  nothing sensitive (`raw_response`, card fields, job `data`) leaks.
- **Yes:** hardcode the seed catalogue in `web/src/api/catalog.ts`. The
  API has no product/warehouse endpoints; adding them just for the
  console widens the API surface for a demo tool. Drift risk is accepted
  and noted in Risks.
- **Yes:** executions in `localStorage` (capped at 200). Per-browser is
  enough for a reviewer's session; no backend table for UI history.
- **Yes:** MUI (+ `@mui/lab` Timeline) and Formik + Yup. Fastest path to
  a polished table, dialog, select and timeline without hand-building
  them.
- **Yes:** the console's look follows canals.ai's palette and type
  (navy `#061237` bar, blue `#1355FF` actions, Playfair Display + Raleway)
  so the demo tool reads as part of the same product. All values live in
  one MUI theme (`theme.ts`); no per-component hex.
- **No:** copying the site's logo or images. A generic wave icon +
  wordmark is enough for a local demo tool.
- **Yes:** `web/` is its own npm package, not part of root `verify`/CI.
  It is a demo tool; its build must not gate backend changes.
- **Yes:** confirmation dialog before `POST` only. `GET`s are safe and
  repeatable; the dialog exists because `POST` creates real orders and
  consumes stock.

## Risks

| Risk | Mitigation |
|---|---|
| `pgboss.job` has no index on `data->'payload'->>'orderId'`; the JSON predicate is a scan within the pruned partitions. | Fine at demo volume (jobs deleted after 7 days). Documented; an expression index is the follow-up if it ever matters. |
| pg-boss internal schema can change between majors (v12 has no `archive`, earlier versions did). | Query pinned to the installed 12.x shape; integration test in step 2 fails loudly on a schema change. |
| Hardcoded catalogue drifts from `seed.ts`. | `catalog.ts` header comment points to `seed.ts`, `us-cities.ts` and `payments-mock/src/constants.ts` as sources of truth. |
| Card `4000000000080004` hangs 30 s in the mock; the API returns `502` after ~6 s. | Console shows a spinner with "provider timeout expected" and does not block other requests. |
| Worker not running → jobs stay `created`, shipment never appears. | Timeline shows them as PENDING; README tells the reviewer to `docker compose up worker`. |

## What is **not** in this spec

- Auth, multiple customers, catalogue endpoints.
- Grafana/Tempo embedding or a trace proxy.
- DLQ replay or any job-management action.
- Packaging the console in docker-compose or CI.
