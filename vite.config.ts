import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// One fixed origin: browser storage belongs to the exact scheme + host + port.
const HOST = '127.0.0.1';
const PORT = 5317;

// Enforced in built output. connect-src 'self' makes the browser itself refuse any third-party request.
// Dev mode skips it because Vite injects inline scripts and a websocket.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'foliofish-csp',
      apply: 'build',
      transformIndexHtml: () => [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
      ],
    },
  ],
  server: { host: HOST, port: PORT, strictPort: true },
  preview: { host: HOST, port: PORT, strictPort: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', setupFiles: ['tests/setup.ts'] },
});
