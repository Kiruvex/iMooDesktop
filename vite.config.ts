import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';

// native addon 包,不能被 Vite 打包,运行时 require
const nativeExternals = [
  'electron',
  'electron-log',
  'electron-store',
  'iconv-lite',
  'usb',
  '@node-usb/usb-win32-x64-msvc',
  '@node-usb/usb-linux-x64-gnu',
  '@node-usb/usb-linux-x64-musl',
  '@node-usb/usb-darwin-x64',
  '@node-usb/usb-darwin-arm64',
];

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: nativeExternals,
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: nativeExternals,
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@electron': path.resolve(__dirname, 'electron'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
