# Personal-toolbox

个人工具箱 —— 基于 Vite + React + Ant Design 的纯前端工具集网站，所有工具均在浏览器本地运行，不上传任何数据。通过 GitHub Actions 自动构建并托管在 GitHub Pages。

## 使用

```bash
npm install
npm run dev        # 本地开发（http://localhost:5173）
npm run build     # 生产构建（输出到 dist/）
npm run preview   # 预览构建产物（http://localhost:4173）
```

## 部署到 GitHub Pages

项目已配置 [.github/workflows/deploy.yml](.github/workflows/deploy.yml)，推送到 `main` 分支（或手动触发 workflow）即可自动构建并部署。

首次部署前需在仓库 Settings 中完成两项配置：

1. **Settings → Pages**：Source 选择 **GitHub Actions**
2. **Settings → Actions → General**：Workflow permissions 选择 **Read and write permissions**（若默认是只读）

部署完成后访问 `https://<用户名>.github.io/<仓库名>/` 即可。技术要点：

- `base: './'` 相对路径构建，资源可部署到任意仓库路径下
- 使用 HashRouter（URL 形如 `#/tools/...`），刷新子页面不会 404

## 已包含工具

| 工具 | 路径 | 说明 |
| --- | --- | --- |
| PNG 透明度归一化 | `/tools/png-alpha-normalize` | 将 PNG 中所有非完全透明像素的 alpha 值置为 255，消除半透明边缘 |

## 新增工具

1. 在 `src/tools/` 下创建工具组件目录
2. 在 `src/tools/index.jsx` 中注册工具（path / name / desc / icon / component）

## 测试辅助

`scripts/gen-test-png.cjs` 可生成含半透明像素的测试 PNG（输出至 `scripts/test-alpha.png`）。
