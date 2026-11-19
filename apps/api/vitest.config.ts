import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // Los tests de integración comparten la base de tests y se vacían entre sí.
    fileParallelism: false,
    env: {
      LOG_LEVEL: "silent",
    },
  },
});
