import SendIcon from '@mui/icons-material/Send';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';

import { fonts } from '../theme';
import { MethodChip } from './chips';
import { JsonBlock } from './JsonBlock';

interface ConfirmDialogProps {
  open: boolean;
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string | undefined>;
  body: unknown;
  warning?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  method,
  url,
  headers,
  body,
  warning,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const shownHeaders = Object.entries(headers).filter(
    (entry): entry is [string, string] => Boolean(entry[1]),
  );

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontFamily: fonts.serif, fontSize: 24, color: 'navy.dark' }}>
        Send this request?
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Typography color="text.secondary">
            This creates a real order: stock is reserved and the test card is charged against the payments mock.
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <MethodChip method={method} />
            <Typography sx={{ fontFamily: fonts.mono, fontSize: 14, wordBreak: 'break-all' }}>
              {url}
            </Typography>
          </Stack>
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Headers
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 2, rowGap: 0.5 }}>
              {[['Content-Type', 'application/json'], ...shownHeaders].map(([name, value]) => (
                <Box key={name} sx={{ display: 'contents' }}>
                  <Typography sx={{ fontFamily: fonts.mono, fontSize: 13, fontWeight: 600 }}>
                    {name}
                  </Typography>
                  <Typography sx={{ fontFamily: fonts.mono, fontSize: 13, wordBreak: 'break-all' }}>
                    {value}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Body
            </Typography>
            <JsonBlock value={body} tone="light" maxHeight={320} />
          </Box>
          {warning && (
            <Typography variant="body2" sx={{ color: 'warning.main', fontWeight: 600 }}>
              {warning}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" onClick={onConfirm} endIcon={<SendIcon />} autoFocus>
          Confirm and send
        </Button>
      </DialogActions>
    </Dialog>
  );
}
