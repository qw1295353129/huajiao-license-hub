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
    // 默认 5273 而不是 Vite 惯用的 5173：
    // 5173 常被其它本地项目占用（本机上就有另一个授权系统跑在那里），
    // 端口不一致会让人打开错误的站点。需要改端口请设 VITE_DEV_PORT。
    port: Number(process.env.VITE_DEV_PORT ?? 5273),
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