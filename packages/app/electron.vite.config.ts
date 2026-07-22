import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import appPackage from './package.json';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@codesucker/core'] })],
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
