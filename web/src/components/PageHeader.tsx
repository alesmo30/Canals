import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: { xs: 'flex-start', md: 'flex-end' },
        flexDirection: { xs: 'column', md: 'row' },
        gap: 2,
        mb: 3,
      }}
    >
      <Box sx={{ flexGrow: 1 }}>
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        {subtitle && (
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions}
    </Box>
  );
}
