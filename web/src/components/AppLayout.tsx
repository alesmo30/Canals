import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import WavesIcon from '@mui/icons-material/Waves';
import PersonOutlineIcon from '@mui/icons-material/PersonOutlined';
import {
  AppBar,
  Box,
  Button,
  Container,
  InputAdornment,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material';

import { FIXED_CUSTOMER } from '../api/catalog';
import { setBaseUrl, useBaseUrl } from '../store/settings';
import { fonts } from '../theme';

const NAV = [
  { to: '/', label: 'Console', end: true },
  { to: '/executions', label: 'Executions', end: false },
];

// Remounted (via `key`) whenever the stored URL changes, so the draft
// always starts from the persisted value without a syncing effect.
function BaseUrlField({ baseUrl }: { baseUrl: string }) {
  const [draft, setDraft] = useState(baseUrl);

  return (
    <TextField
      size="small"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => setBaseUrl(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          setBaseUrl(draft);
          (event.target as HTMLInputElement).blur();
        }
      }}
      aria-label="API base URL"
      sx={{
        width: { xs: 180, md: 260 },
        '& .MuiOutlinedInput-root': {
          color: '#fff',
          fontFamily: fonts.mono,
          fontSize: 13,
          backgroundColor: 'navy.mid',
        },
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: 'rgba(255,255,255,0.2)',
        },
      }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <Typography
                variant="caption"
                sx={{ color: 'rgba(255,255,255,0.6)', fontWeight: 700 }}
              >
                API
              </Typography>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

export function AppLayout() {
  const baseUrl = useBaseUrl();
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{ backgroundColor: 'navy.dark', color: '#fff' }}
      >
        <Toolbar sx={{ gap: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <WavesIcon sx={{ color: 'primary.main', fontSize: 30 }} />
            <Typography
              sx={{ fontFamily: fonts.sans, fontWeight: 700, fontSize: 22 }}
            >
              canals
            </Typography>
            <Typography
              sx={{
                fontFamily: fonts.serif,
                fontSize: 20,
                color: 'rgba(255,255,255,0.75)',
                ml: 0.5,
              }}
            >
              Console
            </Typography>
          </Box>

          <Box component="nav" sx={{ display: 'flex', gap: 0.5 }}>
            {NAV.map((item) => (
              <Button
                key={item.to}
                component={NavLink}
                to={item.to}
                end={item.end}
                sx={{
                  color: 'rgba(255,255,255,0.75)',
                  px: 1.5,
                  '&.active': {
                    color: '#fff',
                    backgroundColor: 'navy.mid',
                    boxShadow: (theme) =>
                      `inset 0 -2px 0 ${theme.palette.primary.main}`,
                  },
                  '&:hover': { backgroundColor: 'navy.mid' },
                }}
              >
                {item.label}
              </Button>
            ))}
          </Box>

          <Box sx={{ flexGrow: 1 }} />
          <BaseUrlField key={baseUrl} baseUrl={baseUrl} />
        </Toolbar>
      </AppBar>

      <Box
        sx={{
          backgroundColor: 'primary.light',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Container
          maxWidth="xl"
          sx={{ py: 0.75, display: 'flex', alignItems: 'center', gap: 1 }}
        >
          <PersonOutlineIcon fontSize="small" sx={{ color: 'navy.dark' }} />
          <Typography variant="body2" sx={{ color: 'navy.dark' }}>
            All requests run as the fixed test customer{' '}
            <strong>{FIXED_CUSTOMER.name}</strong>{' '}
            <Box
              component="code"
              sx={{ fontSize: 12, color: 'text.secondary' }}
            >
              {FIXED_CUSTOMER.id}
            </Box>
          </Typography>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ py: 4, flexGrow: 1 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
