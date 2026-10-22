import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.toLowerCase().includes("test")) throw new Error("Use a dedicated TEST_DATABASE_URL containing 'test'.");
process.env.AUTH_E2E_OWNER_EMAIL ??= `auth-browser-${randomUUID()}@example.test`;
process.env.DATABASE_URL = databaseUrl;
export default defineConfig({
  testDir: "./tests/auth-e2e",
  outputDir: "./test-results/auth",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalTimeout: 180_000,
  timeout: 60_000,
  reporter: [["list"], ["html", { outputFolder: "playwright-report/auth", open: "never" }]],
  use: { baseURL: "https://127.0.0.1:3101", ignoreHTTPSErrors: true, reducedMotion: "reduce", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
