import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      '@studio-attendance/shared': resolve(import.meta.dirname, '../../packages/shared/src/index.ts'),
    },
  },
  // GitHub Pages のサブパス（/リポジトリ名/）でも動くよう相対パスにする
  base: './',
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        join: resolve(import.meta.dirname, 'join.html'),
      },
    },
  },
});
