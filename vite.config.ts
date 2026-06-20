import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';

// usb 包含 native addon(.node),Rollup 的 commonjs 插件会扫描它导致崩溃
// 用 resolve.alias 把 usb 指向空 stub,构建时 Rollup 读到的是空模块
// 运行时 require('usb') 不受影响(external 让它保持 require 不打包)
const usbStubPath = path.resolve(__dirname, 'electron/usb-stub.cjs');

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          resolve: {
            alias: {
              'usb': usbStubPath,
            },
          },
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['usb'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          resolve: {
            alias: {
              'usb': usbStubPath,
            },
          },
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['usb'],
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
