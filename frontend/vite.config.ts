import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), 'PORT');
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [react(), tailwind()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: 'http://127.0.0.1:' + (process.env.PORT || env.PORT || '3000') } },
    },
  };
});
