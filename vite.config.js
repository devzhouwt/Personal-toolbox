import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // 相对路径 + HashRouter：构建产物可部署到 GitHub Pages 任意仓库路径下
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // 拆分框架依赖，优化 GitHub Pages 首屏加载（利于缓存）
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
        },
      },
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});
