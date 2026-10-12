/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // FEATURE_SCORING is the API's switch (ADR-0017). The web reads the SAME
  // variable — from the repo-root .env or the process env — so the two can
  // never disagree about whether the v2 screens exist. Baked in at build time.
  const rootEnv = loadEnv(mode, '../..', '');
  const featureScoring = (rootEnv.FEATURE_SCORING ?? 'false') === 'true';

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_FEATURE_SCORING': JSON.stringify(featureScoring),
    },
    server: {
      port: 5173,
      // Dev-only proxy so the SPA can call /api/v1/* with no CORS setup — matches
      // the on-prem deployment shape where web and api sit behind one reverse
      // proxy (ADR-0005), just simulated locally instead of configured in nginx.
      proxy: {
        '/api': {
          target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3011',
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
    },
  };
});
