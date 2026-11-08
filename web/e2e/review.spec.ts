// Comparison captures for design reviews (project `review`, local only, not
// in CI): the views of the approved C+ preview
// (work/2.0.0/preview/screens/cplus-*) as the app draws them, saved as
// p4-<width>-<mode>-<view>.png in SCOPEARR_REVIEW_DIR. Nothing is compared;
// each capture uses the crop of the C+ capture of the same name (viewport
// or full page). A test fails on any console error or uncaught exception.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  goTo,
  jobsMenu,
  mainNavigation,
  openApp,
  openRoute,
  quickSearch,
  settingsSection,
  settle,
  syncPopover,
  withOpenJobs,
  withTwoMovieInstances,
  type Theme,
  type View,
} from "./app";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(
  process.env.SCOPEARR_REVIEW_DIR || join(here, "..", "test-results", "review"),
);
// The client clock is fixed as in the pixel run.
const NOW = "2026-11-06T09:41:00Z";
const themes: Theme[] = ["dark", "light"];

type Size = { width: number; height: number };
const desktop: Size = { width: 1440, height: 900 };
const wide: Size = { width: 1600, height: 900 };
const tablet: Size = { width: 820, height: 1180 };
const phone: Size = { width: 375, height: 812 };

const problems = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const found: string[] = [];
  problems.set(page, found);
  page.on("console", (message) => {
    if (message.type() === "error") found.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => found.push(`page: ${error.message}`));
  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ page }) => {
  expect(problems.get(page), "console errors").toEqual([]);
});

// Saves p4-<name>.png. A full-page capture resizes the view, and a resize
// closes the frame's flyout and popovers; open states use the viewport.
async function shoot(page: Page, name: string, { fullPage = false } = {}) {
  await settle(page);
  await page.screenshot({
    path: join(OUT, `p4-${name}.png`),
    fullPage,
    animations: "disabled",
    caret: "hide",
  });
}

async function show(page: Page, view: View) {
  if (view === "settings") {
    await goTo(page, "settings");
    await settingsSection(page, "Services");
  } else {
    await goTo(page, view);
  }
}

// Desktop views at 1440: the crop of the C+ capture of the same name.
const desktopViews: { view: View; fullPage: boolean }[] = [
  { view: "dashboard", fullPage: true },
  { view: "movies", fullPage: false },
  { view: "mux", fullPage: false },
  { view: "placement", fullPage: false },
  { view: "settings", fullPage: true },
];

// The frame's open states on the movie library, as in C+ (o-*-fly-settings,
// o-*-sync, o-*-bell), with the pointer moved off the frame.
const states: {
  name: string;
  instances?: boolean;
  jobs?: boolean;
  open(page: Page): Promise<void>;
}[] = [
  {
    name: "flyout",
    async open(page) {
      await mainNavigation(page)
        .getByRole("button", { name: "Settings", exact: true })
        .hover();
      await expect(page.locator("#v2-fly")).toHaveAttribute("data-open", "");
    },
  },
  {
    // Two enabled movie instances; the demo has none to sync.
    name: "sync",
    instances: true,
    async open(page) {
      await page.getByRole("banner").locator(".v2-sync-chip").click();
      await expect(syncPopover(page)).toBeVisible();
      await page.mouse.move(0, 0);
    },
  },
  {
    // Open jobs, loaded; the demo has none.
    name: "jobs",
    jobs: true,
    async open(page) {
      await page
        .getByRole("banner")
        .getByRole("button", { name: /open jobs/ })
        .click();
      await expect(
        jobsMenu(page).locator(".v2-job:not([aria-hidden])"),
      ).toHaveCount(6);
      await page.mouse.move(0, 0);
    },
  },
  {
    // Pages, movies and TV series for "da".
    name: "search",
    async open(page) {
      await page
        .getByRole("banner")
        .getByRole("button", { name: "Quick search", exact: true })
        .click();
      const dialog = quickSearch(page);
      await page.keyboard.type("da");
      await expect(
        dialog.getByRole("group", { name: "TV series" }),
      ).toBeVisible();
      await expect(dialog.getByRole("listbox")).not.toHaveAttribute(
        "aria-busy",
      );
      await page.mouse.move(0, 0);
    },
  },
];

for (const theme of themes) {
  test.describe(`1440 ${theme}`, () => {
    test.use({ viewport: desktop });

    for (const { view, fullPage } of desktopViews) {
      test(view, async ({ page }) => {
        await openApp(page, { theme });
        await show(page, view);
        await shoot(page, `1440-${theme}-${view}`, { fullPage });
      });
    }

    for (const state of states) {
      test(state.name, async ({ page }) => {
        if (state.instances) await withTwoMovieInstances(page);
        if (state.jobs) await withOpenJobs(page);
        await openRoute(page, "#/movies", { theme });
        await state.open(page);
        await shoot(page, `1440-${theme}-${state.name}`);
      });
    }

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
        await shoot(page, `1440-${theme}-login`);
      });
    });
  });

  test.describe(`1600 ${theme}`, () => {
    test.use({ viewport: wide });
    test("movies", async ({ page }) => {
      await openApp(page, { theme });
      await show(page, "movies");
      await expect(page.locator("#v2-sidebar")).toHaveAttribute(
        "data-mode",
        "expanded",
      );
      await shoot(page, `1600-${theme}-movies`);
    });
  });

  test.describe(`820 ${theme}`, () => {
    test.use({ viewport: tablet });
    test("movies", async ({ page }) => {
      await openApp(page, { theme });
      await show(page, "movies");
      await shoot(page, `820-${theme}-movies`, { fullPage: true });
    });
  });

  test.describe(`375 ${theme}`, () => {
    test.use({ viewport: phone });
    for (const view of ["dashboard", "movies"] as const) {
      test(view, async ({ page }) => {
        await openApp(page, { theme });
        await show(page, view);
        await shoot(page, `375-${theme}-${view}`, { fullPage: true });
      });
    }
    test("nav", async ({ page }) => {
      await openApp(page, { theme });
      await mainNavigation(page)
        .getByRole("button", { name: "More", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Main navigation" }),
      ).toBeVisible();
      await shoot(page, `375-${theme}-nav`);
    });
    test("tools", async ({ page }) => {
      await openApp(page, { theme });
      await mainNavigation(page)
        .getByRole("button", { name: "Tools", exact: true })
        .click();
      await expect(page.getByRole("menu", { name: "Tools" })).toBeVisible();
      await shoot(page, `375-${theme}-tools`);
    });
  });
}

test.describe("band styles", () => {
  test.use({ viewport: desktop });
  // Each against the default of its mode (muted in dark, strong in light).
  for (const { band, theme } of [
    { band: "strong", theme: "dark" },
    { band: "muted", theme: "light" },
  ] as const) {
    test(`movies-${band}`, async ({ page }) => {
      await page.addInitScript((value) => {
        try {
          localStorage.setItem("scopearr-band", value);
        } catch {
          // Storage can be blocked; the default band is then used.
        }
      }, band);
      await openApp(page, { theme });
      await show(page, "movies");
      await expect(page.locator("html")).toHaveAttribute("data-band", band);
      await shoot(page, `1440-${theme}-movies-${band}`);
    });
  }
});

// The palette is a server setting: saved for the capture and restored
// afterwards, also when the capture fails.
test.describe("palettes", () => {
  test.use({ viewport: desktop });
  for (const { palette, theme } of [
    { palette: "nord", theme: "dark" },
    { palette: "catppuccin", theme: "light" },
  ] as const) {
    test(`movies ${palette}`, async ({ page, baseURL }) => {
      const api = page.request;
      const status = await api.get("/api/status");
      expect(status.ok()).toBe(true);
      const headers = {
        Origin: String(baseURL),
        "X-CSRF-Token": (await status.json()).csrf as string,
      };
      const current = await api.get("/api/settings");
      expect(current.ok()).toBe(true);
      const settings = await current.json();
      const save = async (value: string) => {
        const saved = await api.put("/api/settings", {
          data: { ...settings, interfaceTheme: value },
          headers,
        });
        expect(
          saved.ok(),
          `saving interfaceTheme ${value}: ${saved.status()} ${await saved.text()}`,
        ).toBe(true);
      };
      await save(palette);
      // A restore that fails after a failed capture is logged, so the
      // capture's own error is the one reported (final review, parked
      // Task 16); after a capture that worked it fails the test.
      let failed = false;
      try {
        await openApp(page, { theme });
        await show(page, "movies");
        await shoot(page, `1440-${theme}-${palette}-movies`);
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        await save(settings.interfaceTheme).catch((error) => {
          if (!failed) throw error;
          console.warn("Restoring interfaceTheme failed:", error);
        });
      }
    });
  }
});

// The generated icons from web/public at their own size, on a light and a
// dark panel: 16 and 32 are the PNG entries of favicon.ico.
const PUBLIC = join(here, "..", "public");

function icoEntry(size: number): Buffer {
  const ico = readFileSync(join(PUBLIC, "favicon.ico"));
  const count = ico.readUInt16LE(4);
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    if ((ico[entry] || 256) !== size) continue;
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    return ico.subarray(offset, offset + length);
  }
  throw new Error(`favicon.ico has no ${size}px entry`);
}

const icons: { size: number; file: string; data: () => Buffer }[] = [
  { size: 16, file: "favicon.ico", data: () => icoEntry(16) },
  { size: 32, file: "favicon.ico", data: () => icoEntry(32) },
  {
    size: 64,
    file: "icon-64.png",
    data: () => readFileSync(join(PUBLIC, "icon-64.png")),
  },
  {
    size: 180,
    file: "apple-touch-icon.png",
    data: () => readFileSync(join(PUBLIC, "apple-touch-icon.png")),
  },
  {
    size: 256,
    file: "icon-256.png",
    data: () => readFileSync(join(PUBLIC, "icon-256.png")),
  },
  {
    size: 1024,
    file: "icon-1024.png",
    data: () => readFileSync(join(PUBLIC, "icon-1024.png")),
  },
];

function iconPage(theme: Theme): string {
  const figures = icons
    .map(
      ({ size, file, data }) =>
        `<figure><img src="data:image/png;base64,${data().toString("base64")}" width="${size}" height="${size}" alt=""><figcaption>${size} px · ${file}</figcaption></figure>`,
    )
    .join("");
  const page = theme === "dark" ? "#0b0f11" : "#e9edef";
  const ink = theme === "dark" ? "#c9d1d4" : "#2b3336";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Icon</title><style>
body { margin: 0; padding: 24px; background: ${page}; color: ${ink}; font: 13px/1.4 system-ui, sans-serif; }
h1 { margin: 0 0 16px; font-size: 20px; }
section { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 32px; margin-bottom: 16px; padding: 32px; border-radius: 12px; }
.light { background: #f4f6f7; color: #3b4448; }
.dark { background: #0f1416; color: #c9d1d4; }
figure { display: flex; flex-direction: column; align-items: center; gap: 8px; margin: 0; }
img { display: block; }
</style></head><body><h1>Scopearr icon · generated files in web/public</h1><section class="light">${figures}</section><section class="dark">${figures}</section></body></html>`;
}

test.describe("icon", () => {
  test.use({ viewport: desktop });
  for (const theme of themes) {
    test(`icon ${theme}`, async ({ page }) => {
      await page.setContent(iconPage(theme));
      const sizes = await page
        .locator("img")
        .evaluateAll((images) =>
          (images as HTMLImageElement[]).map((image) =>
            image.complete ? image.naturalWidth : 0,
          ),
        );
      const want = icons.map(({ size }) => size);
      expect(sizes, "each icon loads at its own size").toEqual([
        ...want,
        ...want,
      ]);
      await page.screenshot({
        path: join(OUT, `p4-1440-${theme}-icon.png`),
        fullPage: true,
        animations: "disabled",
      });
    });
  }
});
