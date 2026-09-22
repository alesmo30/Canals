# SPEC 07 — progreso al 2026-09-22

Documento de handoff, no un spec. Referencia rápida para retomar
`/spec-impl @specs/07-hardening-demo.md` después de limpiar contexto.
El spec en sí (`specs/07-hardening-demo.md`) sigue siendo la fuente de
verdad — esto solo resume qué ya está hecho y qué falta.

**Rama:** `spec-07-hardening-demo` (ya creada, ya con 13 commits, uno
por step — ver `git log --oneline` en esa rama).

## Steps 1–13: hechos y commiteados

| # | Qué | Commit |
|---|---|---|
| 1 | Fix A.1 — redacción de mensajes pino (`hooks.logMethod`) | `653198c` |
| 2 | Fix A.2 — redacción de spans (`RedactingSpanExporter`) | `1a2684e` |
| 3 | Fix B — clasificación correcta de `getStatus()` | `387382a` |
| 4 | Fix C — `502` con `orderId`, idempotencia graba `order_id` en 402/502 | `2da60a3` |
| 5 | Saga — `settled_at` solo en outcomes definitivos | `ff0ad2f` |
| 6 | `OrderSettlementService` + saga Phase 3 sobre él | `a6d9983` |
| 7 | Scheduled-job plumbing (`SCHEDULED_JOBS`, `boss.schedule`, jobs sin `meta`) | `d12badd` |
| 8 | R6.1 — `ReservationReaperHandler` | `d59e664` |
| 9 | R6.2 — `PaymentReconciliationHandler` | `a6420ec` |
| 10 | R6.6 — helmet, CORS, body limit, rate limiting | `f21884b` |
| 11 | R6.6 — OpenAPI en `/docs` | `99c288e` |
| 12 | R6.3 — `scripts/concurrency-e2e.ts` (prueba de concurrencia vía HTTP) | `a7f4ef5` |
| 13 | R6.4 — `scripts/demo/` (`npm run demo`, 10 escenarios) | `f213018` |

Cada commit tiene su propio mensaje detallado — `git show <hash>` para
el resumen exacto de cada paso si hace falta releer el razonamiento.

## Qué falta

- **Step 14 — R6.5, README rewrite.** Reemplazar el boilerplate de Nest:
  prerequisitos, arranque en un comando, mapa de puertos, diseño en ~1
  página (por qué tres fases y no una transacción, por qué la selección
  de warehouse es una sola sentencia, por qué la cola vive en Postgres),
  un `curl` copy-pasteable por cada escenario de R6.4, el switch
  `GEOCODING_DRIVER=geoapify` y su atribución, *Known limitations* (la
  lista out-of-scope del spec + FR-10/FR-11, con razones). Arreglar lo
  desactualizado: los walkthroughs de `/internal/events/order-confirmed`,
  `docker stop payments-mock` → `docker compose stop payments-mock`, la
  nota de `require('pg-boss')`.
  *Verify:* cada `curl` del README pegado contra un stack corriendo da
  el status documentado.

- **Step 15 — R6.6 + R6.7, shutdown check y clean-clone rehearsal.**
  `docker compose stop` a mitad de `concurrency-e2e`: api y worker
  salen dentro del grace period, sin job `IN_PROGRESS` trabado. Luego un
  `git clone` fresco a un directorio nuevo, `docker compose down -v`
  antes, seguir *solo* el README hasta un `201`, después `npm run demo`.
  Anotar tiempo hasta la primera orden y cualquier cosa que hubo que
  arreglar en *Rehearsal notes* al final del spec.
  *Verify:* `npm run verify` verde; rehearsal notes llenas.

## Gotchas encontrados esta sesión (para no repetir el trabajo de debug)

1. **El contenedor `worker` corría una imagen vieja** — nunca se
   reconstruyó entre steps, solo se reiniciaba (`docker compose up -d
   worker`, sin `--build`). El reaper/reconciliación nunca corrían de
   verdad en Docker aunque los tests de integración (que instancian las
   clases directamente) pasaban. **Antes de dar por buena cualquier
   verificación manual contra Docker, correr `docker compose up -d
   --build api worker` primero.**
2. **`docker compose up` normal es seguro** — `seed.ts` no crea
   órdenes (solo catálogo: clientes, warehouses, productos, inventario),
   así que no ensucia el `LIMIT 50` del reaper. La contaminación de
   ~2300 filas `PENDING_PAYMENT` que apareció a mitad de sesión era
   cruft de *antes* de esta sesión (no de `seed.ts`), ya se limpió con
   `docker compose down -v` y no volvió a aparecer.
3. **`docker compose stop payments-mock` seguido de un `fetch`
   inmediato** puede dar `fetch failed` (blip de networking del host,
   Docker Desktop). `scripts/demo/harness.ts`'s `fetchWithNetworkBlipRetry`
   ya lo maneja con un retry.
4. **El circuit breaker de pagos es compartido** entre `charge()` y
   `getStatus()` (`http-payment-gateway.ts`). Si algo lo abre
   (`BREAKER_OPEN_MS = 30_000`), cualquier llamada posterior — incluida
   la del reaper/reconciliación — lo ve abierto hasta que pase el
   cooldown. Relevante si se agregan más escenarios de demo.
5. **Test flaky pre-existente, no relacionado a SPEC 07:**
   `job-runner.integration.spec.ts`'s test "realistic: order.confirmed
   for a non-existent orderId..." falla intermitentemente cuando corre
   dentro de la suite de integración completa (nunca aislado). Confirmado
   que falla igual en baseline sin cambios de este spec — no bloquea.
6. **Env vars necesarias para correr scripts/tests locales:**
   `DATABASE_URL`, `PAYMENTS_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
   `GEOCODING_DRIVER=static`, `PGBOSS_POLL_INTERVAL_SECONDS=15`,
   `RESERVATION_TTL_MINUTES=15`, `GEOAPIFY_API_KEY=""` — `validateEnv()`
   exige las primeras tres aunque el script solo use `DATABASE_URL`.

## Regla de trabajo con el usuario (importante)

Después de implementar cada step: mostrar resumen + diff, **esperar
confirmación explícita** del usuario antes de comitear. No asumir que
"sigue con el próximo step" implica luz verde para comitear el actual
sin que lo haya dicho explícitamente.
