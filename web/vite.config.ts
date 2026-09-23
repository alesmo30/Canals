import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Port 5173 is the origin the API's CORS_ORIGINS default allows (SPEC 08).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  // One local demo bundle (MUI + lab + router); not served over the
  // network, so the default 500 kB warning is noise here.
  build: { chunkSizeWarningLimit: 1500 },
});
