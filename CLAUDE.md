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

`knowledge/README.md` is the centralised code knowledge: rationale,
invariants and investigations behind the code, indexed by file and
symbol. Read the relevant topic when a comment points there
(`See knowledge/<topic>.md#<anchor>`).

## Commands

```bash
docker compose up -d postgres   # local Postgres + PostGIS
npm run migration:run           # apply migrations (needs DATABASE_URL etc. exported)
npm run seed                    # seed script (manual/local only — CI doesn't run this)
npm run lint / build            # rm -rf dist first if a stale build is confusing lint's glob
npm run test:unit               # no DB needed
npm run test:integration        # needs a migrated Postgres reachable; runs serially (jest-integration.json maxWorkers:1) — specs share one real Postgres/pg-boss instance, parallel workers race each other's queue rows
npm run concurrency-check       # -- 50 for N=50; default N=5, resets its own fixture each run
npm run payments-check          # needs payments-mock reachable (docker compose up); ~7s, dominated by card 0004's timeout
npm run events-check            # needs a worker reachable (docker compose up); publishes order.confirmed, waits for 3 jobs + 1 shipment
npm run verify                  # lint + build + unit + integration + e2e + verify:db + concurrency-check + payments-check + events-check
npm run web:dev                 # Canals Console hot reload (web/, own package — web:install first; `docker compose stop web` first, both use :5173); compose serves the built console on :5173; not part of verify
```

Queue topology, retry/DLQ behaviour, the Grafana trace walkthrough,
`X-Correlation-Id` and how to inspect/reprocess a DLQ job: README.md,
"P3 — Queue, worker and observability".

## `/spec-impl` workflow — per-step review loop

After implementing each step of a spec's implementation plan:

1. Write a detailed, easy-to-understand summary of what changed, with a
   simple example (what the code does, not just which files changed).
2. Stop. Let the user review the diff themselves.
3. Wait for explicit confirmation.
4. Only then commit that step (one commit per plan step, not one commit
   for the whole spec).

Do not batch multiple plan steps into a single commit or skip the
summary-then-wait sequence, even if the change looks trivial.
