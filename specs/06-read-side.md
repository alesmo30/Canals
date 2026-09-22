# SPEC 06 — P5 Read Side: `GET /orders` y `GET /orders/:id`

> **Status:** Implemented
> **Depends on:** SPEC 01 (dominio, esquema, `idx_orders_keyset` — P0)
> **Date:** 2026-09-21
> **Objective:** Dar al reviewer un camino de lectura para verificar el camino
> de escritura de SPEC 05 (`POST /orders`) sin abrir `psql`: el detalle completo
> de una orden y un listado paginado, ambos de solo lectura, sin tocar ningún
> archivo de P4.

## Scope

**In:**

- `GET /orders/:id` — representación completa: orden, líneas con snapshot,
  intentos de pago, warehouse asignado (id **y nombre**), distancia calculada
  desde la dirección de envío hasta ese warehouse, y el shipment si existe.
  Id desconocido o con forma no-UUID → `404`, mismo envelope RFC 9457 de
  SPEC 05 (`problem-details.filter.ts`, extendido de forma aditiva).
- `GET /orders` — paginación **keyset** (`created_at DESC, id DESC`, sobre
  `idx_orders_keyset`), nunca `OFFSET`. Cursor opaco (base64), `nextCursor` +
  `hasMore` en la respuesta. Tamaño de página 20 por defecto, máximo 100.
  Cada orden de la página trae sus líneas — sin incurrir en N+1.
- Filtros combinables: `customerId`, `status`, `warehouseId`, `createdAtFrom`,
  `createdAtTo`. Mismo whitelist estricto que P4: un query param desconocido
  → `400` (no se ignora).
- DTOs de proyección hechos a mano para ambos endpoints — nunca la entidad
  TypeORM ni un `raw_response`/dato de tarjeta reachable por accidente.
- Nuevo controlador `orders-read.controller.ts`, registrado junto a
  `OrdersController` (P4) en `api.module.ts` — mismo prefijo `orders`,
  archivo separado (phases/05, nota de colisión).

**Out of scope (para specs futuras):**

- Cualquier escritura (`POST`, `PATCH`, `DELETE`).
- Agregaciones, reportes, búsqueda de texto.
- Reaper y reconciliación de `PENDING_PAYMENT`/`UNKNOWN` (P6) — esta spec
  solo lee lo que ya existe, no interpreta ni corrige estados colgados.
- Creación masiva y `PATCH /orders` (P7).
- Cualquier cambio a `orders.controller.ts`, `create-order.use-case.ts`,
  `order-response.dto.ts` u otro archivo propio de SPEC 05 — se reutilizan
  sus tipos exportados (`OrderResponseWarehouse`, `OrderResponseItem`) por
  import, sin modificarlos.

## Data model

Ninguna migración nueva. `idx_orders_keyset`, `idx_orders_reaper`,
`(customer_id, created_at)` y el índice simple sobre `warehouse_id` ya existen
desde SPEC 01 (`data-model.dbml`, tabla `orders`). Esta sección solo lista
código nuevo.

### Repositorio de lectura (`src/infrastructure/database/repositories/orders-read.repository.ts`)

Raw SQL parametrizado vía `dataSource.query()` (convención de
`references/coding-conventions.md`: query builder fuera para todo lo
performance/proyección-crítico). A diferencia de `select-warehouse.sql`, el
`WHERE` de `findPage` varía según qué filtros llegaron — no es un único
statement estático, así que se arma como un arreglo de fragmentos
parametrizados en TypeScript, no un `.sql` cargado de archivo (ver
Decisions).

```ts
export interface OrderRow {
  id: string;
  order_number: string;
  customer_id: string;
  warehouse_id: string | null;
  status: OrderStatus;
  currency: string;
  total_cents: string; // bigint vuelve como string del driver
  created_at: Date;
}

export interface OrdersPageFilters {
  customerId?: string;
  status?: OrderStatus;
  warehouseId?: string;
  createdAtFrom?: Date;
  createdAtTo?: Date;
  cursor?: { createdAt: Date; id: string };
  pageSize: number; // ya validado 1-100 en el DTO
}

export interface OrderDetailRow extends OrderRow {
  shipping_address: Record<string, unknown>;
  warehouse_name: string | null;
  distance_meters: number | null;
}

@Injectable()
export class OrdersReadRepository {
  // SELECT ... WHERE (filtros combinables) AND (created_at, id) < ($cursor)
  // ORDER BY created_at DESC, id DESC LIMIT (pageSize + 1) — el +1 es el
  // lookahead para computar hasMore sin una segunda query de count().
  async findPage(filters: OrdersPageFilters): Promise<OrderRow[]>

  // WHERE order_id = ANY($1) — una sola query para toda la página,
  // agrupada por order_id en el service (R5.4).
  async findItemsByOrderIds(orderIds: string[]): Promise<OrderItemRow[]>

  // LEFT JOIN warehouses + ST_Distance(w.location, o.shipping_location).
  // LEFT JOIN, no INNER: warehouse_id es nullable en el esquema (aunque en
  // la práctica P4 siempre lo llena antes de insertar la orden — ver Risks).
  async findOrderById(id: string): Promise<OrderDetailRow | null>

  async findPaymentsByOrderId(orderId: string): Promise<PaymentAttemptRow[]>

  async findShipmentByOrderId(orderId: string): Promise<ShipmentRow | null>
}
```

### Cursor (`src/application/orders/helpers/cursor.helpers.ts`)

Puramente mecánico (codificar/decodificar una tupla, sin decisión de
negocio) — vive en `helpers/`, no como método de servicio
(`references/coding-conventions.md`).

```ts
// base64(`${createdAt.toISOString()}|${id}`) — no JSON: son solo dos
// campos y el cliente nunca debe parsear la estructura, solo reenviarla.
export function encodeCursor(params: { createdAt: Date; id: string }): string
export function decodeCursor(cursor: string): { createdAt: Date; id: string }
// decodeCursor lanza InvalidCursorError si el base64 no trae exactamente
// dos partes separadas por "|" o la fecha no parsea — mapeado a 400 en el
// filtro (mismo bucket que un query param inválido, no un caso nuevo).
```

### DTOs de query (`src/infrastructure/http/dto/list-orders-query.dto.ts`)

```ts
export class ListOrdersQueryDto {
  @IsOptional() @IsUUID('loose') customerId?: string;
  @IsOptional() @IsIn(ORDER_STATUS_VALUES) status?: OrderStatus;
  @IsOptional() @IsUUID('loose') warehouseId?: string;
  @IsOptional() @IsISO8601() createdAtFrom?: string;
  @IsOptional() @IsISO8601() createdAtTo?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
```

`ORDER_STATUS_VALUES` se reutiliza del array ya exportado por
`order.orm-entity.ts` — no se duplica el enum.

### DTOs de respuesta

```ts
// order-list.response.dto.ts
export interface OrderListItem {
  id: string;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  warehouseId: string | null;
  totalCents: number;
  currency: string;
  createdAt: string; // ISO
  items: OrderResponseItem[]; // reutilizado de order-response.dto.ts (P4), sin tocarlo
}

export interface OrderListResponse {
  items: OrderListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

// order-detail.response.dto.ts
export interface OrderDetailPaymentAttempt {
  attempt: number;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  failureCode: string | null;
  settledAt: string | null; // ISO | null
  createdAt: string; // ISO
}

export interface OrderDetailShipment {
  status: ShipmentStatus;
  carrier: string | null;
  trackingNumber: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
}

export interface OrderDetailResponse {
  id: string;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  warehouse: OrderResponseWarehouse | null; // { id, name, distanceMeters } — reutilizado de P4
  items: OrderResponseItem[];
  payments: OrderDetailPaymentAttempt[];
  shipment: OrderDetailShipment | null;
  totalCents: number;
  currency: string;
  createdAt: string;
}
```

Nótese lo que **no** aparece: `payments.raw_response`, `card_last4`,
`card_brand`, `provider_payment_id`, `idempotency_key` — ver Decisions.

### Error nuevo (`src/application/orders/order-read.errors.ts`)

```ts
export class OrderNotFoundError extends Error {
  constructor(public readonly orderId: string) { ... }
}
```

`problem-details.filter.ts` (P4, archivo compartido) gana una rama aditiva:
`OrderNotFoundError` → mismo bucket que `CustomerNotFoundError`/
`ProductNotFoundError` (`404`, `urn:problem-type:not-found`) — se reutiliza
el `type`/`title` ya existente, no se inventa un segundo envelope
(R5.1 lo pide explícitamente).

## Implementation plan

Cada paso termina con `npm run lint` y `npm run build` en verde; desde el
paso 1, también `npm run test:unit`.

1. **`cursor.helpers.ts`.** `encodeCursor`/`decodeCursor` + `InvalidCursorError`.
   *Verify:* unit tests — round-trip `encodeCursor(x)` → `decodeCursor` da
   `x` de vuelta; un string que no es base64 válido o no trae exactamente
   un `"|"` lanza `InvalidCursorError`.

2. **`OrderNotFoundError` + mapeo en `problem-details.filter.ts`.**
   *Verify:* unit test — la excepción mapea a `404`,
   `urn:problem-type:not-found`, mismo shape que `CustomerNotFoundError`.

3. **`ListOrdersQueryDto`.** Filtros + paginación con `class-validator`.
   *Verify:* unit tests — payload vacío pasa (todo opcional); `pageSize=0`,
   `pageSize=101`, `status` fuera del enum, `createdAtFrom` no-ISO8601 y una
   propiedad desconocida fallan cada uno con su mensaje.

4. **`OrdersReadRepository.findPage` + `findItemsByOrderIds`.**
   *Verify:* integration test contra Postgres real (`references/testing.md`:
   fixtures propias con `randomUUID()`, sin `seed.ts`) — sembrar 50 órdenes
   con `created_at` espaciados, paginar de a 20 y confirmar 0 duplicados/0
   huecos sobre las 50; `findItemsByOrderIds([])` no explota.

5. **`ListOrdersService`** (`src/application/orders/list-orders.service.ts`).
   Orquesta las dos queries del paso 4, agrupa items por `order_id`, decide
   `hasMore` (¿la página trajo `pageSize + 1` filas?) y arma `nextCursor`
   desde la última fila **retenida** (no la de lookahead).
   *Verify:* unit test con un repositorio fake — página de 3 con
   `pageSize=2` da 2 items, `hasMore=true`, `nextCursor` apunta a la 2ª fila.

6. **`order-list.response.dto.ts`.** `toOrderListItem`/`toOrderListResponse`
   — mapeo explícito campo a campo, reutilizando `OrderResponseItem` de P4.
   *Verify:* unit test — un `OrderRow` + sus `OrderItemRow[]` producen el
   shape esperado; ningún campo fuera de la interfaz sobrevive un
   `JSON.stringify` del resultado (guardia contra un spread accidental de
   la entidad).

7. **`OrdersReadRepository.findOrderById` + `findPaymentsByOrderId` +
   `findShipmentByOrderId`.**
   *Verify:* integration test — orden sembrada con 2 intentos de pago y un
   shipment: las tres queries devuelven las filas correctas; id inexistente
   → `findOrderById` retorna `null` (no lanza).

8. **`GetOrderService`** (`src/application/orders/get-order.service.ts`).
   Valida forma UUID de `id` (regex, sin ir a la base para un id con forma
   inválida — ver Decisions), llama a las tres queries del paso 7 en
   paralelo (`Promise.all`, son independientes) y lanza `OrderNotFoundError`
   si `findOrderById` da `null`.
   *Verify:* integration test — id con forma inválida y id bien formado
   pero inexistente lanzan ambos `OrderNotFoundError`; id real devuelve los
   tres conjuntos ensamblados.

9. **`order-detail.response.dto.ts`.** `toOrderDetailResponse` — proyección
   explícita, `warehouse: null` si `warehouse_id`/`warehouse_name` vinieron
   null, `shipment: null` si no hay fila.
   *Verify:* unit test — confirma que `card_last4`/`card_brand`/
   `raw_response`/`provider_payment_id`/`idempotency_key` no existen en
   ninguna clave del objeto resultante, ni anidada.

10. **`orders-read.controller.ts` + registro en `api.module.ts`.**
    `GET /orders/:id`, `GET /orders` con
    `@Query(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))`
    (ver Decisions — no se toca el `ValidationPipe` global de `main.ts`).
    *Verify:* `curl localhost:3000/orders` y
    `curl localhost:3000/orders/<id-sembrado>` contra `npm run seed`
    devuelven `200` con el shape esperado; `curl localhost:3000/orders/no-existe`
    → `404`; `curl 'localhost:3000/orders?bogus=1'` → `400`.

11. **Cobertura de aceptación end-to-end.** Suite de integración/e2e para
    las 8 AC de abajo: paginación completa de 50 órdenes sin duplicados ni
    huecos, inserción concurrente a mitad de paginación, `EXPLAIN` sobre la
    query del paso 4 (caso sin filtros), conteo de queries por página
    (loguear/contar vía un spy sobre `dataSource.query` en el test, no en
    producción), cada filtro solo y combinado, `grep` sobre las respuestas
    de la suite completa confirmando ausencia de cualquier dato de tarjeta
    o `raw_response`, y un query param desconocido → `400`.
    *Verify:* `npm run verify` completo en verde.

## Acceptance criteria

- [x] Paginar las 50 órdenes sembradas llega a cada una exactamente una vez, sin duplicados ni huecos.
- [x] Insertar una orden nueva **a mitad de paginación** no desplaza ni duplica resultados en páginas siguientes.
- [x] Ningún `OFFSET` aparece en ninguna query.
- [x] `EXPLAIN` sobre la query de listado (caso base, sin filtros) muestra `idx_orders_keyset` en uso.
- [x] Cada filtro funciona solo y en combinación con los demás.
- [x] Una página de 20 órdenes con sus items emite un número acotado de queries, no 21.
- [x] Ningún dato de tarjeta ni el payload crudo del gateway es alcanzable desde ninguna respuesta.
- [x] Un query param desconocido devuelve `400`.

## Decisions

- **Sí:** el `WHERE` de `findPage` se arma como un arreglo de fragmentos SQL
  parametrizados en TypeScript, no como un `.sql` estático (a diferencia de
  `select-warehouse.sql`). Los filtros de R5.3 son opcionales y combinables
  — un statement fijo no puede expresar "cualquier subconjunto de 5
  filtros" sin una explosión combinatoria de archivos.
- **No:** un `.sql` por combinación de filtros posible. Inmantenible y no
  aporta nada que el arreglo de fragmentos no dé ya (sigue siendo SQL
  parametrizado, sin query builder).
- **Sí:** página de items resuelta en 2 queries — `findPage` (una) +
  `findItemsByOrderIds` (una, `WHERE order_id = ANY($1)`) — agrupadas en el
  service. Cumple R5.4 con un número de queries fijo, independiente del
  tamaño de página.
- **No:** un solo `SELECT` con `json_agg` de items por orden. El `LIMIT
  pageSize + 1` que decide `hasMore` (paso 5) necesita filas de *orden*, no
  de *línea*; un join con fan-out de items rompe ese conteo salvo que se
  agregue antes de paginar, lo que complica el plan de la query de
  ordenamiento — justo lo que el AC de `EXPLAIN` (#4) pide mantener simple.
- **Sí:** cursor = `base64("${createdAt.toISOString()}|${id}")`. Opaco para
  el cliente (FR-7), suficiente con dos campos — no hace falta JSON.
- **No:** cursor JSON o firmado/cifrado. No es un límite de seguridad
  (nada sensible viaja en el cursor, solo un timestamp y un id que el
  cliente ya vio en la página anterior), solo opacidad de forma.
- **Sí:** la condición de página siguiente es una comparación de tupla real
  de Postgres: `(created_at, id) < ($cursorCreatedAt, $cursorId)`, no dos
  condiciones `OR` escritas a mano. Postgres evalúa la comparación de fila
  directamente y es lo que hace que el empate de `created_at` (dos órdenes
  con el mismo timestamp) se resuelva correctamente por `id` sin lógica
  extra.
- **Sí:** el intento de pago proyectado en `OrderDetailResponse` expone
  `{attempt, status, amountCents, currency, failureCode, settledAt,
  createdAt}` — deja fuera `card_last4`, `card_brand`,
  `provider_payment_id` e `idempotency_key`, además de `raw_response`. R5.5
  separa explícitamente "`raw_response`" de "cualquier dato de tarjeta"
  como dos cosas a proteger; ninguna de FR-7/R5.1 pide mostrar marca o
  últimos 4 dígitos en el read side, y una proyección hecha a mano (no un
  spread de la entidad) es justamente el mecanismo que R5.5 pide para que
  sea "imposible" filtrar algo por accidente. Si un reviewer necesita ver
  la marca/últimos 4 más adelante, es una línea de otra spec, no una
  inferencia de esta.
- **No:** incluir `card_last4`/`card_brand` "porque ya son seguros" (NFR-6
  los permite en general). Permitido en general no es lo mismo que pedido
  aquí — la superficie más chica es la que R5.5 describe.
- **Sí:** un `:id` con forma no-UUID en `GET /orders/:id` se trata igual que
  un id bien formado pero inexistente → `404` (`OrderNotFoundError`), sin
  llegar a la base ni agregar una rama de validación nueva al filtro. Desde
  el cliente, un id inventado y un id malformado son indistinguibles en la
  práctica, y esto evita sumar un segundo tipo de error 400 a un filtro que
  SPEC 05 ya cerró con su propia tabla de 7 filas.
- **No:** un `ParseUUIDPipe`/DTO de path param que devuelva `400` para un
  `:id` malformado. Es una distinción sin valor real para el cliente y
  ensancha el contrato de error sin que R5.1 lo pida.
- **Sí:** `GET /orders` valida su query con un `ValidationPipe` **local**
  (`whitelist: true, forbidNonWhitelisted: true, transform: true`) pasado
  directo al decorador `@Query(...)`, en vez de tocar el `ValidationPipe`
  global de `main.ts`. El global (P0, `whitelist`/`forbidNonWhitelisted`
  sin `transform`) ya es lo que usa `POST /orders` (SPEC 05, verificado en
  verde); `transform: true` es necesario aquí para que `pageSize` llegue
  como `number` y no como `string`, pero agregarlo al pipe global
  arriesgaría cambiar cómo `CreateOrderDto` coacciona sus propios campos
  sin que ningún AC de esta spec lo cubra.
- **No:** agregar `transform: true` al `ValidationPipe` global. Toca una
  spec ya cerrada y verificada por un beneficio que un pipe local da igual
  de bien, sin el riesgo.
- **Sí:** `findOrderById` usa `LEFT JOIN warehouses` (no `INNER JOIN`),
  devolviendo `warehouse: null` en la respuesta si `warehouse_id` es nulo.
  El esquema permite `warehouse_id` nulo (`data-model.dbml`: "Null only
  while allocation is in flight"), y aunque en la práctica SPEC 05 solo
  inserta la fila `orders` después de que la asignación ya tuvo éxito, este
  endpoint no debe asumir esa invariante de otra spec — debe seguir
  devolviendo algo coherente si esa invariante cambiara.
- **No:** `INNER JOIN` (fallaría en devolver la orden entera si algún día
  existe una orden sin warehouse — un 404 falso para una orden real).
- **Sí:** `GetOrderService` dispara sus tres queries (orden+warehouse,
  pagos, shipment) con `Promise.all` — son independientes entre sí, no hay
  razón para serializarlas.
- **No:** tres `await` secuenciales. Sería latencia sin motivo.

## Risks

| Riesgo | Mitigación |
|---|---|
| `idx_orders_keyset` está declarado `(created_at, id)` en la migración, sin `DESC` explícito. `ORDER BY created_at DESC, id DESC` necesita que Postgres recorra el índice **hacia atrás** (`Index Scan Backward`), no hacia adelante — un btree de dos columnas ascendentes sí soporta esto de forma nativa, pero no está confirmado contra un `EXPLAIN` real hasta el paso 11. | El paso 11 corre `EXPLAIN` contra Postgres real y el AC #4 lo exige explícitamente antes de dar la spec por cumplida. Si el plan no usa el índice, la mitigación es revisar `ANALYZE`/estadísticas antes de considerar un índice `DESC` explícito nuevo (fuera del alcance de "ninguna migración nueva" de esta spec, pero documentado aquí como la siguiente pregunta si el riesgo se materializa). |
| Un `EXPLAIN` con el filtro `customerId` puede legítimamente elegir el índice `(customer_id, created_at)` en vez de `idx_orders_keyset` — es la elección correcta del planner para ese filtro, no una regresión. El AC #4 solo se verifica contra el caso base (sin filtros); no se interpreta como una garantía de que *todo* filtro use *ese* índice específico. | Documentado aquí para que quien lea el AC #4 no lo tome como "el índice keyset se usa siempre pase lo que pase" — el paso 11 corre el `EXPLAIN` del caso base únicamente. |
| `findItemsByOrderIds` con una página vacía (`orderIds = []`) — `WHERE order_id = ANY($1::uuid[])` con un arreglo vacío es SQL válido en Postgres (devuelve cero filas), pero conviene confirmarlo explícitamente en test en vez de asumirlo. | Cubierto en el paso 4's *Verify* — caso de arreglo vacío ejercitado a propósito. |
| El conteo de queries del AC "no 21" no tiene una forma nativa de medirse en producción sin instrumentación nueva (fuera de alcance). Un spy de test sobre `dataSource.query` es la única medición, y podría no capturar una query emitida por un camino distinto (p. ej. si TypeORM's `QueryRunner` interno hiciera una llamada adicional no visible a través de `dataSource.query`). | Aceptado para esta spec — mismo nivel de rigor que R5.4 pide ("loguear el conteo... y registrarlo en las notas de fase"), no una garantía instrumentada en runtime. Si aparece una discrepancia, se documenta en las notas de implementación del paso 11, no se bloquea la spec por ella. |

## What is **not** in this spec

- Cualquier escritura sobre `orders`/`order_items`/`payments`/`shipments`.
- Reaper y reconciliación (P6) — el read side muestra lo que hay, no decide
  si una orden `PENDING_PAYMENT` vieja debería liberarse.
- Creación masiva y `PATCH /orders` (P7).
- Agregaciones, reportes o búsqueda de texto sobre órdenes.
- Cualquier cambio a `orders.controller.ts`, `create-order.use-case.ts` o
  `order-response.dto.ts` (SPEC 05) más allá de importar sus tipos ya
  exportados.

Cada uno de estos, si aterriza, va en su propia spec.
