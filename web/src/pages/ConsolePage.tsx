import { useState } from 'react';
import { useLocation } from 'react-router';
import {
  Box,
  Button,
  Card,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';

import { execute } from '../api/client';
import type { OrderListResponse } from '../api/types';
import { MethodChip } from '../components/chips';
import { GetOrderForm } from '../components/forms/GetOrderForm';
import { ListOrdersForm } from '../components/forms/ListOrdersForm';
import { toListQuery, type ListOrdersValues } from '../lib/list-orders-query';
import { PageHeader } from '../components/PageHeader';
import { ResponseView } from '../components/ResponseView';
import { SectionCard } from '../components/SectionCard';
import { REQUEST_OPTIONS } from '../lib/request-options';
import type { Execution, RequestKind } from '../store/executions';
import { useBaseUrl } from '../store/settings';
import { fonts } from '../theme';

interface LocationState {
  getOrderId?: string;
}

export function ConsolePage() {
  const baseUrl = useBaseUrl();
  const location = useLocation();
  const prefillOrderId = (location.state as LocationState | null)?.getOrderId;

  const [kind, setKind] = useState<RequestKind>(
    prefillOrderId ? 'GET_ORDER' : 'LIST_ORDERS',
  );
  const [execution, setExecution] = useState<Execution | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastListValues, setLastListValues] = useState<ListOrdersValues | null>(null);

  const option = REQUEST_OPTIONS.find((candidate) => candidate.kind === kind)!;

  const run = async (runner: () => Promise<Execution>) => {
    setLoading(true);
    try {
      setExecution(await runner());
    } finally {
      setLoading(false);
    }
  };

  const listOrders = (values: ListOrdersValues, cursor?: string) => {
    setLastListValues(values);
    void run(() =>
      execute({
        kind: 'LIST_ORDERS',
        method: 'GET',
        path: '/orders',
        query: toListQuery(values, cursor),
      }),
    );
  };

  const getOrder = (orderId: string) =>
    void run(() =>
      execute({
        kind: 'GET_ORDER',
        method: 'GET',
        path: `/orders/${encodeURIComponent(orderId)}`,
      }),
    );

  const listBody =
    execution?.request.kind === 'LIST_ORDERS' && execution.response.status === 200
      ? (execution.response.body as OrderListResponse)
      : null;

  return (
    <>
      <PageHeader
        title="Request console"
        subtitle="Pick a request, fill the guided form and send it. Every execution is logged under Executions."
      />

      <Card sx={{ p: 2, mb: 3 }}>
        <ToggleButtonGroup
          exclusive
          value={kind}
          onChange={(_, value: RequestKind | null) => value && setKind(value)}
          sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5 }}
        >
          {REQUEST_OPTIONS.map((candidate) => (
            <ToggleButton
              key={candidate.kind}
              value={candidate.kind}
              sx={{
                justifyContent: 'flex-start',
                textAlign: 'left',
                gap: 1.5,
                px: 2,
                py: 1.25,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '8px !important',
                '&.Mui-selected': {
                  backgroundColor: 'primary.light',
                  borderColor: 'primary.main',
                },
              }}
            >
              <MethodChip method={candidate.method} />
              <Box>
                <Typography sx={{ fontWeight: 700, color: 'navy.dark', lineHeight: 1.3 }}>
                  {candidate.title}{' '}
                  <Box component="span" sx={{ fontFamily: fonts.mono, fontSize: 13, color: 'text.secondary', fontWeight: 400 }}>
                    {candidate.path}
                  </Box>
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {candidate.description}
                </Typography>
              </Box>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <Stack
          direction="row"
          spacing={1.5}
          sx={{
            mt: 2,
            px: 1.5,
            py: 1,
            alignItems: 'center',
            borderRadius: 1,
            backgroundColor: 'surface.subtle',
            border: 1,
            borderColor: 'divider',
            overflow: 'hidden',
          }}
        >
          <MethodChip method={option.method} />
          <Typography sx={{ fontFamily: fonts.mono, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {baseUrl}
            {option.path}
          </Typography>
        </Stack>
      </Card>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '5fr 7fr' }, gap: 3, alignItems: 'start' }}>
        <SectionCard title="Request">
          {kind === 'LIST_ORDERS' && (
            <ListOrdersForm disabled={loading} onSubmit={(values) => listOrders(values)} />
          )}
          {kind === 'GET_ORDER' && (
            <GetOrderForm disabled={loading} initialOrderId={prefillOrderId} onSubmit={getOrder} />
          )}
          {kind === 'CREATE_ORDER' && (
            <Typography color="text.secondary">Order form — next step.</Typography>
          )}
        </SectionCard>

        <SectionCard title="Response">
          <ResponseView
            execution={execution}
            loading={loading}
            footer={
              listBody && lastListValues ? (
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
                    {listBody.items.length} order(s) on this page
                    {listBody.hasMore ? ' · more available' : ' · last page'}
                  </Typography>
                  <Button
                    variant="outlined"
                    disabled={!listBody.hasMore || loading}
                    onClick={() => listOrders(lastListValues, listBody.nextCursor ?? undefined)}
                  >
                    Load next page
                  </Button>
                </Stack>
              ) : null
            }
          />
        </SectionCard>
      </Box>
    </>
  );
}
