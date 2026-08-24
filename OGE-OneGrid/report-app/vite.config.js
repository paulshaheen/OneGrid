import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The local dev server (server/index.js) serves the data API + WebSocket on :7700.
// Vite dev serves the app on :7699 and proxies /api and /ws to the backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 7699,
    proxy: {
      '/api': { target: 'http://localhost:7700', changeOrigin: true },
      '/ws': { target: 'ws://localhost:7700', ws: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
});
