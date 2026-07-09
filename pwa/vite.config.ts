import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The PWA is served by the Worker at /m/ from frontend/dist/m (the same
// [assets] directory as the dashboard SPA). Build order matters: the frontend
// build empties frontend/dist, so this build must run after it.
export default defineConfig({
  plugins: [react()],
  base: '/m/',
  build: {
    outDir: '../frontend/dist/m',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/auth': 'http://localhost:8080',
    },
  },
});
