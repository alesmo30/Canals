import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import DeleteSweepOutlinedIcon from '@mui/icons-material/DeleteSweepOutlined';
import SearchIcon from '@mui/icons-material/Search';
import {
  Box,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

import { HttpStatusChip, MethodChip } from '../components/chips';
import { PageHeader } from '../components/PageHeader';
import { formatDuration, formatTime } from '../lib/format';
import { REQUEST_OPTIONS } from '../lib/request-options';
import {
  clearExecutions,
  MAX_EXECUTIONS,
  useExecutions,
  type Execution,
  type RequestKind,
} from '../store/executions';
import { fonts } from '../theme';

type StatusFilter = 'all' | '2xx' | '4xx' | '5xx' | 'network';

function matchesStatus(execution: Execution, filter: StatusFilter): boolean {
  const status = execution.response.status;
  switch (filter) {
    case 'all':
      return true;
    case 'network':
      return status === null;
    case '2xx':
      return status !== null && status < 300;
    case '4xx':
      return status !== null && status >= 400 && status < 500;
    case '5xx':
      return status !== null && status >= 500;
  }
}

function Mono({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <Box
      component="span"
      sx={{ fontFamily: fonts.mono, fontSize: 12.5, color: muted ? 'text.secondary' : 'text.primary' }}
    >
      {children}
    </Box>
  );
}

export function ExecutionsPage() {
  const executions = useExecutions();
  const navigate = useNavigate();
  const [kind, setKind] = useState<RequestKind | 'all'>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return executions.filter(
      (execution) =>
        (kind === 'all' || execution.request.kind === kind) &&
        matchesStatus(execution, status) &&
        (!needle ||
          [execution.orderId, execution.correlationId, execution.request.url]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(needle))),
    );
  }, [executions, kind, status, search]);

  return (
    <>
      <PageHeader
        title="Executions"
        subtitle={`Every request sent from the console, newest first. Stored in this browser (last ${MAX_EXECUTIONS}).`}
        actions={
          <Button
            color="error"
            variant="outlined"
            startIcon={<DeleteSweepOutlinedIcon />}
            disabled={executions.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            Clear history
          </Button>
        }
      />

      <Card>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <TextField
            select
            size="small"
            label="Request"
            value={kind}
            onChange={(event) => setKind(event.target.value as RequestKind | 'all')}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="all">All requests</MenuItem>
            {REQUEST_OPTIONS.map((option) => (
              <MenuItem key={option.kind} value={option.kind}>
                {option.method} {option.path} — {option.title}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="all">Any status</MenuItem>
            <MenuItem value="2xx">2xx success</MenuItem>
            <MenuItem value="4xx">4xx client error</MenuItem>
            <MenuItem value="5xx">5xx server error</MenuItem>
            <MenuItem value="network">Network failure</MenuItem>
          </TextField>
          <TextField
            size="small"
            label="Search order id, correlation id or URL"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            sx={{ flexGrow: 1 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Stack>

        {filtered.length === 0 ? (
          <Box sx={{ py: 8, textAlign: 'center' }}>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              {executions.length === 0
                ? 'No executions yet.'
                : 'No executions match these filters.'}
            </Typography>
            {executions.length === 0 && (
              <Button component={RouterLink} to="/" variant="contained">
                Open the console
              </Button>
            )}
          </Box>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Request</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Duration</TableCell>
                  <TableCell>Order id</TableCell>
                  <TableCell>Correlation id</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((execution) => (
                  <TableRow
                    key={execution.id}
                    hover
                    onClick={() => void navigate(`/executions/${execution.id}`)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Mono>{formatTime(execution.startedAt)}</Mono>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {new Date(execution.startedAt).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                        <MethodChip method={execution.request.method} />
                        <Box sx={{ minWidth: 0 }}>
                          <Mono>{execution.request.path}</Mono>
                          {Object.keys(execution.request.query).length > 0 && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ display: 'block', fontFamily: fonts.mono, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            >
                              ?{new URLSearchParams(execution.request.query).toString()}
                            </Typography>
                          )}
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <HttpStatusChip status={execution.response.status} />
                    </TableCell>
                    <TableCell align="right">
                      <Mono>{formatDuration(execution.durationMs)}</Mono>
                    </TableCell>
                    <TableCell>
                      <Mono muted={!execution.orderId}>
                        {execution.orderId ?? '—'}
                      </Mono>
                    </TableCell>
                    <TableCell>
                      <Mono muted>{execution.correlationId ?? '—'}</Mono>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Card>

      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)}>
        <DialogTitle>Clear execution history?</DialogTitle>
        <DialogContent>
          <Typography>
            Removes all {executions.length} execution(s) stored in this browser. Orders in the API are not affected.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClear(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              clearExecutions();
              setConfirmClear(false);
            }}
          >
            Clear
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
