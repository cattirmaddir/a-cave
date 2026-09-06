import path from 'path';
import { spawn } from 'node:child_process';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

function xfceRuntimePlugin() {
  let runtime: ReturnType<typeof spawn> | undefined;

  return {
    name: 'xfce-web-vnc-runtime',
    configureServer(server: { middlewares: { use: (handler: unknown) => void }; httpServer?: { once: Function } }) {
      if (process.env.DISABLE_XFCE_RUNTIME === '1') return;
      const script = path.resolve(import.meta.dirname, 'scripts/xfce-session.mjs');
      runtime = spawn('node', [script], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        env: {
          ...process.env,
          XFCE_DISPLAY: ':99',
          XFCE_VNC_PORT: '5900',
          XFCE_WS_PORT: '6080',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      runtime.stdout?.on('data', (chunk) => process.stdout.write(`[xfce-runtime] ${chunk}`));
      runtime.stderr?.on('data', (chunk) => process.stderr.write(`[xfce-runtime] ${chunk}`));
      server.httpServer?.once('close', () => runtime?.kill('SIGTERM'));
    },
    closeBundle() {
      runtime?.kill('SIGTERM');
    },
  };
}

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    xfceRuntimePlugin(),
    runtimeErrorOverlay(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      '/vnc': {
        target: 'ws://127.0.0.1:6080',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
