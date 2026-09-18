<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## P1 — Fulfilment core: warehouse selection and stock reservation

specs/02-fulfilment-core.md. FR-2's nearest-warehouse selection and the
reservation ledger (`reserve` / `release` / `commit`), proved against
concurrent load. Driven from tests and scripts only — no HTTP endpoint
yet (`POST /orders` is P4).

### The selection query and its captured plan

`src/infrastructure/database/sql/select-warehouse.sql` returns the top 3
warehouses able to supply every requested line, ordered by geodesic
distance. With the `inventory`/`products` join present, the planner does
**not** drive the ordering off `idx_warehouses_location_gist` — reproduced
with 500 synthetic warehouses and fresh `ANALYZE` statistics, at both
partial and full selectivity. The query applies the documented fallback
instead: an `eligible` CTE resolves which warehouse ids can supply every
line first (C-6's `HAVING`), then only that small set is joined back to
`warehouses` — by primary key, never a sequential scan — and sorted by
distance. Condensed captured plan (full JSON logged by
`warehouse-selection.explain.integration.spec.ts`; see
`specs/02-fulfilment-core.md`'s Decisions for the complete writeup):

```
Limit
  InitPlan (CTE requested): Function Scan
  Result
    Sort  Sort Key: (w.location <-> '...'::geography), w.id
      Nested Loop
        Aggregate  Group Key: i.warehouse_id  Filter: (count(*) = $1)
          InitPlan 2 (returns $1): Aggregate over CTE Scan requested
          Sort  Sort Key: i.warehouse_id
            Nested Loop  Join Filter: (i.quantity_available >= r.quantity) AND (i.product_id = r.product_id)
              Hash Join  Hash Cond: (p.id = r.product_id)
                Seq Scan on products p  Filter: is_active
                Hash -> CTE Scan requested r
              Index Scan using idx_inventory_availability on inventory i
                Index Cond: (product_id = p.id)
        Index Scan using warehouses_pkey on warehouses w
          Index Cond: (id = i.warehouse_id)  Filter: is_active
```

`warehouses` is reached exactly once, by primary key, for the handful of
ids the `eligible` CTE resolved — never a scan over the full table.

### The ledger replay

`src/infrastructure/database/sql/verify-ledger.sql` reconstructs every
`inventory` balance from `inventory_movements` and returns only the rows
that disagree. Not a `SUM(quantity_delta)`: that column only tracks
`quantity_available`'s own per-movement change (no equivalent for
`quantity_reserved` — `COMMIT`'s delta is `0` even though `reserved`
drops), and a row's starting stock is a direct `INSERT`, never a
movement, so a bare sum has no anchor. Every movement already carries the
full post-movement balance in `available_after`/`reserved_after` — the
latest one, per `(warehouse_id, product_id)`, *is* the replayed balance:

```sql
WITH latest_movement AS (
  SELECT DISTINCT ON (warehouse_id, product_id)
    warehouse_id, product_id, available_after, reserved_after
  FROM inventory_movements
  ORDER BY warehouse_id, product_id, id DESC
)
SELECT
  i.warehouse_id, i.product_id,
  lm.available_after AS expected_available, i.quantity_available AS actual_available,
  lm.reserved_after AS expected_reserved, i.quantity_reserved AS actual_reserved
FROM inventory i
JOIN latest_movement lm ON lm.warehouse_id = i.warehouse_id AND lm.product_id = i.product_id
WHERE i.quantity_available <> lm.available_after
   OR i.quantity_reserved <> lm.reserved_after;
```

Runnable directly in `psql`, no Jest required:

```bash
docker compose exec postgres psql -U canals -d canals -f - < src/infrastructure/database/sql/verify-ledger.sql
```

### The concurrency proof

```bash
npm run concurrency-check        # N = 5
npm run concurrency-check -- 50  # N = 50
```

Seeds a fixed product with exactly `N` units, fires `N + 20` concurrent
reservation attempts against a shared start signal (so every attempt
contends on the same `inventory` row, not on connection availability),
commits every winner immediately, then reports the result:

```
--- concurrency-check ---
N = 5, attempts = 25
successes = 5, failures = 20
final balances: quantity_available = 0, quantity_reserved = 0
verify-ledger.sql discrepancies = 0
PASSED
```

Exactly `N` succeed, exactly 20 fail with `InsufficientStockError`, never
`N + 1` — `reserve`'s `SELECT ... FOR UPDATE ORDER BY product_id` under a
3-second `lock_timeout` is what the run is proving. Re-running (at any
`N`) gives the same shape of result: the script resets its own fixture's
stock and movements before each run.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
