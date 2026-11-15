import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: ['localhost', '.manus.computer', '3000-ii6p4tytrxswokxt8epqt-862910fc.us5.manus.computer'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/media': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
      },
    },
  },
});
