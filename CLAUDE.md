# CLAUDE.md

Project-specific conventions for Claude Code (and any implementer) working
in this repo. Read alongside:

- `engineering:documentation/architectural-requirements.md` — the full
  requirements, NFRs and technology decisions.
- `engineering:documentation/data-model.dbml` / `infrastructure.md` —
  schema and deployment topology.
- `phases/*.md` — the phase plan.
- `specs/*.md` — approved, phase-by-phase implementation specs. Each has
  a `## Decisions` section recording *why*, not just *what* — read it
  before assuming a design choice is arbitrary.

## Layering (frozen since SPEC 01)

HTTP controllers → application services/use cases → domain → infrastructure
adapters. `src/domain/**` has no NestJS or TypeORM imports and never
imports `src/infrastructure/**` — it depends on ports
(`src/domain/ports/`), adapters implement them. Enforced by
`eslint.config.mjs`'s `no-restricted-imports` rules — a new architectural
boundary gets a rule there, not a comment asking people to remember it.

**The domain-service test** (specs/02-fulfilment-core.md, Decisions): before
writing an in-memory domain class to check or rank something, ask *can this
rule be guaranteed in memory, or does it need the database?* If the
database already guarantees it (a `HAVING` clause, a `CHECK` constraint, a
unique index), a domain class that re-checks it is a second, divergent
source of truth — write the rule once, in the SQL, and skip the domain
class. This is what cut SPEC 01 from eleven planned domain classes to two
(`Order`, `OrderItem`) and why SPEC 02 has no `WarehouseSelector` domain
service.

## Named constants over environment variables

A value nobody tunes per deployment (a lock timeout, a reservation TTL)
is a named constant in the module that uses it, not an entry in
`env.schema.ts`/`.env.example`. Adding an env var is for values an
operator actually needs to change without a redeploy — everything else is
line noise in the config surface.

## Function/method signatures: max 3 positional parameters

A function or method takes at most 3 positional arguments. Beyond that,
bundle the rest into a single parameter object with a named `interface`:

```ts
// No — 5 positional args, call sites unreadable without checking the signature
async function updateInventory(
  manager: EntityManager,
  warehouseId: string,
  productId: string,
  availableAfter: number,
  reservedAfter: number,
): Promise<void> { ... }

// Yes — interface local to the file, since nothing else uses this shape
interface UpdateInventoryBalancesParams {
  warehouseId: string;
  productId: string;
  availableAfter: number;
  reservedAfter: number;
}
async function updateInventoryBalances(
  manager: EntityManager,
  params: UpdateInventoryBalancesParams,
): Promise<void> { ... }
```

`manager`/`tx`-style context objects count toward the 3. If the interface
is only used by the one function that takes it, keep it local to that
file (not exported). If a second file needs the same shape, promote it to
a shared location — for this codebase, that means the module's own
`*.types.ts` (e.g. `src/application/allocation/allocation.types.ts`), not
a new interface duplicated at each call site.

## Services hold their own logic; only the mechanical parts become helpers

A `*.service.ts` method's own business logic — its flow, its
conditionals, the sequence of steps that make it *that* operation and not
another one — stays written directly in the method body. Do **not**
collapse a method into a single delegating call to an external function
that does the whole thing; that hides the logic the method exists to
express and makes two near-identical methods (e.g. `release`/`commit`)
look identical from the outside when they aren't:

```ts
// No — the method body says nothing; all of it, including the parts
// that differ between release/commit, is hidden in settleReservation
async commit(manager: EntityManager, command: ReleaseCommand): Promise<void> {
  await settleReservation(manager, command, 'COMMIT');
}

// Yes — the flow (loop, idempotency check, this operation's own delta
// math) is right here; only the mechanical, genuinely-shared steps
// (locking, writing a row) are calls out to helpers
async commit(manager: EntityManager, command: ReleaseCommand): Promise<void> {
  const byProductId = await lockInventoryRows(manager, command.warehouseId, command.productIds);

  for (const productId of command.productIds) {
    const [latest] = await manager.query(/* latest movement for this line */);
    if (!latest || latest.type === 'RELEASE' || latest.type === 'COMMIT') continue;

    const row = byProductId.get(productId);
    if (!row) continue;

    const reservedAfter = row.quantity_reserved - Math.abs(latest.quantity_delta);
    await updateInventoryBalances(manager, { warehouseId: command.warehouseId, productId, availableAfter: row.quantity_available, reservedAfter });
    await insertMovement(manager, { warehouseId: command.warehouseId, productId, orderId: command.orderId, type: 'COMMIT', quantityDelta: 0, availableAfter: row.quantity_available, reservedAfter });
  }
}
```

Only pull a piece out into a helper when it is **purely mechanical and
has no decision of its own** — acquiring a lock, running one `UPDATE`,
appending one ledger row, checking an error code. Those live as plain
exported functions in a `helpers/` subfolder next to the service (e.g.
`src/application/allocation/helpers/inventory.helpers.ts`), not as
`private` methods on the class — a `private` method is still part of the
class's own surface; a helpers file makes "mechanism" a file boundary
instead of a name you have to recognise while reading top to bottom.

Some duplication between sibling methods (`release` and `commit` each
have their own loop and their own idempotency check) is the accepted
cost of this — it is *not* a sign to extract a shared
"do-the-whole-thing" function again. If the duplicated part is itself
genuinely mechanical (not a decision), that specific part is what moves
to `helpers/`, not the method around it.

This does not apply to genuinely small services with nothing to extract —
don't invent a `helpers/` folder for a two-line method.

## Raw SQL over query builders, for anything performance- or
concurrency-critical

TypeORM entities exist for straightforward CRUD and for the two domain
aggregates (`Order`/`OrderItem`, via `order.mapper.ts`). The warehouse
selection query and every locking statement in `InventoryService` are
hand-written, parameterised SQL executed through `manager.query()` /
`dataSource.query()` — too important to leave to a query builder's
generated plan. `EntityManager.query<T>`/`DataSource.query<T>` are
generic (default `T = any`); type the result via the assigned variable's
annotation (`const rows: FooRow[] = await manager.query(...)`), not an
`as` cast — the cast trips `@typescript-eslint/no-unnecessary-type-assertion`
once the variable is already annotated, and skips it entirely if it
isn't.

## Append-only ledgers and idempotency

`inventory_movements` (and anything like it) is `INSERT`-only, forever —
no `UPDATE`, no `DELETE`. An idempotent operation that must not repeat a
side effect (`release`, `commit`) guards on the **latest** ledger row for
its key, read **after** the relevant row-level lock is acquired (never
before — reading state before locking is a check-then-act race). The
amount such an operation moves comes from the ledger's own prior row
(e.g. the original `RESERVE`'s `quantity_delta`), never re-supplied by
the caller — the ledger is the source of truth for "how much", the
caller only says "which".

## Integration tests build their own fixtures

`*.integration.spec.ts` files never depend on `seed.ts` having run —
`.github/workflows/tests.yml`'s integration job runs migrations but not
the seed. Each test builds its own customers/products/warehouses/orders
with `randomUUID()`-scoped values (see
`order.mapper.integration.spec.ts`, `warehouse-selection.repository.integration.spec.ts`,
`inventory.service.integration.spec.ts`) and never cleans up afterward —
uniqueness, not teardown, is what keeps tests independent.

## Commands

```bash
docker compose up -d postgres   # local Postgres + PostGIS
npm run migration:run           # apply migrations (needs DATABASE_URL etc. exported)
npm run seed                    # seed script (manual/local only — CI doesn't run this)
npm run lint / build            # rm -rf dist first if a stale build is confusing lint's glob
npm run test:unit               # no DB needed
npm run test:integration        # needs a migrated Postgres reachable
npm run verify                  # lint + build + unit + integration + e2e + verify:db
```
