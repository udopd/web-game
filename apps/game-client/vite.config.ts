import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  root: resolve("apps/game-client"),
  plugins: [react()],
  build: { outDir: resolve("dist/game"), emptyOutDir: true, sourcemap: false },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://localhost:3100",
      "/ws": { target: "ws://localhost:3100", ws: true },
    },
  },
});
