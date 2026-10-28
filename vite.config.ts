/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Node's process, without pulling @types/node into the app's type space.
declare const process: { env: Record<string, string | undefined> };

// Which code is running, shown in the log. Cloudflare Workers Builds sets the commit SHA.
const sha = process.env.WORKERS_CI_COMMIT_SHA?.slice(0, 7) ?? 'local';
const BUILD_ID = `${sha} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`;

// 127.0.0.1, not localhost: Spotify rejects localhost redirect URIs.
// strictPort: moving to 5174 silently would break login (redirect URI mismatch).
export default defineConfig({
  base: '/',
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
