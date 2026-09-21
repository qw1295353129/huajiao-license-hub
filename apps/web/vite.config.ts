import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // 共享包直接指向 TS 源码：
      // 它的 tsc 产物是 CJS，浏览器端/开发服务器按 ESM 加载时拿不到运行时导出（只有类型能擦除）。
      '@license-hub/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    // 允许读取 monorepo 上级目录（共享包源码在 apps/web 之外）
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
    // 开发时把 /api 反代到后端，避免 CORS，也让前后端同源行为与生产一致
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: { target: 'esnext', chunkSizeWarningLimit: 2000 },
});