import { defineConfig } from "@playwright/test";

// Expects the backend on :8000 and the frontend on :3000 (see README "End-to-end test").
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    headless: true,
    launchOptions: { executablePath: process.env.PW_CHROMIUM ?? undefined },
  },
  reporter: [["list"]],
});
