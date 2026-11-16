import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:18080";
// The time zone of the demo server and the browser (Task 11): the zone the
// baselines were recorded in.
const TIME_ZONE = "Europe/Berlin";

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
    // The server's clock zone is pinned, so times it formats (and the
    // baselines that show them) do not depend on the host.
    env: { TZ: TIME_ZONE },
  },
  use: {
    baseURL,
    locale: "en-US",
    timezoneId: TIME_ZONE,
    trace: "retain-on-failure",
    // Not a top-level test option in Playwright 1.56; it is only applied here.
    contextOptions: { reducedMotion: "reduce" },
    storageState: "e2e/.auth/demo.json",
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: process.env.SCOPEARR_E2E_CHROME || undefined,
      // The reference platform (macOS, iPad) has overlay scrollbars that
      // take no layout width; Chromium on Linux draws classic ones (15 px at
      // the root, which keeps its gutter through `scrollbar-gutter: stable`,
      // and in every scrolling box). Overlay scrollbars make Linux measure
      // like the reference, so the same widths, positions and tolerances
      // hold. The blink setting works in Chromium 141 up to at least 156;
      // the FluentOverlayScrollbar feature is gone from newer builds.
      args:
        process.platform === "linux"
          ? ["--blink-settings=forceAndroidOverlayScrollbar=true"]
          : [],
    },
  },
  projects: [
    {
      name: "invariants",
      testMatch:
        /(invariants|behavior|frame|a11y|library|dashboard|tools|settings|dialogs)\.spec\.ts/,
    },
    {
      name: "pixel",
      testMatch: /pixel\.spec\.ts/,
      // Local only and gitignored; images differ between platforms.
      snapshotPathTemplate: "e2e/pixel-baseline/{arg}{ext}",
    },
    {
      // Comparison captures for design reviews, local only: run with
      // --project=review; neither e2e, e2e:pixel nor CI runs them.
      name: "review",
      testMatch: /review\.spec\.ts/,
    },
  ],
});
