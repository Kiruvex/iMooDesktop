import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';

// native addon 包,不能被 Vite/Rollup 打包或扫描
// 即使放在 external 里,Rollup 的 commonjs 插件仍会扫描它提取 named exports,
// 跟随 require('../index.js') → require('@node-usb/...') → .node 二进制 → 崩溃
// 解决:用 resolveId 钩子在 Rollup 解析之前拦截,直接返回空模块
const nativeExternals = [
  'electron',
  'electron-log',
  'electron-store',
  'iconv-lite',
  'usb',
];

function stubNativeAddon(): Plugin {
  return {
    name: 'stub-native-addon',
    enforce: 'pre',
    resolveId(source, _importer) {
      // 拦截 usb 和 @node-usb/* 的所有引用
      if (source === 'usb' || source.startsWith('@node-usb/')) {
        return { id: source, external: true };
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          plugins: [stubNativeAddon()],
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
          plugins: [stubNativeAddon()],
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
