import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],

  envDir: "..",
  envPrefix: ["VITE_", "GITHUB_", "MINIMAX_"],

  server: {
    port: 3000,
    open: true,
    proxy: {
      "/api": {
        target: "https://api.minimaxi.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "/v1"),
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
