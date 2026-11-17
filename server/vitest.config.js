import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    reporters: "default",
    include: ["tests/**/*.test.js"],
    env: {
      ENCRYPTION_MASTER_KEY:
        "test-master-key-at-least-32-characters-long!!",
    },
    coverage: {
      enabled: false,
    },
  },
});
