import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}", ".github/scripts/**/*.test.mjs"],
    exclude: [...configDefaults.exclude, "**/src-tauri/target/**"],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/src-tauri/target/**"],
    },
    proxy: {
      "/archive": {
        target: "https://my-bing-wallpaper.oss-cn-beijing.aliyuncs.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/archive/, ""),
      },
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "es2022",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
