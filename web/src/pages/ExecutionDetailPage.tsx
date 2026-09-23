import { useState, type ReactNode } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RemoveCircleOutlineOutlinedIcon from '@mui/icons-material/RemoveCircleOutlineOutlined';
import {
  Box,
  Button,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';

import { HttpStatusChip, MethodChip } from '../components/chips';
import { JsonBlock } from '../components/JsonBlock';
import { LifecycleTimeline } from '../components/LifecycleTimeline';
import { PageHeader } from '../components/PageHeader';
import { MetaItem, PrettyBody } from '../components/ResponseView';
import { SectionCard } from '../components/SectionCard';
import { formatDateTime, formatDuration } from '../lib/format';
import { grafanaTraceUrl, requestSteps, type RequestStep } from '../lib/lifecycle';
import { useExecution, type Execution } from '../store/executions';
import { fonts } from '../theme';

function KeyValueTable({ entries, empty }: { entries: [string, string][]; empty: string }) {
  if (entries.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {empty}
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 3, rowGap: 0.5 }}>
      {entries.map(([key, value]) => (
        <Box key={key} sx={{ display: 'contents' }}>
          <Typography sx={{ fontFamily: fonts.mono, fontSize: 13, fontWeight: 600 }}>{key}</Typography>
          <Typography sx={{ fontFamily: fonts.mono, fontSize: 13, wordBreak: 'break-all' }}>{value}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function Subheading({ children }: { children: ReactNode }) {
  return (
    <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
      {children}
    </Typography>
  );
}

const STEP_ICON: Record<RequestStep['state'], ReactNode> = {
  OK: <CheckCircleIcon color="success" />,
  FAILED: <ErrorIcon color="error" />,
  SKIPPED: <RemoveCircleOutlineOutlinedIcon sx={{ color: 'text.disabled' }} />,
};

function RequestLifecycle({ execution }: { execution: Execution }) {
  const steps = requestSteps(execution);
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {execution.request.kind === 'CREATE_ORDER'
          ? 'No order was created, so there is no stored lifecycle — this shows where the request stopped.'
          : 'Read-only request — the path it took through the API.'}
      </Typography>
      <Stepper alternativeLabel sx={{ overflowX: 'auto', pb: 1 }}>
        {steps.map((step) => (
          <Step key={step.label} completed={step.state === 'OK'}>
            <StepLabel
              error={step.state === 'FAILED'}
              slots={{ stepIcon: () => STEP_ICON[step.state] }}
              optional={
                step.note ? (
                  <Typography variant="caption" color="error" sx={{ display: 'block', textAlign: 'center' }}>
                    {step.note}
                  </Typography>
                ) : undefined
              }
            >
              {step.label}
            </StepLabel>
          </Step>
        ))}
      </Stepper>
    </Stack>
  );
}

function ResponseBody({ execution }: { execution: Execution }) {
  const [tab, setTab] = useState<'pretty' | 'raw'>('pretty');
  return (
    <>
      <Tabs value={tab} onChange={(_, value: 'pretty' | 'raw') => setTab(value)} sx={{ mb: 2, minHeight: 40, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="pretty" label="Pretty" sx={{ minHeight: 40 }} />
        <Tab value="raw" label="Raw JSON" sx={{ minHeight: 40 }} />
      </Tabs>
      {tab === 'pretty' ? (
        <PrettyBody execution={execution} />
      ) : (
        <JsonBlock value={execution.response.body ?? execution.response.error} />
      )}
    </>
  );
}

export function ExecutionDetailPage() {
  const { id } = useParams();
  const execution = useExecution(id);

  if (!execution) {
    return (
      <>
        <PageHeader title="Execution not found" subtitle="It may have been cleared from this browser's history." />
        <Button component={RouterLink} to="/executions" startIcon={<ArrowBackIcon />}>
          Back to executions
        </Button>
      </>
    );
  }

  const { request, response } = execution;

  return (
    <>
      <Button component={RouterLink} to="/executions" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 1 }}>
        Executions
      </Button>
      <PageHeader
        title={`${request.method} ${request.path}`}
        subtitle={`${formatDateTime(execution.startedAt)} · ${formatDuration(execution.durationMs)}`}
        actions={
          execution.correlationId ? (
            <Button
              variant="outlined"
              href={grafanaTraceUrl(execution.correlationId)}
              target="_blank"
              rel="noreferrer"
              endIcon={<OpenInNewIcon />}
            >
              View trace in Grafana
            </Button>
          ) : undefined
        }
      />

      <Stack spacing={3}>
        <Stack direction="row" spacing={4} sx={{ flexWrap: 'wrap', rowGap: 1.5 }}>
          <MetaItem label="Method">
            <MethodChip method={request.method} />
          </MetaItem>
          <MetaItem label="Status">
            <HttpStatusChip status={response.status} />
          </MetaItem>
          <MetaItem label="Order id">
            <Typography sx={{ fontFamily: fonts.mono, fontSize: 13 }}>{execution.orderId ?? '—'}</Typography>
          </MetaItem>
          <MetaItem label="Correlation id">
            <Typography sx={{ fontFamily: fonts.mono, fontSize: 13 }}>{execution.correlationId ?? '—'}</Typography>
          </MetaItem>
        </Stack>

        <SectionCard title={execution.orderId ? 'Order lifecycle' : 'Request lifecycle'}>
          {execution.orderId ? (
            <LifecycleTimeline orderId={execution.orderId} />
          ) : (
            <RequestLifecycle execution={execution} />
          )}
        </SectionCard>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 3, alignItems: 'start' }}>
          <SectionCard title="Request">
            <Stack spacing={2.5}>
              <Box>
                <Subheading>URL</Subheading>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <MethodChip method={request.method} />
                  <Typography sx={{ fontFamily: fonts.mono, fontSize: 13, wordBreak: 'break-all' }}>{request.url}</Typography>
                </Stack>
              </Box>
              <Box>
                <Subheading>Query parameters</Subheading>
                <KeyValueTable entries={Object.entries(request.query)} empty="None" />
              </Box>
              <Box>
                <Subheading>Headers</Subheading>
                <KeyValueTable entries={Object.entries(request.headers)} empty="No custom headers" />
              </Box>
              <Box>
                <Subheading>Body sent</Subheading>
                {request.body ? (
                  <JsonBlock value={request.body} tone="light" />
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No body (GET)
                  </Typography>
                )}
              </Box>
            </Stack>
          </SectionCard>

          <SectionCard title="Response">
            <Stack spacing={2.5}>
              <Box>
                <Subheading>Headers</Subheading>
                <KeyValueTable
                  entries={Object.entries(response.headers)}
                  empty={response.error ? 'No response received' : 'None readable (CORS)'}
                />
              </Box>
              <Box>
                <Subheading>Body received</Subheading>
                <ResponseBody execution={execution} />
              </Box>
            </Stack>
          </SectionCard>
        </Box>
      </Stack>
    </>
  );
}
