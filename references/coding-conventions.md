# Coding conventions

Referenced from `CLAUDE.md`. Read before writing or refactoring a
service, use case, or any function whose signature is growing past a
couple of parameters.

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

## Exception: multi-phase orchestrators may split by phase into private methods

The rule above assumes one method doing one operation
(`reserve`/`release`/`commit`), each with its own single, coherent flow.
A use case that orchestrates a spec-documented sequence of distinct
phases — e.g. `CreateOrderUseCase.execute()`
(`src/application/orders/create-order.use-case.ts`, SPEC 05's three-phase
saga: reserve, charge, settle) — is a different shape: one method's
"coherent flow" would otherwise span hundreds of lines covering three
unrelated sets of decisions (customer/product resolution, payment
capture, inventory settlement), each already named and bounded by the
spec itself.

For this shape, splitting by phase into `private` methods is preferred
over one large method, **as long as each phase's own logic — its
conditionals, its branching, the decisions that make it a settle and not
a reserve — stays written directly in that phase's method body.** The
top-level method (`execute()`) reads as the saga's table of contents:

```ts
async execute(command: CreateOrderCommand): Promise<CreateOrderResult> {
  const productById = await this.resolveCustomerAndProducts(command);
  const reserved = await this.reserveOrder(command, productById);
  const charged = await this.chargeOrder(command, reserved.order);
  return this.settleOrder({ ...reserved, ...charged });
}
```

This is still subject to the same underlying rule as the mechanical
case above: a private method here is not a mechanical, no-decision
extraction (so it is a method, not a `helpers/` function) — it exists
because the *phase itself*, as a whole, is a named unit the spec already
drew a boundary around. Do not use this exception to hide an arbitrary
mid-method decision inside a private method with a vague name; each
extracted method must correspond to a phase the spec names.

## Raw SQL over query builders, for anything performance- or concurrency-critical

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
