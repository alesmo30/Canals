import type { TimelineOutcome } from '../api/types';

export function httpStatusColor(
  status: number | null,
): 'success' | 'warning' | 'error' | 'default' {
  if (status === null) {
    return 'error';
  }
  if (status < 300) {
    return 'success';
  }
  if (status === 502 || status === 409) {
    return 'warning';
  }
  return 'error';
}

export const OUTCOME_COLOR: Record<
  TimelineOutcome,
  'success' | 'warning' | 'error'
> = {
  OK: 'success',
  PENDING: 'warning',
  FAILED: 'error',
};
