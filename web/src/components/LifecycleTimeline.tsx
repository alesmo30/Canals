import { useCallback, useEffect, useState } from 'react';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import RefreshIcon from '@mui/icons-material/Refresh';
import RemoveCircleOutlineOutlinedIcon from '@mui/icons-material/RemoveCircleOutlineOutlined';
import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineDot,
  TimelineItem,
  TimelineOppositeContent,
  timelineOppositeContentClasses,
  TimelineSeparator,
} from '@mui/lab';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@mui/material';

import { fetchJson } from '../api/client';
import type { OrderTimelineResponse, TimelineEvent } from '../api/types';
import { formatTime } from '../lib/format';
import { PHASES, phaseState, type PhaseState } from '../lib/lifecycle';
import { OUTCOME_COLOR } from '../lib/status-colors';
import { fonts } from '../theme';
import { OrderStatusChip } from './chips';

const AUTO_REFRESH_MS = 3000;

const PHASE_ICON: Record<PhaseState, React.ReactNode> = {
  OK: <CheckCircleIcon color="success" />,
  PENDING: <HourglassEmptyIcon color="warning" />,
  FAILED: <ErrorIcon color="error" />,
  SKIPPED: <RemoveCircleOutlineOutlinedIcon sx={{ color: 'text.disabled' }} />,
};

function PhaseStrip({ events }: { events: TimelineEvent[] }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' },
        gap: 1,
      }}
    >
      {PHASES.map(({ phase, label, description }, index) => {
        const state = phaseState(events, phase);
        return (
          <Box
            key={phase}
            sx={{
              p: 1.5,
              borderRadius: 2,
              border: 1,
              borderColor: state === 'SKIPPED' ? 'divider' : `${state === 'OK' ? 'success' : state === 'PENDING' ? 'warning' : 'error'}.main`,
              backgroundColor: state === 'SKIPPED' ? 'transparent' : 'background.paper',
              opacity: state === 'SKIPPED' ? 0.6 : 1,
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {PHASE_ICON[state]}
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                {index + 1}
              </Typography>
              <Typography sx={{ fontWeight: 700, color: 'navy.dark', fontSize: 14 }}>{label}</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {description}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

function EventDetail({ detail }: { detail: TimelineEvent['detail'] }) {
  const entries = Object.entries(detail).filter(([, value]) => value !== null && value !== '');
  if (entries.length === 0) {
    return null;
  }
  return (
    <Box
      sx={{
        mt: 1,
        p: 1.25,
        borderRadius: 1.5,
        backgroundColor: 'surface.subtle',
        display: 'grid',
        gridTemplateColumns: 'max-content 1fr',
        columnGap: 2,
        rowGap: 0.25,
      }}
    >
      {entries.map(([key, value]) => (
        <Box key={key} sx={{ display: 'contents' }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
            {key}
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: fonts.mono, wordBreak: 'break-all' }}>
            {String(value)}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function EventItem({ event, isLast, startedAt }: { event: TimelineEvent; isLast: boolean; startedAt: number }) {
  const [open, setOpen] = useState(false);
  const offset = new Date(event.at).getTime() - startedAt;
  const phaseLabel = PHASES.find((phase) => phase.phase === event.phase)?.label ?? event.phase;
  return (
    <TimelineItem>
      <TimelineOppositeContent sx={{ pt: 1.25 }}>
        <Typography sx={{ fontFamily: fonts.mono, fontSize: 12 }}>{formatTime(event.at)}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: fonts.mono }}>
          +{offset >= 1000 ? `${(offset / 1000).toFixed(2)} s` : `${offset} ms`}
        </Typography>
      </TimelineOppositeContent>
      <TimelineSeparator>
        <TimelineDot color={OUTCOME_COLOR[event.outcome]} variant={event.outcome === 'PENDING' ? 'outlined' : 'filled'} />
        {!isLast && <TimelineConnector sx={{ backgroundColor: 'divider' }} />}
      </TimelineSeparator>
      <TimelineContent sx={{ pb: 2.5 }}>
        <Box
          role="button"
          tabIndex={0}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(keyEvent) => {
            if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
              setOpen((value) => !value);
            }
          }}
          sx={{ cursor: 'pointer' }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            <Chip label={phaseLabel} size="small" variant="outlined" sx={{ fontSize: 11, height: 20 }} />
            <Typography sx={{ fontWeight: 600 }}>{event.title}</Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: fonts.mono }}>
            {event.kind} · {open ? 'hide details' : 'details'}
          </Typography>
        </Box>
        <Collapse in={open} unmountOnExit>
          <EventDetail detail={event.detail} />
        </Collapse>
      </TimelineContent>
    </TimelineItem>
  );
}

export function LifecycleTimeline({ orderId }: { orderId: string }) {
  const [timeline, setTimeline] = useState<OrderTimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTimeline(await fetchJson<OrderTimelineResponse>(`/orders/${orderId}/timeline`));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  const hasPending = timeline?.events.some((event) => event.outcome === 'PENDING') ?? false;

  useEffect(() => {
    // Initial fetch — an external system (the API) is being synchronised.
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh || !hasPending) {
      return;
    }
    const timer = window.setInterval(() => void load(), AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, hasPending, load]);

  const startedAt = timeline?.events[0] ? new Date(timeline.events[0].at).getTime() : 0;

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        {timeline && (
          <>
            <Typography variant="h5" component="p">
              {timeline.orderNumber}
            </Typography>
            <OrderStatusChip status={timeline.status} />
          </>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <FormControlLabel
          control={<Switch size="small" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />}
          label={
            <Typography variant="body2" color="text.secondary">
              Auto-refresh while pending
            </Typography>
          }
        />
        <Button
          variant="outlined"
          size="small"
          onClick={() => void load()}
          disabled={loading}
          startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />}
        >
          Refresh
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" variant="outlined">
          Could not load the timeline: {error}
        </Alert>
      )}

      {timeline && (
        <>
          <PhaseStrip events={timeline.events} />
          {hasPending && (
            <Alert severity="warning" variant="outlined">
              Some steps are still pending — the worker processes fan-out jobs every ~15 s and reconciles unknown payments every minute.
              {autoRefresh ? ' This view refreshes itself.' : ''}
            </Alert>
          )}
          <Timeline
            sx={{
              p: 0,
              m: 0,
              [`& .${timelineOppositeContentClasses.root}`]: { flex: '0 0 130px', textAlign: 'right' },
            }}
          >
            {timeline.events.map((event, index) => (
              <EventItem
                key={`${event.kind}-${event.at}-${index}`}
                event={event}
                startedAt={startedAt}
                isLast={index === timeline.events.length - 1}
              />
            ))}
          </Timeline>
        </>
      )}
    </Stack>
  );
}
