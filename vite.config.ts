import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // The game server's port. Read from the repo root's .env files (not the
  // vite root, client/) so one PORT line steers both halves: server/main.ts
  // loads the same file before it listens.
  const repoRoot = dirname(fileURLToPath(import.meta.url));
  const serverPort = loadEnv(mode, repoRoot, '').PORT ?? '3001';

  return {
    root: 'client',
    plugins: [react()],
    server: {
      host: true,
      fs: { allow: ['..'] },
      proxy: { '/socket.io': { target: `http://localhost:${serverPort}`, ws: true } },
    },
    build: { outDir: 'dist' },
  };
});
