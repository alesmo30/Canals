# Layering and domain boundaries

Referenced from `CLAUDE.md`. Read when touching `src/domain/**`, adding a
new cross-layer dependency, or deciding whether a rule belongs in a
domain class versus the database.

## Layering (frozen since SPEC 01)

HTTP controllers → application services/use cases → domain → infrastructure
adapters. `src/domain/**` has no NestJS or TypeORM imports and never
imports `src/infrastructure/**` — it depends on ports
(`src/domain/ports/`), adapters implement them. Enforced by
`eslint.config.mjs`'s `no-restricted-imports` rules — a new architectural
boundary gets a rule there, not a comment asking people to remember it.

## The domain-service test

specs/02-fulfilment-core.md, Decisions. Before writing an in-memory
domain class to check or rank something, ask *can this rule be
guaranteed in memory, or does it need the database?* If the database
already guarantees it (a `HAVING` clause, a `CHECK` constraint, a unique
index), a domain class that re-checks it is a second, divergent source
of truth — write the rule once, in the SQL, and skip the domain class.
This is what cut SPEC 01 from eleven planned domain classes to two
(`Order`, `OrderItem`) and why SPEC 02 has no `WarehouseSelector` domain
service.
