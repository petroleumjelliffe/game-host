import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // The game server's port. Read from the repo root's .env files (not the
  // vite root, client/) so one PORT line steers both halves: server/main.ts
  // loads the same file before it listens.
  const repoRoot = dirname(fileURLToPath(import.meta.url));
  // 4003 is Marco Polo's server slot in the cross-game port registry (the
  // game-host repo's PORTS.md); 7933 below is its dev-client slot.
  const serverPort = loadEnv(mode, repoRoot, '').PORT ?? '4003';

  return {
    root: 'client',
    // Built (and dev-served) under the proxy path the game-host repo's
    // Caddyfile routes, so the same bundle works behind the front door and
    // served directly from the game server's port.
    base: '/marcopolo/',
    plugins: [react()],
    server: {
      host: true,
      // strictPort: sliding to 7934 would leave the reverse proxy pointing
      // at nothing; allowedHosts covers the host machine's mDNS name, which
      // Vite's DNS-rebind guard would otherwise refuse.
      port: 7933,
      strictPort: true,
      allowedHosts: ['.local'],
      fs: { allow: ['..'] },
      proxy: { '/marcopolo/socket.io': { target: `http://localhost:${serverPort}`, ws: true } },
    },
    build: { outDir: 'dist' },
  };
});
