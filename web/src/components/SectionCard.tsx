import type { ReactNode } from 'react';
import { Box, Card, Typography } from '@mui/material';

interface SectionCardProps {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  dense?: boolean;
}

export function SectionCard({ title, action, children, dense }: SectionCardProps) {
  return (
    <Card>
      <Box
        sx={{
          px: 2.5,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
          {title}
        </Typography>
        {action}
      </Box>
      <Box sx={{ p: dense ? 0 : 2.5 }}>{children}</Box>
    </Card>
  );
}
