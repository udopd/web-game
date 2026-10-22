import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    testTimeout: 30000,
    hookTimeout: 60000,
    maxWorkers: 1,
    fileParallelism: false,
    reporters: ["default"],
  },
});
