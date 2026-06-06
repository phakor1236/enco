import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_PROXY_TARGET ?? `http://localhost:${env.API_PORT ?? 4000}`;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      proxy: {
        // Same-origin in dev: FE calls /api/*, Vite proxies to API
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
