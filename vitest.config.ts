import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/helpers/global-setup.ts"],
    setupFiles: ["tests/helpers/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
