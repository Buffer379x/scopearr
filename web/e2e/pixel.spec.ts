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
  jobsMenu,
  mainNavigation,
  openApp,
  quickSearch,
  settingsSection,
  settle,
  syncPopover,
  TIME,
  withOpenJobs,
  withTwoMovieInstances,
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
// absorbs it). The same threshold holds for every shot: the sign-in page
// draws its icon from the SVG master since Task 15, not from downscaled
// PNGs that Chromium resampled one of two ways from run to run.

// A full-page capture resizes the view, and a resize closes the frame's
// flyout and popovers; open states are therefore captured in the viewport.
async function snap(page: Page, name: string, { fullPage = true } = {}) {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage,
    animations: "disabled",
    caret: "hide",
    maxDiffPixels: 0,
    threshold: 0.05,
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

// The sync popover open from its trigger, with the pointer moved off the
// frame (no hover on the trigger).
async function openSync(page: Page, trigger: Locator) {
  await trigger.click();
  await expect(syncPopover(page)).toBeVisible();
  await page.mouse.move(0, 0);
}

// The frame's open states on the dashboard: the rail's Settings flyout
// under a resting pointer, the drawer and the tab bar's Tools menu (Task
// 10); the sync popover from the chip (rail), the card (expanded) and the
// drawer row, with two enabled movie instances (Task 11; the demo has none);
// the bell's jobs menu with open jobs, loaded (Task 12; the demo has none);
// quick search with pages, movies and TV series for "da" (Task 13).
const openStates: {
  name: string;
  size: Size;
  instances?: boolean;
  jobs?: boolean;
  open(page: Page): Promise<void>;
}[] = [
  {
    name: "frame-flyout",
    size: { width: 1440, height: 900 },
    async open(page) {
      await mainNavigation(page)
        .getByRole("button", { name: "Settings", exact: true })
        .hover();
      await expect(page.locator("#v2-fly")).toHaveAttribute("data-open", "");
    },
  },
  {
    name: "frame-drawer",
    size: { width: 375, height: 812 },
    async open(page) {
      await mainNavigation(page)
        .getByRole("button", { name: "More", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Main navigation" }),
      ).toBeVisible();
    },
  },
  {
    name: "frame-tools-menu",
    size: { width: 375, height: 812 },
    async open(page) {
      await mainNavigation(page)
        .getByRole("button", { name: "Tools", exact: true })
        .click();
      await expect(page.getByRole("menu", { name: "Tools" })).toBeVisible();
    },
  },
  {
    name: "frame-sync",
    size: { width: 1440, height: 900 },
    instances: true,
    open: (page) =>
      openSync(page, page.getByRole("banner").locator(".v2-sync-chip")),
  },
  {
    name: "frame-sync",
    size: { width: 1600, height: 900 },
    instances: true,
    open: (page) => openSync(page, page.locator("#v2-sidebar .v2-sync--card")),
  },
  {
    name: "frame-sync",
    size: { width: 375, height: 812 },
    instances: true,
    async open(page) {
      await mainNavigation(page)
        .getByRole("button", { name: "More", exact: true })
        .click();
      await openSync(page, page.locator("#v2-sidebar .v2-sync--row"));
    },
  },
  {
    name: "frame-jobs",
    size: { width: 1440, height: 900 },
    jobs: true,
    async open(page) {
      await page
        .getByRole("banner")
        .getByRole("button", { name: /open jobs/ })
        .click();
      // The loaded jobs, not their placeholders.
      await expect(
        jobsMenu(page).locator(".v2-job:not([aria-hidden])"),
      ).toHaveCount(6);
      await page.mouse.move(0, 0);
    },
  },
  {
    name: "frame-search",
    size: { width: 1440, height: 900 },
    async open(page) {
      await page
        .getByRole("banner")
        .getByRole("button", { name: "Quick search", exact: true })
        .click();
      const dialog = quickSearch(page);
      await page.keyboard.type("da");
      // Its titles have arrived; the pointer rests on the backdrop.
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

for (const state of openStates) {
  test.describe(state.name, () => {
    test.use({ viewport: state.size });
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(NOW);
    });
    for (const theme of themes) {
      const name = `${state.name}-${state.size.width}x${state.size.height}-${theme}`;
      test(name, async ({ page }) => {
        if (state.instances) await withTwoMovieInstances(page);
        if (state.jobs) await withOpenJobs(page);
        await openApp(page, { theme });
        await state.open(page);
        await snap(page, name, { fullPage: false });
      });
    }
  });
}

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
