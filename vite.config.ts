import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5174,
    strictPort: true,
    // 当前项目通过本地浏览器/代理访问时不依赖 HMR WebSocket，关闭它可避免握手 400。
    hmr: false,
  },
});
