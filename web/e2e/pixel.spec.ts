// Local pixel baseline of the current interface, for proving that a refactor
// changes no pixels. Images are platform dependent and stay out of git:
// record with `e2e:pixel:update`, compare with `e2e:pixel` on the same machine.
// Each image has a DOM fingerprint next to it, so markup changes that draw the
// same pixels are caught too.
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  DATE,
  domSnapshot,
  goTo,
  openApp,
  settingsSection,
  settle,
  TIME,
  type SettingsSection,
  type Theme,
} from "./app";

// The client clock is fixed; timestamps from the server still move.
const NOW = "2026-11-06T09:41:00Z";

type Size = { width: number; height: number };
const sizes: Size[] = [
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
];
const themes: Theme[] = ["dark", "light"];

function volatile(page: Page): Locator[] {
  return [page.getByText(TIME), page.getByText(DATE), page.locator(".spin")];
}

// Per-pixel threshold 0.05 instead of Playwright's default 0.2, which let
// the old header behind a dimmed modal backdrop pass as unchanged. 0 would
// also catch faint changes behind a backdrop, but it flakes: in one of four
// full runs the band's gradient behind the page header of
// mux-1440x900-dark came out up to 7/255 per channel different (0.024
// absorbs it). The 1.7.0 sign-in page draws the app icon from PNGs scaled
// down about tenfold, and Chromium resamples them one of two ways from run
// to run (at 375px about 500 pixels, up to 17/255 per channel, which only
// a threshold above 0.054 absorbs). Its shots keep 0.1 until the sign-in
// page is rebuilt.
const RASTER_ICON_SHOTS = /^login-/;

async function snap(page: Page, name: string) {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    maxDiffPixels: 0,
    threshold: RASTER_ICON_SHOTS.test(name) ? 0.1 : 0.05,
    mask: volatile(page),
  });
  expect(await domSnapshot(page)).toMatchSnapshot(`${name}.html`);
}

async function openSettings(page: Page, section: SettingsSection) {
  await goTo(page, "settings");
  await settingsSection(page, section);
}

async function systemTab(page: Page, name: "Info" | "Log") {
  await openSettings(page, "System");
  const tab = page
    .getByRole("tablist", { name: "System sections" })
    .getByRole("tab", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

async function dialog(page: Page, title: string) {
  await expect(
    page
      .getByRole("dialog", { name: title, exact: true })
      .getByRole("heading", { level: 2, name: title, exact: true }),
  ).toBeVisible();
}

// Each view starts from a fresh signed-in page; names are the file names.
const views: Record<string, (page: Page) => Promise<void>> = {
  dashboard: (page) => goTo(page, "dashboard"),
  movies: (page) => goTo(page, "movies"),
  "movies-filters-expanded": async (page) => {
    await goTo(page, "movies");
    await page
      .getByRole("main")
      .getByRole("button", { name: "Expand filters", exact: true })
      .click();
    await expect(
      page
        .getByRole("main")
        .getByRole("button", { name: "Collapse filters", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
  },
  series: (page) => goTo(page, "series"),
  mux: (page) => goTo(page, "mux"),
  placement: (page) => goTo(page, "placement"),
  files: (page) => goTo(page, "files"),
  "settings-services": (page) => openSettings(page, "Services"),
  "settings-display": (page) => openSettings(page, "Display"),
  "settings-widgets": (page) => openSettings(page, "Widgets"),
  "settings-custom": (page) => openSettings(page, "Custom tags"),
  "settings-rules": (page) => openSettings(page, "Tag rules"),
  "settings-system-info": (page) => systemTab(page, "Info"),
  "settings-system-log": (page) => systemTab(page, "Log"),
  "dialog-file-metadata": async (page) => {
    await goTo(page, "movies");
    await page
      .getByRole("button", { name: "Filename and metadata: Arrival" })
      .click();
    await dialog(page, "File & metadata");
  },
  "dialog-scan-placement": async (page) => {
    await goTo(page, "placement");
    await page
      .getByRole("main")
      .getByRole("button", { name: "Scan", exact: true })
      .click();
    await dialog(page, "Scan disk placement");
  },
};

// The frame's other modes and widths: expanded at 1600, the narrow rail
// at 820 (tablet).
const frameSizes: Size[] = [
  { width: 1600, height: 900 },
  { width: 820, height: 1180 },
];
const frameViews = ["dashboard", "movies", "settings-services"];
// Both band styles against the default of their mode (muted in dark, strong
// in light), stored as scopearr-band.
const bands = [
  { band: "strong", theme: "dark" },
  { band: "muted", theme: "light" },
] as const;

for (const size of frameSizes) {
  for (const theme of themes) {
    const variant = `${size.width}x${size.height}-${theme}`;
    test.describe(variant, () => {
      test.use({ viewport: size });
      test.beforeEach(async ({ page }) => {
        await page.clock.setFixedTime(NOW);
      });
      for (const name of frameViews) {
        test(name, async ({ page }) => {
          await openApp(page, { theme });
          await views[name](page);
          await snap(page, `${name}-${variant}`);
        });
      }
    });
  }
}

test.describe("band styles", () => {
  test.use({ viewport: sizes[0] });
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
  });
  for (const { band, theme } of bands) {
    const name = `movies-band-${band}-1440x900-${theme}`;
    test(name, async ({ page }) => {
      await page.addInitScript((value) => {
        try {
          localStorage.setItem("scopearr-band", value);
        } catch {
          // Storage can be blocked; the default band is then used.
        }
      }, band);
      await openApp(page, { theme });
      await views.movies(page);
      await expect(page.locator("html")).toHaveAttribute("data-band", band);
      await snap(page, name);
    });
  }
});

for (const size of sizes) {
  for (const theme of themes) {
    const variant = `${size.width}x${size.height}-${theme}`;

    test.describe(variant, () => {
      test.use({ viewport: size });

      test.beforeEach(async ({ page }) => {
        await page.clock.setFixedTime(NOW);
      });

      test.describe("signed out", () => {
        test.use({ storageState: { cookies: [], origins: [] } });

        test("login", async ({ page }) => {
          await page.addInitScript((value) => {
            try {
              localStorage.setItem("scopearr-theme", value);
            } catch {
              // Storage can be blocked; the default theme is then used.
            }
          }, theme);
          await page.goto("/");
          await expect(
            page.getByRole("button", { name: "Sign in", exact: true }),
          ).toBeVisible();
          await snap(page, `login-${variant}`);
        });
      });

      for (const [name, show] of Object.entries(views)) {
        test(name, async ({ page }) => {
          await openApp(page, { theme });
          await show(page);
          await snap(page, `${name}-${variant}`);
        });
      }
    });
  }
}
