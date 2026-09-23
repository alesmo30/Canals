import { Link as RouterLink } from 'react-router';
import WarehouseOutlinedIcon from '@mui/icons-material/WarehouseOutlined';
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import {
  Alert,
  AlertTitle,
  Box,
  Divider,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

import type {
  OrderDetailResponse,
  OrderItem,
  OrderListItem,
  OrderResponse,
  ProblemDetails,
} from '../api/types';
import { WAREHOUSES } from '../api/catalog';
import { formatCents, formatDateTime } from '../lib/format';
import { fonts } from '../theme';
import { OrderStatusChip, StateChip } from './chips';

function Label({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.5 }}>
      {children}
    </Typography>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <Box component="span" sx={{ fontFamily: fonts.mono, fontSize: 13 }}>
      {children}
    </Box>
  );
}

function ItemsTable({ items, currency }: { items: OrderItem[]; currency: string }) {
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Product</TableCell>
          <TableCell align="right">Qty</TableCell>
          <TableCell align="right">Unit price</TableCell>
          <TableCell align="right">Subtotal</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.productId}>
            <TableCell>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {item.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                <Mono>{item.sku}</Mono>
              </Typography>
            </TableCell>
            <TableCell align="right">{item.quantity}</TableCell>
            <TableCell align="right">
              {formatCents(item.unitPriceCents, currency)}
            </TableCell>
            <TableCell align="right">
              {formatCents(item.unitPriceCents * item.quantity, currency)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type AnyOrder = OrderResponse | OrderDetailResponse;

function isDetail(order: AnyOrder): order is OrderDetailResponse {
  return 'payments' in order;
}

export function OrderCard({ order }: { order: AnyOrder }) {
  const warehouse = order.warehouse;
  return (
    <Stack spacing={2.5}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flexGrow: 1 }}>
          <Label>Order</Label>
          <Typography variant="h5" component="p">
            {order.orderNumber}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            <Mono>{order.id}</Mono>
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <OrderStatusChip status={order.status} />
          <Typography variant="h5" component="p" sx={{ mt: 1, fontFamily: fonts.sans, fontWeight: 700 }}>
            {formatCents(order.totalCents, order.currency)}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        <Box sx={{ p: 1.5, borderRadius: 2, backgroundColor: 'surface.subtle' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <WarehouseOutlinedIcon fontSize="small" color="primary" />
            <Label>Fulfilled from</Label>
          </Stack>
          {warehouse ? (
            <>
              <Typography sx={{ fontWeight: 700 }}>{warehouse.name}</Typography>
              {warehouse.distance && (
                <Typography variant="body2" color="text.secondary">
                  {warehouse.distance.kilometers.toLocaleString()} km ·{' '}
                  {warehouse.distance.miles.toLocaleString()} mi from the address
                </Typography>
              )}
            </>
          ) : (
            <Typography color="text.secondary">No warehouse assigned</Typography>
          )}
        </Box>
        <Box sx={{ p: 1.5, borderRadius: 2, backgroundColor: 'surface.subtle' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <CreditCardIcon fontSize="small" color="primary" />
            <Label>Payment</Label>
          </Stack>
          {'paymentStatus' in order ? (
            <StateChip label={order.paymentStatus} />
          ) : isDetail(order) && order.payments.length > 0 ? (
            <Stack spacing={0.5} sx={{ mt: 0.5 }}>
              {order.payments.map((payment) => (
                <Stack key={payment.attempt} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2">#{payment.attempt}</Typography>
                  <StateChip label={payment.status} />
                  {payment.failureCode && (
                    <Typography variant="caption" color="error">
                      <Mono>{payment.failureCode}</Mono>
                    </Typography>
                  )}
                </Stack>
              ))}
            </Stack>
          ) : (
            <Typography color="text.secondary">No payment attempts</Typography>
          )}
        </Box>
      </Box>

      <ItemsTable items={order.items} currency={order.currency} />

      {isDetail(order) && (
        <Box sx={{ p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
            <LocalShippingOutlinedIcon fontSize="small" color="primary" />
            <Label>Shipment</Label>
          </Stack>
          {order.shipment ? (
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <StateChip label={order.shipment.status} />
              <Typography variant="body2">
                {order.shipment.carrier ?? 'Carrier pending'}
              </Typography>
              {order.shipment.trackingNumber && (
                <Mono>{order.shipment.trackingNumber}</Mono>
              )}
              <Typography variant="caption" color="text.secondary">
                Dispatched {formatDateTime(order.shipment.dispatchedAt)}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No shipment yet — created by the worker's shipment.create job once the order is CONFIRMED.
            </Typography>
          )}
        </Box>
      )}
    </Stack>
  );
}

const warehouseName = (id: string | null) =>
  WAREHOUSES.find((warehouse) => warehouse.id === id)?.name ?? (id ? id.slice(0, 8) : '—');

export function OrdersTable({ orders }: { orders: OrderListItem[] }) {
  if (orders.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
        No orders match these filters.
      </Typography>
    );
  }
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Order</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Warehouse</TableCell>
            <TableCell align="right">Items</TableCell>
            <TableCell align="right">Total</TableCell>
            <TableCell>Created</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.id} hover>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {order.orderNumber}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  <Mono>{order.id}</Mono>
                </Typography>
              </TableCell>
              <TableCell>
                <OrderStatusChip status={order.status} />
              </TableCell>
              <TableCell>{warehouseName(order.warehouseId)}</TableCell>
              <TableCell align="right">
                {order.items.reduce((sum, item) => sum + item.quantity, 0)}
              </TableCell>
              <TableCell align="right">
                {formatCents(order.totalCents, order.currency)}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {formatDateTime(order.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

export function ProblemCard({ problem }: { problem: ProblemDetails }) {
  const severity = problem.status === 502 || problem.status === 409 ? 'warning' : 'error';
  return (
    <Stack spacing={2}>
      <Alert severity={severity} variant="outlined">
        <AlertTitle sx={{ fontWeight: 700 }}>
          {problem.status} · {problem.title}
        </AlertTitle>
        {problem.detail}
      </Alert>
      <Box sx={{ display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 1, columnGap: 2 }}>
        <Label>Type</Label>
        <Mono>{problem.type}</Mono>
        {problem.instance && (
          <>
            <Label>Instance</Label>
            <Mono>{problem.instance}</Mono>
          </>
        )}
        {problem.orderId && (
          <>
            <Label>Order id</Label>
            <Box>
              <Mono>{problem.orderId}</Mono>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {problem.status === 502
                  ? 'The order exists and its payment is unresolved — do not retry with a new Idempotency-Key. Poll '
                  : 'The declined order exists (PAYMENT_FAILED, stock released). Inspect it with '}
                <Link component={RouterLink} to="/" state={{ getOrderId: problem.orderId }}>
                  GET /orders/:id
                </Link>{' '}
                or open its lifecycle.
              </Typography>
            </Box>
          </>
        )}
      </Box>
      {problem.errors && problem.errors.length > 0 && (
        <>
          <Divider />
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Field</TableCell>
                <TableCell>Message</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {problem.errors.map((error, index) => (
                <TableRow key={`${error.field}-${index}`}>
                  <TableCell>
                    <Mono>{error.field}</Mono>
                  </TableCell>
                  <TableCell>{error.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </Stack>
  );
}
