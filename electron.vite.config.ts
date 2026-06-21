import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: 'electron/main.ts',
      },
      outDir: 'dist-electron/main',
      rollupOptions: {
        external: ['usb'],
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
  },
  preload: {
    build: {
      lib: {
        entry: 'electron/preload.ts',
      },
      outDir: 'dist-electron/preload',
      rollupOptions: {
        external: ['usb'],
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    root: '.',
    base: './',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, 'index.html'),
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@electron': path.resolve(__dirname, 'electron'),
        '@shared': path.resolve(__dirname, 'shared'),
      },
    },
    plugins: [react()],
  },
});
