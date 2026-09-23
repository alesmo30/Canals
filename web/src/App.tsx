import { createBrowserRouter, RouterProvider } from 'react-router';
import { CssBaseline, ThemeProvider } from '@mui/material';

import { AppLayout } from './components/AppLayout';
import { ConsolePage } from './pages/ConsolePage';
import { ExecutionDetailPage } from './pages/ExecutionDetailPage';
import { ExecutionsPage } from './pages/ExecutionsPage';
import { theme } from './theme';

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <ConsolePage /> },
      { path: 'executions', element: <ExecutionsPage /> },
      { path: 'executions/:id', element: <ExecutionDetailPage /> },
    ],
  },
]);

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}
