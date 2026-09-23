import { useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';

import {
  isProblem,
  type OrderDetailResponse,
  type OrderListResponse,
  type OrderResponse,
} from '../api/types';
import { formatDuration } from '../lib/format';
import type { Execution } from '../store/executions';
import { fonts } from '../theme';
import { HttpStatusChip } from './chips';
import { JsonBlock } from './JsonBlock';
import { OrderCard, OrdersTable, ProblemCard } from './OrderViews';

export function PrettyBody({ execution }: { execution: Execution }) {
  const { response, request } = execution;
  if (response.error) {
    return (
      <Alert severity="error" variant="outlined">
        {response.error}
      </Alert>
    );
  }
  if (isProblem(response.body)) {
    return <ProblemCard problem={response.body} />;
  }
  if (request.kind === 'LIST_ORDERS') {
    return <OrdersTable orders={(response.body as OrderListResponse).items} />;
  }
  return (
    <OrderCard order={response.body as OrderResponse | OrderDetailResponse} />
  );
}

export function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 700 }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

interface ResponseViewProps {
  execution: Execution | null;
  loading: boolean;
  loadingHint?: string;
  footer?: ReactNode;
}

export function ResponseView({ execution, loading, loadingHint, footer }: ResponseViewProps) {
  const [tab, setTab] = useState<'pretty' | 'raw'>('pretty');

  if (loading) {
    return (
      <Stack spacing={2} sx={{ alignItems: 'center', py: 8 }}>
        <CircularProgress />
        <Typography color="text.secondary">{loadingHint ?? 'Waiting for the API…'}</Typography>
      </Stack>
    );
  }

  if (!execution) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <Typography color="text.secondary">
          Send a request to see the response here.
        </Typography>
      </Box>
    );
  }

  const { response } = execution;

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={3} sx={{ alignItems: 'flex-end', flexWrap: 'wrap', rowGap: 1 }}>
        <MetaItem label="Status">
          <HttpStatusChip status={response.status} />
        </MetaItem>
        <MetaItem label="Time">
          <Typography sx={{ fontFamily: fonts.mono, fontSize: 14 }}>
            {formatDuration(execution.durationMs)}
          </Typography>
        </MetaItem>
        <MetaItem label="Correlation id">
          <Tooltip title="X-Correlation-Id — search it in Grafana or the logs">
            <Typography sx={{ fontFamily: fonts.mono, fontSize: 13 }}>
              {execution.correlationId ?? '—'}
            </Typography>
          </Tooltip>
        </MetaItem>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          component={RouterLink}
          to={`/executions/${execution.id}`}
          size="small"
          endIcon={<OpenInNewIcon fontSize="small" />}
        >
          {execution.orderId ? 'View lifecycle' : 'View execution'}
        </Button>
      </Stack>

      <Tabs value={tab} onChange={(_, value: 'pretty' | 'raw') => setTab(value)} sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}>
        <Tab value="pretty" label="Pretty" sx={{ minHeight: 40 }} />
        <Tab value="raw" label="Raw JSON" sx={{ minHeight: 40 }} />
      </Tabs>

      {tab === 'pretty' ? (
        <PrettyBody execution={execution} />
      ) : (
        <JsonBlock value={response.body ?? response.error} />
      )}
      {footer}
    </Stack>
  );
}
