import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const e2eDb = process.env.E2E_DATABASE_URL ?? "postgres://pitch_app:dev_app_local_only@localhost:5432/pitch_e2e";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 400_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: e2eDb,
      APP_ORIGIN: `http://localhost:${PORT}`,
      SESSION_TOKEN_PEPPER: process.env.SESSION_TOKEN_PEPPER ?? Buffer.alloc(32, 3).toString("base64"),
      MFA_ENCRYPTION_KEY: process.env.MFA_ENCRYPTION_KEY ?? Buffer.alloc(32, 4).toString("base64"),
      NEXT_TELEMETRY_DISABLED: "1",
      APP_ENV: "e2e",
      ALLOW_MEMORY_STORAGE: "1",
    },
  },
});
