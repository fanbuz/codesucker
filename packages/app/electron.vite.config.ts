import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import appPackage from './package.json';

const fromConfig = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@codesucker/core'] })],
    build: {
      rollupOptions: {
        input: {
          index: fromConfig('./src/main/index.ts'),
          'pipeline-worker': fromConfig('./src/main/workers/pipeline-worker.ts'),
          'render-worker': fromConfig('./src/main/workers/render-worker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(appPackage.version),
    },
  },
});
