import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // 相对路径 + HashRouter：构建产物可部署到 GitHub Pages 任意仓库路径下
  base: './',
  plugins: [
    react(),
    VitePWA({
      // 部署新版本后自动更新 Service Worker，用户无感知
      registerType: 'autoUpdate',
      // manifest 中的图标自动加入预缓存，这里补充其余静态资源
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      // 应用清单：安装到桌面/主屏幕后的名称、图标与显示方式
      manifest: {
        name: '个人工具箱',
        short_name: '工具箱',
        description: '个人常用小工具集合：周期记录、个人知识库、PNG 透明化处理',
        lang: 'zh-CN',
        display: 'standalone',
        theme_color: '#1677ff',
        background_color: '#ffffff',
        // 相对路径：随 manifest 所在位置解析，兼容 GitHub Pages 子路径部署
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 预缓存构建产物，支持离线打开已安装的应用
        globPatterns: ['**/*.{js,css,html}'],
        cleanupOutdatedCaches: true,
      },
      // 开发模式也注册 Service Worker：localhost 本地即可体验"安装到桌面"弹窗
      devOptions: {
        enabled: true,
        type: 'classic',
        // 相对 base 下插件默认用 './manifest.webmanifest' 匹配 dev 请求，
        // 与浏览器实际请求的 '/manifest.webmanifest' 不一致，需显式指定
        webManifestUrl: '/manifest.webmanifest',
      },
    }),
  ],
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
    // 监听局域网（0.0.0.0）：同一 Wi-Fi 下的手机等设备可通过电脑 IP 访问开发服务
    host: true,
    port: 5173,
    open: false,
  },
});
