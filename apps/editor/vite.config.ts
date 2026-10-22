import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  root: resolve("apps/editor"),
  base: "/editor/",
  plugins: [react()],
  build: {
    outDir: resolve("dist/editor"),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    proxy: { "/api": "http://localhost:3100" },
  },
});
