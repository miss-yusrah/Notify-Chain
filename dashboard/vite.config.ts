/// <reference types="vite/client" />
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Workspace path contains ':' (Core-Foundry:Notify-Chain), which breaks Vite's default fs allow checks.
    fs: {
      strict: false,
      allow: [rootDir],
    },
  },
});
