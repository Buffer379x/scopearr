import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:18080";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One demo database is shared by all tests.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  webServer: {
    command: "node e2e/start-demo.mjs",
    url: `${baseURL}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  use: {
    baseURL,
    locale: "en-US",
    // Not a top-level test option in Playwright 1.56; it is only applied here.
    contextOptions: { reducedMotion: "reduce" },
    storageState: "e2e/.auth/demo.json",
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: process.env.SCOPEARR_E2E_CHROME || undefined,
    },
  },
  projects: [
    { name: "invariants", testMatch: /invariants\.spec\.ts/ },
    { name: "pixel", testMatch: /pixel\.spec\.ts/ },
  ],
});
