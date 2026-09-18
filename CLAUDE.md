# CLAUDE.md

Project-specific conventions for Claude Code (and any implementer) working
in this repo. This file loads automatically every session — kept short on
purpose. Read alongside:

- `engineering:documentation/architectural-requirements.md` — the full
  requirements, NFRs and technology decisions.
- `engineering:documentation/data-model.dbml` / `infrastructure.md` —
  schema and deployment topology.
- `phases/*.md` — the phase plan.
- `specs/*.md` — approved, phase-by-phase implementation specs. Each has
  a `## Decisions` section recording *why*, not just *what* — read it
  before assuming a design choice is arbitrary.

## References

Topic-specific conventions live under `references/` and are **not**
loaded automatically — read the relevant one before working on that
topic, not preemptively:

- `references/layering.md` — the frozen layer boundaries and the
  domain-service test (when a rule belongs in a domain class vs. the
  database).
- `references/coding-conventions.md` — named constants vs. env vars,
  max-3-positional-parameters, the services/helpers split, raw SQL
  typing.
- `references/data-integrity.md` — append-only ledgers and idempotency.
- `references/testing.md` — how `*.integration.spec.ts` files build
  their fixtures.

## Commands

```bash
docker compose up -d postgres   # local Postgres + PostGIS
npm run migration:run           # apply migrations (needs DATABASE_URL etc. exported)
npm run seed                    # seed script (manual/local only — CI doesn't run this)
npm run lint / build            # rm -rf dist first if a stale build is confusing lint's glob
npm run test:unit               # no DB needed
npm run test:integration        # needs a migrated Postgres reachable
npm run concurrency-check       # -- 50 for N=50; default N=5, resets its own fixture each run
npm run payments-check          # needs payments-mock reachable (docker compose up); ~7s, dominated by card 0004's timeout
npm run verify                  # lint + build + unit + integration + e2e + verify:db + concurrency-check + payments-check
```
