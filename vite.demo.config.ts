import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

/**
 * Demo Vite 配置
 *
 * 关键点：
 * 1. 入口指向 demo/index.html
 * 2. proxy 解决 CORS — 浏览器 fetch("/api/...") → 代理到 GitHub Models API
 * 3. 启用 TypeScript 支持（Vite 内置 esbuild 处理 TS）
 * 4. Vue 3 + Element Plus 支持
 */
export default defineConfig({
  root: "demo",
  plugins: [vue()],

  // 暴露环境变量到 import.meta.env
  envDir: "..",
  envPrefix: ["VITE_", "GITHUB_", "DEEPSEEK_"],

  server: {
    port: 3000,
    open: true,
    proxy: {
      // /api → DeepSeek API
      "/api": {
        target: "https://api.deepseek.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        secure: true,
      },
    },
  },

  // 让 Vite 能解析 src/ 中的 TypeScript 文件
  resolve: {
    alias: {
      // 无需额外 alias，Vite 默认支持相对路径 import
    },
  },

  // esbuild 配置：支持 TypeBox 的装饰器语法
  esbuild: {
    target: "es2022",
  },

  build: {
    outDir: "../dist-demo",
    emptyOutDir: true,
  },
});
