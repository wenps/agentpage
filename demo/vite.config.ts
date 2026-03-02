import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],

  envDir: "..",
  envPrefix: ["VITE_", "GITHUB_", "DEEPSEEK_"],

  server: {
    port: 3000,
    open: true,
    proxy: {
      "/api": {
        target: "https://api.deepseek.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        secure: true,
      },
    },
  },

  esbuild: {
    target: "es2022",
  },

  build: {
    outDir: "../dist-demo",
    emptyOutDir: true,
  },
});
