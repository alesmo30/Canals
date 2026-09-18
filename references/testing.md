# Testing conventions

Referenced from `CLAUDE.md`. Read before writing or extending a
`*.integration.spec.ts` file.

`*.integration.spec.ts` files never depend on `seed.ts` having run —
`.github/workflows/tests.yml`'s integration job runs migrations but not
the seed. Each test builds its own customers/products/warehouses/orders
with `randomUUID()`-scoped values (see
`order.mapper.integration.spec.ts`, `warehouse-selection.repository.integration.spec.ts`,
`inventory.service.integration.spec.ts`) and never cleans up afterward —
uniqueness, not teardown, is what keeps tests independent.
