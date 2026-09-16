# Phases — Execution Plan

Decomposition of [`../engineering:documentation/architectural-requirements.md`](../engineering:documentation/architectural-requirements.md)
and [`../engineering:documentation/infrastructure.md`](../engineering:documentation/infrastructure.md)
into executable phases.

Each phase file is written to be fed into `/spec`. It states **what must be true
when the phase is done**, not how to write the code.

| | |
|---|---|
| **Deadline** | Friday 2026-09-18 |
| **Capacity assumed** | 1–2 concurrent sessions |
| **Observability scope** | OTel auto-instrumentation + structured logs + health |
| **Stretch** | P7 only, behind an explicit gate |

---

## Wave structure

```
  WAVE 0 — BLOCKING, alone
  ┌──────────────────────────────────────────────────────┐
  │ P0 · Foundation                                      │
  │ scaffold · migrations · entities · PORTS · seed       │
  │ Everything downstream depends on the contracts here. │
  └──────────────────────────────────────────────────────┘
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
  WAVE 1 — pair these two
  ┌──────────────────┐  ┌──────────────────────────┐
  │ P1 · Fulfilment  │  │ P2 · External adapters   │
  │ 🔴 HIGHEST RISK  │  │ payments-mock, geocoding │
  └──────────────────┘  └──────────────────────────┘
          │                   │
          ▼                   ▼
  WAVE 2 — pair these two
  ┌──────────────────────────┐  ┌──────────────────┐
  │ P3 · Queue + worker      │  │ P5 · Read side   │
  │      + observability     │  │ GET /orders      │
  └──────────────────────────┘  └──────────────────┘
          │
          ▼
  WAVE 3 — SEQUENTIAL, integrates everything
  ┌──────────────────────────────────────────────────────┐
  │ P4 · Order creation saga                             │
  │ POST /orders · idempotency · three-phase transaction │
  └──────────────────────────────────────────────────────┘
          │
          ▼
  WAVE 4
  ┌──────────────────────────┐  ┌──────────────────────────┐
  │ P6 · Hardening + demo    │  │ P7 · Stretch (GATED)     │
  └──────────────────────────┘  └──────────────────────────┘
```

## Dependency matrix

| Phase | Depends on | Can run in parallel with | Risk |
|---|---|---|---|
| P0 Foundation | — | *nothing — it is blocking* | medium |
| P1 Fulfilment core | P0 | P2, P5 | 🔴 **high** |
| P2 External adapters | P0 | P1, P5 | low |
| P3 Queue + worker + observability | P0 | P5 | medium |
| P4 Order creation saga | P0, P1, P2, P3 | P5 | 🔴 **high** |
| P5 Read side | P0 | anything | low |
| P6 Hardening + demo | P4 | — | medium |
| P7 Stretch | P6 green | — | — |

## Suggested calendar

| | Session A | Session B |
|---|---|---|
| **Wed AM** | **P0** — alone, do not parallelise | — |
| **Wed PM** | **P1** (start; the hard one) | P2 |
| **Thu AM** | P1 (finish) | P3 |
| **Thu PM** | **P4** — integration | P5 |
| **Fri AM** | P4 (finish) + **P6** | P6 |
| **Fri PM** | buffer · submit | P7 only if everything is green |

**If you fall behind, P1 and P4 are the two that must not be rushed.** They carry
the assessment's actual signal: no overselling under concurrency, and clean
failure handling around the payment call.

---

## Rules of engagement for parallel sessions

1. **P0 freezes the contracts.** Domain entities, port interfaces and the database
   schema are settled in P0 and treated as immutable afterwards.
2. **Each phase owns files.** Every phase file lists the paths it may create or
   modify. A phase must not touch another phase's paths.
3. **If a phase needs to change a frozen contract, it stops.** It does not edit the
   interface — it raises the conflict, because a sibling phase is compiling
   against it right now.
4. **Each phase ends green.** The repo must build and `docker compose up` must
   still work at the end of every phase. No phase is allowed to leave the tree
   broken for the next one.
5. **Shared files are P0-only.** `docker-compose.yml`, `shared.module.ts` and the
   migrations directory are amended by later phases *only* in the sections those
   phases' files explicitly name.

> ⚠️ **One known collision: `docker-compose.yml`.** P2 adds the `payments-mock`
> service and P3 adds `lgtm`. The wave order keeps them apart (P2 is Wave 1, P3 is
> Wave 2), so **do not run P2 and P3 at the same time**. If you must, do one of
> them by hand afterwards — it is four lines of YAML, not worth a merge conflict.

### Verified: no other file-ownership overlap

Every phase declares the paths it owns. Those declarations were checked
mechanically across all eight phases; `docker-compose.yml` above is the only path
claimed by more than one, and P0 owns the frozen contracts outright. Any phase
pair the matrix marks as parallel can therefore run without colliding.

---

## Traceability

| Requirement | Phase |
|---|---|
| FR-1 Create order | P4 |
| FR-2 Warehouse selection | **P1** |
| FR-3 Geocoding | P2 |
| FR-4 Payment | P2 |
| FR-5 Three-phase saga | **P4** (inventory mechanics in P1) |
| FR-6 Idempotency | P4 |
| FR-7 Read orders | P5 |
| FR-8 Validation + error contract | P4 |
| FR-9 Async work | P3 |
| FR-10 Bulk | P7 |
| FR-11 PATCH | P7 |
| NFR-1 Concurrency correctness | P1 (mechanism) + P6 (proof) |
| NFR-2 Performance | P1, P5 |
| NFR-3 Resilience | P2, P6 |
| NFR-4 Observability | P3 |
| NFR-5 Data management | P0 |
| NFR-6 Security | P0, P2, P4 |
| NFR-7 Scalability | P6 |
| NFR-8 Maintainability | P0 |
| NFR-9 Operability | P0, P6 |
