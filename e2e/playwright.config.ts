import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Las credenciales del administrador general viven en .env (no se commitea).
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

// Puerto propio para la API de pruebas: el 3000 puede estar ocupado por otro servicio local.
const API_PORT = process.env.E2E_API_PORT ?? "3100";

export default defineConfig({
  testDir: "./",
  testMatch: "**/*.spec.ts",
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @commerce-core/api dev",
      env: { PORT: API_PORT },
      url: `http://localhost:${API_PORT}/api/v1/health`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @commerce-core/web dev",
      env: { API_URL: `http://localhost:${API_PORT}` },
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
