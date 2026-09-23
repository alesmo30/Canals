import { Chip, type ChipProps } from '@mui/material';

import type { OrderStatus } from '../api/types';
import { httpStatusColor } from '../lib/status-colors';
import { fonts } from '../theme';

export function MethodChip({
  method,
  size = 'small',
}: {
  method: 'GET' | 'POST';
  size?: ChipProps['size'];
}) {
  return (
    <Chip
      label={method}
      size={size}
      color={method === 'POST' ? 'primary' : 'secondary'}
      sx={{ fontFamily: fonts.mono, fontWeight: 700, minWidth: 56 }}
    />
  );
}

export function HttpStatusChip({ status }: { status: number | null }) {
  return (
    <Chip
      label={status ?? 'NETWORK'}
      size="small"
      color={httpStatusColor(status)}
      sx={{ fontFamily: fonts.mono, fontWeight: 700 }}
    />
  );
}

const ORDER_STATUS_COLOR: Record<OrderStatus, ChipProps['color']> = {
  CONFIRMED: 'success',
  PAID: 'success',
  PENDING_PAYMENT: 'warning',
  PAYMENT_FAILED: 'error',
  CANCELLED: 'error',
};

export function OrderStatusChip({ status }: { status: OrderStatus }) {
  return (
    <Chip
      label={status}
      size="small"
      color={ORDER_STATUS_COLOR[status] ?? 'default'}
      variant="outlined"
    />
  );
}

export function StateChip({ label }: { label: string }) {
  const upper = label.toUpperCase();
  let color: ChipProps['color'] = 'default';
  if (['CAPTURED', 'COMPLETED', 'DISPATCHED', 'DELIVERED', 'AUTHORIZED'].includes(upper)) {
    color = 'success';
  } else if (['DECLINED', 'FAILED', 'CANCELLED'].includes(upper)) {
    color = 'error';
  } else if (['PENDING', 'UNKNOWN', 'PENDING_DISPATCH', 'IN_TRANSIT', 'CREATED', 'RETRY', 'ACTIVE'].includes(upper)) {
    color = 'warning';
  }
  return <Chip label={label} size="small" color={color} variant="outlined" />;
}
