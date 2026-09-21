# SPEC 05 — P4 Order Creation Saga: `POST /orders`, idempotencia y la transacción de tres fases

> **Status:** Approved
> **Depends on:** SPEC 01 (dominio, puertos, esquema — P0), SPEC 02 (`AllocateInventoryUseCase`, `InventoryService` — P1), SPEC 03 (`PaymentGateway`, `GeocodingProvider` — P2), SPEC 04 (`EventPublisher`/outbox transaccional, `correlationId` — P3)
> **Date:** 2026-09-21
> **Objective:** Conectar P1 (selección de warehouse + reserva de stock), P2 (pago, geocoding) y P3 (outbox de eventos) en la saga de tres fases de `POST /orders`, con idempotencia a nivel de request y un único contrato de error RFC 9457.

## Scope

**In:**

- `POST /orders` — DTO con whitelist estricto (`ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`), forma exacta de FR-1 (`customerId`, `shippingAddress`, `items[]`, `payment.cardNumber`).
- Resolución de `customerId`/`productId` vía repositorios TypeORM directos (CRUD simple, sin clase repositorio nueva — convención de `references/coding-conventions.md`): cliente inexistente o producto inexistente/inactivo → `404`.
- `productId` duplicado dentro del mismo request → `400` (no se fusiona).
- Cabecera `Idempotency-Key` (UUID, requerida): insert en `idempotency_keys` bajo su constraint único **antes** de cualquier trabajo, fingerprint SHA-256 del body canonicalizado, semántica `409`/replay verbatim/`422` por body distinto, y verificación de `expires_at` (24 h) al hacer el lookup. La *limpieza* de claves vencidas es del reaper de P6 — fuera de este spec.
- Saga de tres fases:
  - **Fase 1 (reservar):** geocoding (P2) + `AllocateInventoryUseCase` (P1) vía `onBeforeReserve`, que inserta `orders` (`PENDING_PAYMENT`) **y** `order_items` con snapshots de precio, dentro de la misma transacción corta que `reserve`.
  - **Fase 2 (cobrar):** `charge-idempotency-key.ts` (función pura) construye `order:<orderId>:attempt:1`, se persiste en `payments.idempotency_key` antes de llamar `PaymentGateway.charge()`. Sin transacción abierta.
  - **Fase 3 (settle):** `Order.markPaid()/confirm()/markPaymentFailed()`, `InventoryService.commit()/release()`, `EventPublisher.publish('order.confirmed', tx)` — todo en la transacción corta final.
- `order_number` = secuencia Postgres por año (`CNL-<año>-<6 dígitos>`), nueva migración (documentada como adición explícita — `phases/04` no la anticipaba).
- Extensión aditiva de `AllocationResult` en `allocate-inventory.use-case.ts` (P1) para devolver `name` y `distanceMeters` del warehouse ganador.
- `total_cents` calculado por aritmética entera sobre los snapshots de línea. Sin impuestos ni envío.
- Envelope de error RFC 9457 (`problem-details.filter.ts`) cubriendo las 7 filas de R4.5, con `correlationId` leído de `AsyncLocalStorage` (no generado de nuevo).
- Respuesta `201` con orden completa: `warehouseId` + nombre + distancia, líneas con snapshot, total, estado de pago.
- Borrar `POST /internal/events/order-confirmed` y `ENABLE_DEV_ENDPOINTS` (P3, dev-only).
- `ApiModule`: importa `SharedModule` + controladores, **no** `WorkerModule`.
- Validación de `payment.cardNumber`: solo forma (string, solo dígitos, 13–19 caracteres) — el resultado real lo decide el mock por el valor exacto.

**Out of scope (para specs futuras):**

- Reaper y reconciliación de órdenes `PENDING_PAYMENT`/`UNKNOWN` (P6).
- Limpieza/borrado físico de `idempotency_keys` vencidas (P6).
- Creación masiva de órdenes y `PATCH /orders` (P7).
- `GET /orders`, `GET /orders/:id` (P5).
- Validación Luhn / de red de tarjeta.
- Segundo intento de cobro ("pay with another card") — `attempt` es siempre `1` hoy, per el handoff de SPEC 03.
- Impuestos y costo de envío en el total.

## Data model

La mayoría de tablas y contratos ya existen (frozen desde SPEC 01/02/03). Esta sección lista solo lo que **aparece o cambia** en este spec.

### Nueva migración — secuencia de `order_number`

```sql
-- src/infrastructure/database/migrations/<timestamp>-OrderNumberSequence.ts
CREATE SEQUENCE order_number_seq AS bigint START WITH 1;
```

Un único contador global (no uno por año — evita lógica de reset frágil). El
formato `CNL-<año>-<6 dígitos>` se arma en el momento de generarlo:
`'CNL-' || extract(year from now()) || '-' || lpad(nextval('order_number_seq')::text, 6, '0')`.
Se pide **una sola vez**, antes del loop de failover de `AllocateInventoryUseCase`
— igual que `orderId` (`randomUUID()` en `allocate-inventory.use-case.ts:52`),
así se mantiene estable entre reintentos. Vive en un helper mecánico:

```ts
// src/application/orders/helpers/order-number.helpers.ts
export async function generateOrderNumber(dataSource: DataSource): Promise<string>
```

### Extensión de `AllocationResult` (P1, aditiva)

```ts
// src/application/allocation/allocate-inventory.use-case.ts
export interface AllocationResult {
  orderId: string;
  warehouseId: string;
  name: string;           // nuevo
  distanceMeters: number; // nuevo
}
```

`execute()` los toma del `candidate` que ganó el intento — ya trae ambos campos
(`WarehouseCandidate`, `warehouse-selection.repository.ts:15-19`), no hace falta
volver a consultar.

### DTOs de request (`src/infrastructure/http/dto/`)

```ts
// create-order.dto.ts
class ShippingAddressDto {
  recipient: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: 'US'; // único mercado soportado — cualquier otro valor es 400
}

class OrderLineDto {
  productId: string; // uuid
  quantity: number;  // entero positivo
}

class PaymentDto {
  cardNumber: string; // solo dígitos, 13–19 caracteres
}

class CreateOrderDto {
  customerId: string; // uuid
  shippingAddress: ShippingAddressDto;
  items: OrderLineDto[]; // no vacío, sin productId repetido (validador custom)
  payment: PaymentDto;
}
```

### Comando interno y errores nuevos (`src/application/orders/`)

```ts
// create-order.types.ts
interface CreateOrderCommand {
  customerId: string;
  shippingAddress: ShippingAddressProps;
  lines: OrderLine[];       // reusa el tipo de allocation.types.ts
  cardNumber: string;
  idempotencyKey: string;
}
```

```ts
// create-order.errors.ts
class CustomerNotFoundError extends Error { constructor(customerId: string) }
class ProductNotFoundError extends Error { constructor(productIds: string[]) } // cubre inexistente E inactivo — mismo 404
```

### Idempotencia (`idempotency.*`)

Reutiliza `idempotency_keys` (SPEC 01, sin cambios de esquema). Solo lógica nueva:

```ts
// idempotency.types.ts
interface IdempotencyCheckResult {
  outcome: 'NEW' | 'REPLAY' | 'IN_PROGRESS' | 'CONFLICT';
  storedResponse?: { status: number; body: unknown };
}
```

`fingerprint = sha256(canonicalize(requestBody))` — JSON con claves ordenadas,
sin espacios. `scope` siempre `'POST /orders'` (ya es el `DEFAULT` de la columna).

### Charge idempotency key

```ts
// charge-idempotency-key.ts
function buildChargeIdempotencyKey(params: { orderId: string; attempt: number }): string
// → `order:${orderId}:attempt:${attempt}`
```

Función pura, sin dependencias de infraestructura (ya fijado por SPEC 03).

### Respuesta `201` y envelope de error

```ts
// order-response.dto.ts (shape, no necesariamente una clase class-validator)
interface OrderResponse {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  warehouse: { id: string; name: string; distanceMeters: number };
  items: Array<{ productId: string; sku: string; name: string; quantity: number; unitPriceCents: number }>;
  totalCents: number;
  currency: string;
  paymentStatus: PaymentStatus;
}
```

```ts
// problem-details.filter.ts — RFC 9457
interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;       // el path del request, p.ej. "/orders"
  correlationId: string;  // de AsyncLocalStorage, nunca generado de nuevo
  errors?: Array<{ field: string; message: string }>;
}
```

## Implementation plan

Cada paso termina con `npm run lint` y `npm run build` en verde. Desde el paso 4
en adelante, también `npm run test:unit` (y desde el 9, `docker compose up`
sigue funcionando).

1. **Secuencia de `order_number`.** Migración `<timestamp>-OrderNumberSequence.ts`
   con `CREATE SEQUENCE order_number_seq`.
   *Verify:* `npm run migration:run` aplica limpio; `npm run verify:db` sigue en verde.

2. **Extender `AllocationResult` (P1).** Añadir `name`/`distanceMeters` en
   `allocate-inventory.use-case.ts`, tomados del `candidate` ganador.
   *Verify:* la suite existente de `allocate-inventory.use-case.integration.spec.ts`
   sigue pasando sin tocarla; un test nuevo confirma que `execute()` devuelve
   ambos campos.

3. **Borrar el endpoint dev de P3.** Eliminar `dev-events.controller.ts` y
   `ENABLE_DEV_ENDPOINTS` de `env.schema.ts`/`.env.example`.
   *Verify:* `npm run build`; `curl -X POST localhost:3000/internal/events/order-confirmed`
   ya no existe (404 de Nest, no de lógica de negocio).

4. **Errores y helper de `order_number`.** `create-order.errors.ts`
   (`CustomerNotFoundError`, `ProductNotFoundError`) y
   `helpers/order-number.helpers.ts` (`generateOrderNumber`).
   *Verify:* unit test — `generateOrderNumber` contra una BD real produce
   `CNL-<año actual>-000001`, luego `...-000002` en la siguiente llamada.

5. **DTOs de request.** `create-order.dto.ts` con `class-validator`:
   `ShippingAddressDto`, `OrderLineDto`, `PaymentDto`, `CreateOrderDto` +
   validador custom de `productId` no repetido.
   *Verify:* unit tests — payload válido pasa; propiedad desconocida,
   `country` distinto de `US`, `quantity` ≤ 0 y `productId` duplicado fallan,
   cada uno con el mensaje esperado.

6. **`charge-idempotency-key.ts`.** Función pura `buildChargeIdempotencyKey`.
   *Verify:* unit test — `{orderId: 'x', attempt: 1}` → `order:x:attempt:1`.

7. **Idempotencia de request.** `idempotency.types.ts` + `idempotency.service.ts`
   (o `.repository.ts`): fingerprint SHA-256, insert `IN_PROGRESS` bajo el
   constraint único, lookup, marcar `COMPLETED` con `response_status`/`response_body`.
   *Verify:* integration test — segunda inserción con la misma `(scope, idempotency_key)`
   mientras la primera sigue `IN_PROGRESS` lanza la violación del constraint
   único (mapeada a `409` más adelante, en el paso 12). Lookup de una key con
   `expires_at` pasado se trata como inexistente.

8. **`problem-details.filter.ts`.** `ExceptionFilter` global RFC 9457, con la
   tabla de mapeo error → status de R4.5 (incluye `ValidationPipe`'s
   `BadRequestException` → 400 con `errors[]`).
   *Verify:* unit test por cada fila de la tabla de R4.5, aislado (se le pasa
   la excepción directamente, sin levantar Nest).

9. **`create-order.use-case.ts` — Fase 1 (reservar).** Resuelve cliente y
   productos, geocodifica, llama `AllocateInventoryUseCase` con un
   `onBeforeReserve` que inserta `orders` (`PENDING_PAYMENT`, `orderNumber`
   generado en el paso 4) y `order_items` con snapshots.
   *Verify:* integration test — tras ejecutar, existe una fila `orders` en
   `PENDING_PAYMENT` con sus `order_items`, y el `AllocationResult` trae
   `warehouseId`/`name`/`distanceMeters`.

10. **Fase 2 (cobrar).** Añade el cobro: persiste `payments` (`idempotency_key`
    del paso 6) antes de llamar `PaymentGateway.charge()`. Sin transacción abierta.
    *Verify:* integration test contra `payments-mock` (`docker compose up`) —
    tarjeta `...0002` devuelve `ChargeResult.status === 'DECLINED'`; se persiste
    la fila `payments` con ese estado.

11. **Fase 3 (settle) + respuesta.** Rama por resultado (tabla de R4.3):
    `markPaid()/confirm()` + `InventoryService.commit()` +
    `EventPublisher.publish()` en la misma transacción para `CAPTURED`;
    `markPaymentFailed()` + `InventoryService.release()` para `DECLINED`; nada
    para `UNKNOWN`. Construye `OrderResponse`.
    *Verify:* integration test — camino feliz deja la orden `CONFIRMED` y un
    job en la cola (`pg-boss` job table tiene 1 fila `order.confirmed`);
    `DECLINED` devuelve el stock a `quantity_available`.

12. **`orders.controller.ts` + `api.module.ts`.** `POST /orders`, `ValidationPipe`
    global estricto, filtro RFC 9457 global, mapeo de cada error tipado
    (`CustomerNotFoundError`, `ProductNotFoundError`,
    `NoFulfilmentPossibleError`, `GeocodingFailedError`, `UNKNOWN` de pago) a
    su status. `ApiModule` importa `SharedModule` y el controlador, no `WorkerModule`.
    *Verify:* `curl -X POST localhost:3000/orders` con los datos sembrados por
    `npm run seed` devuelve `201` con el warehouse más cercano.

13. **Cobertura de aceptación end-to-end.** Tests de integración para las 7
    filas de error de R4.5 vía `curl`/supertest, replay de `Idempotency-Key`
    (misma respuesta, sin segunda orden ni segundo cobro), y verificación de
    que ningún número de tarjeta aparece en logs/trazas (`grep` sobre la
    salida de `npm run events-check` / logs de Grafana).
    *Verify:* `npm run verify` completo en verde, incluyendo `payments-check`
    y `events-check`.

## Acceptance criteria

- [ ] Un pedido válido devuelve `201` y selecciona demostrablemente el warehouse calificado más cercano.
- [ ] La respuesta `201` incluye `warehouse.name` y `warehouse.distanceMeters`, no solo el id.
- [ ] Repetir el mismo `Idempotency-Key` con el mismo body devuelve el body idéntico almacenado, sin crear una segunda orden ni un segundo cobro.
- [ ] El mismo `Idempotency-Key` con un body **distinto** devuelve `422`.
- [ ] Falta la cabecera `Idempotency-Key` → `400`.
- [ ] Un `productId` repetido dentro de `items[]` del mismo request → `400`.
- [ ] Tarjeta `...0002` → `402`, la orden queda `PAYMENT_FAILED`, el stock vuelve a `quantity_available`.
- [ ] Tarjeta `...0004` → `502`, la orden queda `PENDING_PAYMENT`, la reserva sigue intacta.
- [ ] `docker stop payments-mock` → `502`, reserva intacta, el circuit breaker se abre.
- [ ] Un pedido insatisfacible (`NoFulfilmentPossibleError`) devuelve `422` nombrando los `productId` no cubiertos, y no persiste **nada** (ni `orders` ni `order_items` — sí queda la fila `idempotency_keys` marcada `COMPLETED`, que no cuenta como "orden").
- [ ] Cada una de las 7 filas de error de R4.5 es reproducible por `curl` con los datos sembrados por `npm run seed`.
- [ ] Un pedido exitoso produce exactamente un `shipment`, de forma asíncrona, visible en ~1 s.
- [ ] Ningún número de tarjeta aparece en ninguna respuesta, log o traza.
- [ ] Grafana muestra una traza continua: request → geocode → selección → reserva → cobro → settle → jobs.
- [ ] `order_number` sigue el formato `CNL-<año>-<6 dígitos>` y es único (constraint de BD, no solo aplicación).
- [ ] `POST /internal/events/order-confirmed` y `ENABLE_DEV_ENDPOINTS` ya no existen en el código.

## Decisions

- **Sí:** secuencia Postgres global para `order_number` (`CNL-<año>-<6 dígitos>`), sin reset por año. Coincide con el ejemplo ya documentado en `order.ts` y es segura ante concurrencia sin locking de aplicación.
- **No:** `order_number` aleatorio o derivado del `orderId`. Pierde legibilidad y orden secuencial sin ganar nada frente a una secuencia de BD, que ya resuelve la concurrencia.
- **Sí:** extender `AllocationResult` de P1 con `name`/`distanceMeters` (cambio aditivo, cross-fase, documentado aquí). Evita una segunda consulta a `findCandidates` y usa el mismo candidato que ganó el intento — sin riesgo de discrepancia.
- **No:** volver a consultar `findCandidates` desde P4 tras el éxito. Riesgo de carrera: nada garantiza que el segundo resultado coincida con el candidato real que ganó.
- **Sí:** `productId` repetido en el mismo request se rechaza con `400`. Mantiene el DTO simple (whitelist estricto de R4.1) y falla ruidoso en vez de inventar semántica de merge no pedida.
- **No:** fusionar cantidades de líneas duplicadas. Añade lógica de normalización sin que la spec original defina cómo debería comportarse.
- **Sí:** validación de `payment.cardNumber` solo de forma (dígitos, 13–19 caracteres). El mock decide el resultado por el valor exacto (`...0002`, `...0004`); Luhn real rompería los criterios de aceptación con esas tarjetas.
- **No:** checksum Luhn completo en el DTO.
- **Sí:** la secuencia real de Fase 1 es `insertar orders → reserve → insertar order_items` (dentro de `onBeforeReserve`), corrigiendo el orden literal de R4.3 ("reserve stock → insert orders"). Así lo implementa P1 — `inventory_movements.order_id` tiene FK a `orders`, no hay otra secuencia que compile contra el contrato congelado.
- **Sí:** `customerId`/`productId` se resuelven con repositorios TypeORM directos (CRUD simple), sin clase repositorio nueva. Coincide con la convención ya fijada (`references/coding-conventions.md`: "TypeORM entities exist for straightforward CRUD").
- **Sí:** `order_number` se genera una sola vez, antes del loop de failover de `AllocateInventoryUseCase` — igual que `orderId`. Debe mantenerse estable si el primer candidato falla y se reintenta con el segundo.
- **Sí:** `idempotency_keys` se marca `COMPLETED` (con `response_status`/`response_body`) para **cualquier** desenlace final del request, incluido un `502` por pago `UNKNOWN`. El enum `idempotency_state` solo tiene `IN_PROGRESS`/`COMPLETED` — no existe un tercer estado "fallido pero reintentable" — y el handoff de SPEC 03 ya asume que repetir la misma key debe replayar ese `502`, no reabrir el cobro.
- **No:** limpieza/borrado de `idempotency_keys` vencidas en este spec. Es trabajo del reaper de P6; aquí solo se verifica `expires_at` en el lookup.
- **No:** soporte de países distintos a `US` en `shippingAddress`. FR-1 fija `country: "US"` — el geocoding y el cálculo de distancia asumen ese único mercado; ampliarlo es decisión de otro spec.

## Risks

| Riesgo | Mitigación |
|---|---|
| El insert en `idempotency_keys` debe **comprometerse por su cuenta**, antes de abrir la transacción de Fase 1 — si va dentro de la misma transacción que la reserva, dos requests duplicados concurrentes pasarían geocoding/selección igual y el conflicto solo se vería al final, demasiado tarde. | El insert de `idempotency_keys` es su propia sentencia autocommit (o su propia transacción corta), que debe completarse **antes** de llamar a `AllocateInventoryUseCase`. Cubierto por el test de concurrencia del paso 7 del plan. |
| El cambio aditivo a `AllocationResult` (P1, archivo congelado) podría romper algo que otra sesión esté tocando en paralelo si P1 no estuviera ya cerrado. | P1 ya está mergeado (`08aca9f`, `feat(p1)...`), así que el riesgo de colisión en vivo es bajo — pero el paso 2 del plan corre la suite de integración existente de `allocate-inventory.use-case` **sin modificarla**, como guardia. |
| Que el geocoding (llamada HTTP externa) termine ejecutándose dentro de la transacción corta de Fase 1 por error de orden en `create-order.use-case.ts` — igual de grave en espíritu que la "hard rule" de R4.3 sobre el pago, pero no hay ningún chequeo automático (como sí lo hay implícitamente para el pago) que lo detecte. | El plan (paso 9) exige que `geocode()` se resuelva **antes** de llamar a `AllocateInventoryUseCase.execute()` — nunca dentro de `onBeforeReserve`. Un test de integración puede instrumentar el mock de geocoding para fallar si se le invoca con una transacción abierta. |
| El circuit breaker de `HttpPaymentGateway` (P2) tiene estado global por proceso — un test que fuerza `docker stop payments-mock` (AC de la fila `CIRCUIT_OPEN`) puede dejarlo abierto y contaminar otros tests de la misma suite. | Ejecutar ese escenario en su propio archivo de test de integración, separado del resto, o resetear el breaker explícitamente entre tests (ya es una preocupación heredada de P2, no nueva de P4). |
| Los `errors[]` de un `CreateOrderDto` con `shippingAddress` anidado pueden llegar como errores de `class-validator` anidados, no como una lista plana `{ field, message }`. | `problem-details.filter.ts` aplana el árbol de `ValidationError` a rutas con notación de punto (p. ej. `shippingAddress.postalCode`) antes de construir el `errors[]` del envelope. |

## What is **not** in this spec

- Reaper y reconciliación de órdenes `PENDING_PAYMENT`/`UNKNOWN` (P6).
- Limpieza/borrado físico de `idempotency_keys` vencidas (P6).
- Creación masiva de órdenes y `PATCH /orders` (P7).
- `GET /orders`, `GET /orders/:id` (P5).
- Validación Luhn / de red de tarjeta, y cualquier país distinto a `US`.

Cada uno de estos, si aterriza, va en su propio spec.
