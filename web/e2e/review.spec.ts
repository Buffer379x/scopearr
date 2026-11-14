// Comparison captures for design reviews (project `review`, local only, not
// in CI): the views of the approved C+ preview
// (work/2.0.0/preview/screens/cplus-*) as the app draws them, saved as
// <prefix>-<width>-<mode>-<view>.png in SCOPEARR_REVIEW_DIR. Nothing is
// compared; each capture uses the crop of the C+ capture of the same name
// (viewport or full page). A test fails on any console error or uncaught
// exception.
//
// The captures come in groups, one per phase: p4 (the frame, Phase 4),
// p5a (dashboard and libraries, Phase 5a) and p5b (the tool pages, Phase
// 5b) and p5c (the settings areas, Phase 5c). SCOPEARR_REVIEW_ONLY picks the groups to take, comma separated
// (unset: all). The Phase 4 files keep their p4- prefix;
// SCOPEARR_REVIEW_PREFIX names the files of the p5a and p5b groups
// (default: the group's name), so a later phase can take them again under
// its own name. With a prefix, take each group in a run of its own
// (SCOPEARR_REVIEW_ONLY=p5a, then p5b, each with its own prefix): the
// groups share view names, so one prefix over both would overwrite one
// group's files with the other's.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CPLUS_COLUMNS,
  filterDrawer,
  goTo,
  inLanguage,
  jobsMenu,
  mainNavigation,
  openApp,
  openRoute,
  pinReleaseCheck,
  quickSearch,
  settingsSection,
  settle,
  storageArea,
  syncPopover,
  withAudioTracks,
  withColumns,
  withListPrefs,
  withOpenJobs,
  withStorageAreas,
  withTwoMovieInstances,
  type SettingsSection,
  type Theme,
  type View,
} from "./app";
import { withFindings, withMuxJobs, withPlacement } from "./tool-fixtures";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(
  process.env.SCOPEARR_REVIEW_DIR || join(here, "..", "test-results", "review"),
);
// The client clock is fixed as in the pixel run.
const NOW = "2026-11-06T09:41:00Z";
const themes: Theme[] = ["dark", "light"];

const GROUPS = ["p4", "p5a", "p5b", "p5c"];
const only = (process.env.SCOPEARR_REVIEW_ONLY ?? "")
  .split(",")
  .map((group) => group.trim())
  .filter(Boolean);
for (const group of only)
  if (!GROUPS.includes(group))
    throw new Error(
      `SCOPEARR_REVIEW_ONLY: unknown group ${group} (known: ${GROUPS.join(", ")})`,
    );
const runs = (group: string) => only.length === 0 || only.includes(group);
const prefixOf = (group: string) => process.env.SCOPEARR_REVIEW_PREFIX || group;
const PREFIX = prefixOf("p5a");

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
  // As in the pixel run: no capture depends on the live release check.
  await pinReleaseCheck(page);
});

test.afterEach(async ({ page }) => {
  expect(problems.get(page), "console errors").toEqual([]);
});

// Saves <prefix>-<name>.png. A full-page capture resizes the view, and a
// resize closes the frame's flyout and popovers; open states use the
// viewport.
async function shoot(
  page: Page,
  name: string,
  { fullPage = false, prefix = "p4" } = {},
) {
  await settle(page);
  await page.screenshot({
    path: join(OUT, `${prefix}-${name}.png`),
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

// The palette is a server setting: saved for the capture and restored
// afterwards, also when the capture fails. The same two captures in each
// group, under its prefix. They run one after the other (serial), whatever
// the worker count, so no capture sees the other's palette (final review
// T14-c).
function paletteCaptures(prefix: string) {
  test.describe("palettes", () => {
    test.describe.configure({ mode: "serial" });
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
          await shoot(page, `1440-${theme}-${palette}-movies`, { prefix });
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
}

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

if (runs("p4")) {
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

  paletteCaptures("p4");

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
}

// Phase 5a: the dashboard, the libraries and the two list preferences in
// Display, each against the C+ capture of the same name. The dashboard
// shows two storage areas (the demo selects no storage paths); "tracks"
// and "tracks-stacked" show the C+ column set, with Arrival's four audio
// tracks (no demo file has three or more); "movies-4k" shows two enabled
// movie instances with Radarr 4K chosen in the segment.
const displayTabs = (page: Page) =>
  page.getByRole("tablist", { name: "Display sections" });
const arrival = (page: Page) =>
  page
    .getByRole("row")
    .filter({ has: page.getByRole("checkbox", { name: "Select Arrival" }) });

async function withStorage(page: Page) {
  await withStorageAreas(page, {
    all: [storageArea("movies", 9.3), storageArea("series", 3)],
    radarr: [storageArea("movies", 9.3)],
    sonarr: [storageArea("series", 3)],
  });
}

// The files of Radarr 4K are the demo's 2160p movies: the demo server
// knows only the instance radarr, so a list of radarr-4k asks for those
// and answers them as files of Radarr 4K.
async function withFourKFiles(page: Page) {
  await page.route(/\/api\/files\?/, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("instance") !== "radarr-4k")
      return route.continue();
    url.searchParams.set("instance", "radarr");
    if (!url.searchParams.has("resolution"))
      url.searchParams.set("resolution", "2160p");
    const response = await route.fetch({ url: url.toString() });
    const body = await response.json();
    for (const file of body.files ?? []) {
      file.service = "radarr-4k";
      if ("instanceName" in file) file.instanceName = "Radarr 4K";
    }
    await route.fulfill({ response, json: body });
  });
}

const libraryViews: {
  name: string;
  fullPage: boolean;
  setup?(page: Page): Promise<void>;
  open(page: Page, theme: Theme): Promise<void>;
}[] = [
  {
    name: "dashboard",
    fullPage: true,
    setup: withStorage,
    async open(page, theme) {
      await openApp(page, { theme });
      await show(page, "dashboard");
    },
  },
  {
    name: "movies",
    fullPage: false,
    async open(page, theme) {
      await openApp(page, { theme });
      await show(page, "movies");
    },
  },
  {
    name: "series",
    fullPage: false,
    async open(page, theme) {
      await openApp(page, { theme });
      await show(page, "series");
    },
  },
  {
    // The drawer with one filter applied (resolution 2160p) and its
    // values open, as in C+.
    name: "movies-filter",
    fullPage: false,
    async open(page, theme) {
      await openRoute(page, "#/movies?resolution=2160p", { theme });
      await page
        .getByRole("main")
        .getByRole("button", { name: /^Filters/ })
        .click();
      const drawer = filterDrawer(page);
      const resolution = drawer.getByRole("button", {
        name: /^Resolution /,
      });
      await expect(resolution).toHaveAccessibleName("Resolution 2160p");
      await resolution.click();
      const values = drawer.locator(
        `#${await resolution.getAttribute("aria-controls")}`,
      );
      await expect(
        values.getByRole("checkbox", { name: "2160p", exact: true }),
      ).toBeChecked();
      await expect(values).not.toHaveAttribute("aria-busy", "true");
      await expect(drawer.getByRole("button", { name: /^Apply/ })).toHaveText(
        /^Apply \(\d+ match/,
      );
      await page.mouse.move(0, 0);
    },
  },
  {
    name: "tracks",
    fullPage: false,
    async setup(page) {
      await withColumns(page, CPLUS_COLUMNS);
      await withAudioTracks(page);
    },
    async open(page, theme) {
      await openApp(page, { theme });
      await show(page, "movies");
      await arrival(page)
        .getByRole("button", {
          name: "+2 · Show all 4 audio tracks",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Audio tracks of Arrival" }),
      ).toBeVisible();
      await page.mouse.move(0, 0);
    },
  },
  {
    name: "tracks-stacked",
    fullPage: false,
    async setup(page) {
      await withColumns(page, CPLUS_COLUMNS);
      await withAudioTracks(page);
      await withListPrefs(page, { stacked: true });
    },
    async open(page, theme) {
      await openApp(page, { theme });
      await show(page, "movies");
      // Arrival's four tracks, each on a line of its own.
      const row = arrival(page);
      await expect(row.locator(".v2-trk-stack")).toHaveCount(1);
      await expect(row.getByRole("button", { name: /^Track \d/ })).toHaveCount(
        4,
      );
    },
  },
  {
    // Display → Lists & columns → Movies, as in C+, with "Show audio
    // tracks stacked".
    name: "columns",
    fullPage: true,
    async open(page, theme) {
      await openApp(page, { theme });
      await goTo(page, "settings");
      await settingsSection(page, "Display");
      const tab = displayTabs(page).getByRole("tab", {
        name: "Lists & columns",
        exact: true,
      });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      const movies = page
        .getByRole("tablist", { name: "Lists & columns" })
        .getByRole("tab", { name: "Movies", exact: true });
      await movies.click();
      await expect(movies).toHaveAttribute("aria-selected", "true");
      await expect(
        page.getByRole("checkbox", {
          name: "Show audio tracks stacked",
          exact: true,
        }),
      ).toBeVisible();
    },
  },
  {
    // Display → General, with "Row density".
    name: "display",
    fullPage: true,
    async open(page, theme) {
      await openApp(page, { theme });
      await goTo(page, "settings");
      await settingsSection(page, "Display");
      await expect(
        displayTabs(page).getByRole("tab", { name: "General", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        page.getByRole("combobox", { name: "Row density", exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: "movies-4k",
    fullPage: false,
    async setup(page) {
      await withTwoMovieInstances(page);
      await withFourKFiles(page);
    },
    async open(page, theme) {
      await openApp(page, { theme });
      await show(page, "movies");
      const segment = page.getByRole("navigation", { name: "Instances" });
      await segment
        .getByRole("link", { name: "Radarr 4K", exact: true })
        .click();
      await expect(
        segment.getByRole("link", { name: "Radarr 4K", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await page.mouse.move(0, 0);
    },
  },
];

// Other widths: 1600 with the sidebar expanded, 820 (tablet) and 375. The
// phone's movies are its viewport (the tab bar at its bottom), as the C+
// crop is (final review T14-a); a full page of 26 cards put the fixed tab
// bar mid-page.
const sizedViews: {
  size: Size;
  view: "dashboard" | "movies";
  fullPage: boolean;
}[] = [
  { size: wide, view: "movies", fullPage: false },
  { size: tablet, view: "movies", fullPage: true },
  { size: tablet, view: "dashboard", fullPage: true },
  { size: phone, view: "dashboard", fullPage: true },
  { size: phone, view: "movies", fullPage: false },
];

if (runs("p5a")) {
  test.describe("p5a", () => {
    for (const theme of themes) {
      test.describe(`1440 ${theme}`, () => {
        test.use({ viewport: desktop });
        for (const { name, fullPage, setup, open } of libraryViews) {
          test(name, async ({ page }) => {
            await setup?.(page);
            await open(page, theme);
            await shoot(page, `1440-${theme}-${name}`, {
              fullPage,
              prefix: PREFIX,
            });
          });
        }
      });

      for (const { size, view, fullPage } of sizedViews) {
        test.describe(`${size.width} ${theme}`, () => {
          test.use({ viewport: size });
          test(view, async ({ page }) => {
            if (view === "dashboard") await withStorage(page);
            await openApp(page, { theme });
            await show(page, view);
            if (size === wide)
              await expect(page.locator("#v2-sidebar")).toHaveAttribute(
                "data-mode",
                "expanded",
              );
            await shoot(page, `${size.width}-${theme}-${view}`, {
              fullPage,
              prefix: PREFIX,
            });
          });
        });
      }
    }

    paletteCaptures(PREFIX);
  });
}

// Phase 5b: the three tool pages filled with the rows of the tool fixtures
// (the demo has none), as the pixel states of Task 10 show them: Muxing's
// jobs (one per status), Disk placement's items with its disk row (two
// disks in standby) and Files & permissions' findings. No capture shows a
// loading state. At 1440 each uses the viewport, as C+ cplus-1440-*-mux
// and -placement do (files and placement-filter have no C+ capture); 1600
// shows the sidebar expanded, 820 and 375 the whole page. The extra
// captures in de (Muxing and Files at 375: the KPI wrap, "Fehlgeschlagen")
// and it (the disk cards at 820 and 375: cut text) are for the review
// only, in dark, with the language as a suffix.
const toolHash = {
  mux: "#/tools/mux",
  placement: "#/tools/placement",
  files: "#/tools/files",
} as const;
type Tool = keyof typeof toolHash;

async function openTool(page: Page, tool: Tool, theme: Theme) {
  await withMuxJobs(page);
  await withPlacement(page, { standby: true });
  await withFindings(page);
  await openRoute(page, toolHash[tool], { theme });
  await expect(
    page.locator("table.v2-table--fixed > tbody > tr").first(),
  ).toBeVisible({ timeout: 15_000 });
}

const toolViews: {
  size: Size;
  tool: Tool;
  name?: string;
  fullPage: boolean;
  open?(page: Page): Promise<void>;
}[] = [
  { size: desktop, tool: "mux", fullPage: false },
  { size: desktop, tool: "placement", fullPage: false },
  { size: desktop, tool: "files", fullPage: false },
  {
    // The drawer open with "Several disks" checked in the draft, not
    // applied: Apply counts the draft's three items.
    size: desktop,
    tool: "placement",
    name: "placement-filter",
    fullPage: false,
    async open(page) {
      await page
        .getByRole("main")
        .getByRole("button", { name: "Filters", exact: true })
        .click();
      const drawer = filterDrawer(page);
      const apply = drawer.getByRole("button", { name: /^Apply/ });
      await expect(apply).toHaveText("Apply (5 matches)");
      const several = drawer.getByRole("checkbox", { name: /^Several disks/ });
      await several.check();
      await expect(several).toBeChecked();
      await expect(apply).toHaveText("Apply (3 matches)");
      await page.mouse.move(0, 0);
    },
  },
  { size: wide, tool: "placement", fullPage: false },
  { size: tablet, tool: "placement", fullPage: true },
  { size: phone, tool: "mux", fullPage: true },
  { size: phone, tool: "placement", fullPage: true },
  { size: phone, tool: "files", fullPage: true },
];

const toolLanguageViews: { size: Size; tool: Tool; language: string }[] = [
  { size: phone, tool: "mux", language: "de" },
  { size: phone, tool: "files", language: "de" },
  { size: tablet, tool: "placement", language: "it" },
  { size: phone, tool: "placement", language: "it" },
];

if (runs("p5b")) {
  test.describe("p5b", () => {
    const prefix = prefixOf("p5b");
    for (const theme of themes) {
      for (const { size, tool, name = tool, fullPage, open } of toolViews) {
        test.describe(`${size.width} ${theme}`, () => {
          test.use({ viewport: size });
          test(name, async ({ page }) => {
            await openTool(page, tool, theme);
            if (size === wide)
              await expect(page.locator("#v2-sidebar")).toHaveAttribute(
                "data-mode",
                "expanded",
              );
            await open?.(page);
            await shoot(page, `${size.width}-${theme}-${name}`, {
              fullPage,
              prefix,
            });
          });
        });
      }
    }

    for (const { size, tool, language } of toolLanguageViews) {
      test.describe(`${size.width} dark ${language}`, () => {
        test.use({ viewport: size });
        test(`${tool}-${language}`, async ({ page }) => {
          await inLanguage(page, language);
          await openTool(page, tool, "dark");
          await expect(page.locator("html")).toHaveAttribute("lang", language);
          await shoot(page, `${size.width}-dark-${tool}-${language}`, {
            fullPage: true,
            prefix,
          });
        });
      });
    }
  });
}

// Phase 5c: the six settings areas, each against the C+ capture of the same
// name. Services shows Radarr with two instances (withTwoMovieInstances) and
// the MKVToolNix card; Display has its General, Lists & columns (Movies)
// and Colors tabs; System has Info and Log. All are whole pages; at 375 the
// Status section is scrolled into view before the capture.
const settingsTabs = (page: Page, name: string) =>
  page.getByRole("tablist", { name, exact: true });

async function openServices(page: Page, theme: Theme, service?: RegExp) {
  await withTwoMovieInstances(page);
  await openApp(page, { theme });
  await show(page, "settings");
  const tab = settingsTabs(page, "Configured services").getByRole("tab", {
    name: service ?? /^Radarr/,
  });
  await tab.first().click();
  await expect(tab.first()).toHaveAttribute("aria-selected", "true");
  await page.mouse.move(0, 0);
}

async function openDisplay(page: Page, theme: Theme, tabName?: string) {
  await openApp(page, { theme });
  await goTo(page, "settings");
  await settingsSection(page, "Display");
  if (tabName) {
    const tab = settingsTabs(page, "Display sections").getByRole("tab", {
      name: tabName,
      exact: true,
    });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    if (tabName === "Lists & columns") {
      const movies = settingsTabs(page, "Lists & columns").getByRole("tab", {
        name: "Movies",
        exact: true,
      });
      await movies.click();
      await expect(movies).toHaveAttribute("aria-selected", "true");
    }
  }
  await page.mouse.move(0, 0);
}

async function openArea(page: Page, theme: Theme, section: SettingsSection) {
  await openApp(page, { theme });
  await goTo(page, "settings");
  await settingsSection(page, section);
  await page.mouse.move(0, 0);
}

async function openSystem(page: Page, theme: Theme, tabName?: "Log") {
  await openArea(page, theme, "System");
  if (tabName) {
    const tab = settingsTabs(page, "System sections").getByRole("tab", {
      name: tabName,
      exact: true,
    });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await page.mouse.move(0, 0);
  }
}

const settingsViews: {
  size: Size;
  name: string;
  open(page: Page, theme: Theme): Promise<void>;
}[] = [
  { size: desktop, name: "services-arr", open: (p, t) => openServices(p, t) },
  {
    size: desktop,
    name: "services-mux",
    open: (p, t) => openServices(p, t, /^MKVToolNix/),
  },
  { size: desktop, name: "display", open: (p, t) => openDisplay(p, t) },
  {
    size: desktop,
    name: "columns",
    open: (p, t) => openDisplay(p, t, "Lists & columns"),
  },
  {
    size: desktop,
    name: "colors",
    open: (p, t) => openDisplay(p, t, "Colors"),
  },
  { size: desktop, name: "widgets", open: (p, t) => openArea(p, t, "Widgets") },
  {
    size: desktop,
    name: "custom",
    open: (p, t) => openArea(p, t, "Custom tags"),
  },
  { size: desktop, name: "rules", open: (p, t) => openArea(p, t, "Tag rules") },
  { size: desktop, name: "system", open: (p, t) => openSystem(p, t) },
  { size: desktop, name: "log", open: (p, t) => openSystem(p, t, "Log") },
  { size: wide, name: "services-arr", open: (p, t) => openServices(p, t) },
  { size: tablet, name: "display", open: (p, t) => openDisplay(p, t) },
  { size: phone, name: "services", open: (p, t) => openServices(p, t) },
  { size: phone, name: "display", open: (p, t) => openDisplay(p, t) },
  { size: phone, name: "system", open: (p, t) => openSystem(p, t) },
];

if (runs("p5c")) {
  test.describe("p5c", () => {
    const prefix = prefixOf("p5c");
    for (const theme of themes) {
      for (const { size, name, open } of settingsViews) {
        test.describe(`${size.width} ${theme}`, () => {
          test.use({ viewport: size });
          test(name, async ({ page }) => {
            await open(page, theme);
            if (size === wide)
              await expect(page.locator("#v2-sidebar")).toHaveAttribute(
                "data-mode",
                "expanded",
              );
            // A full page puts the fixed tab bar mid-page, over the
            // Status section; the phone captures leave it out.
            if (size === phone)
              await page.addStyleTag({
                content: ".v2-tabbar { display: none !important; }",
              });
            await shoot(page, `${size.width}-${theme}-${name}`, {
              fullPage: true,
              prefix,
            });
          });
        });
      }
    }
  });
}
