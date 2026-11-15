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
  openRoute,
  pinReleaseCheck,
  RELEASE_CHECKED_AT,
  quickSearch,
  settingsSection,
  settle,
  syncPopover,
  TIME,
  filterDrawer,
  withAudioTracks,
  withListPrefs,
  withMoreValues,
  withOpenJobs,
  withRenameAvailable,
  withStatus,
  withTwoMovieInstances,
  type SettingsSection,
  type Theme,
} from "./app";
import {
  muxJobs,
  withFindings,
  withMuxJobs,
  withPlacement,
} from "./tool-fixtures";

// The client clock is fixed; timestamps from the server still move.
const NOW = "2026-11-06T09:41:00Z";

// The live release check of the demo server would make the settings shots
// depend on the network; every shot sees the baselines' "up to date".
test.beforeEach(async ({ page }) => {
  await pinReleaseCheck(page);
});

type Size = { width: number; height: number };
const sizes: Size[] = [
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
];
const themes: Theme[] = ["dark", "light"];

function volatile(page: Page): Locator[] {
  return [page.getByText(TIME), page.getByText(DATE), page.locator(".spin")];
}
// A library row's text joins its cells without spaces: a row of two
// tracks reads "… AC-3 5.15.15.1" across the audio and channels columns,
// which the date pattern takes for a date, so the whole row would be
// masked. The library's states mask clock text anywhere and dates only in
// the frame (the list shows none).
function libraryVolatile(page: Page): Locator[] {
  return [
    page.getByText(TIME),
    page.locator("#v2-sidebar, .v2-topbar").getByText(DATE),
    page.locator(".spin"),
  ];
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
async function snap(
  page: Page,
  name: string,
  {
    fullPage = true,
    mask,
    after,
  }: {
    fullPage?: boolean;
    mask?: Locator[];
    // A step after settling, which scrolls to the top (the save dock's
    // scrolled page).
    after?: () => Promise<void>;
  } = {},
) {
  await settle(page);
  await after?.();
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage,
    animations: "disabled",
    caret: "hide",
    maxDiffPixels: 0,
    threshold: 0.05,
    mask: mask ?? volatile(page),
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
  // Phase 5d, Task 6: File & metadata with the rename field open.
  "dialog-rename": async (page) => {
    await goTo(page, "movies");
    await page
      .getByRole("button", { name: "Filename and metadata: Arrival" })
      .click();
    await dialog(page, "File & metadata");
    const box = page.getByRole("dialog", { name: "File & metadata" });
    await box.getByRole("button", { name: "Rename file", exact: true }).click();
    await expect(box.getByRole("textbox", { name: "Filename" })).toBeFocused();
  },
  // Phase 5d, Task 8: the mux status of a ready job and, from its foot, its
  // options (the same path at every width; the row's Mux options button is
  // not on a phone).
  "dialog-mux-status": async (page) => {
    await goTo(page, "mux");
    await page
      .getByRole("row")
      .filter({ hasText: "Dune" })
      .getByRole("button", { name: /^Status: / })
      .click();
    await dialog(page, "Status");
    await expect(
      page
        .getByRole("dialog", { name: "Status" })
        .getByRole("button", { name: "Mux options", exact: true }),
    ).toBeVisible();
  },
  "dialog-mux-options": async (page) => {
    await views["dialog-mux-status"](page);
    await page
      .getByRole("dialog", { name: "Status" })
      .getByRole("button", { name: "Mux options", exact: true })
      .click();
    await dialog(page, "Mux options");
    await expect(
      page
        .getByRole("dialog", { name: "Mux options" })
        .getByRole("textbox", { name: "Track name" })
        .first(),
    ).toBeVisible();
  },
  "dialog-scan-placement": async (page) => {
    await goTo(page, "placement");
    await page
      .getByRole("main")
      .getByRole("button", { name: "Scan", exact: true })
      .click();
    await dialog(page, "Scan disk placement");
  },
  // Phase 5d, Task 5: a confirmation (reset, the secondary tone with its
  // icon) and the custom tags dialog of one file.
  "dialog-confirm": async (page) => {
    await openSettings(page, "Display");
    const tab = page
      .getByRole("tablist", { name: "Display sections" })
      .getByRole("tab", { name: "Lists & columns", exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    const movies = page.getByRole("tab", { name: "Movies", exact: true });
    await movies.click();
    await expect(movies).toHaveAttribute("aria-selected", "true");
    await page
      .getByRole("button", { name: "Reset order for Movies", exact: true })
      .click();
    await dialog(page, "Restore defaults");
  },
  "dialog-custom-tags": async (page) => {
    await goTo(page, "movies");
    await page
      .getByRole("button", { name: "Edit custom tags: Arrival", exact: true })
      .click();
    await dialog(page, "Custom tags");
    await expect(
      page
        .getByRole("dialog", { name: "Custom tags" })
        .getByRole("textbox", { name: "New tag" }),
    ).toBeVisible();
  },
};

// What a view needs before the app opens (a status from now on).
const viewFixtures: Record<string, (page: Page) => Promise<void>> = {
  "dialog-rename": withRenameAvailable,
  "dialog-mux-status": (page) => withMuxJobs(page),
  // Dune with a video and two audio tracks, so the track table has rows.
  "dialog-mux-options": (page) =>
    withMuxJobs(page, () =>
      muxJobs().map((job) =>
        job.title !== "Dune"
          ? job
          : ({
              ...job,
              source: {
                ...job.source,
                chapters: 12,
                tracks: [
                  {
                    id: 0,
                    type: "video",
                    codec: "HEVC",
                    dimensions: "3840x2160",
                  },
                  { id: 1, type: "audio", codec: "TrueHD", channels: "7.1" },
                  { id: 2, type: "audio", codec: "AC-3", channels: "5.1" },
                ],
              },
              spec: {
                ...job.spec,
                tracks: {
                  0: {
                    keep: true,
                    default: true,
                    forced: false,
                    language: "",
                    name: "",
                  },
                  1: {
                    keep: true,
                    default: true,
                    forced: false,
                    language: "en",
                    name: "Atmos",
                  },
                  2: {
                    keep: true,
                    default: false,
                    forced: false,
                    language: "de",
                    name: "",
                  },
                },
              },
            } as unknown as typeof job),
      ),
    ),
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

// System → Log with its filter drawer open (Phase 5c, task 9), its live
// count there.
test.describe("settings-log-drawer", () => {
  test.use({ viewport: sizes[0] });
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
  });
  for (const theme of themes) {
    const name = `settings-log-drawer-1440x900-${theme}`;
    test(name, async ({ page }) => {
      await openApp(page, { theme });
      await views["settings-system-log"](page);
      await page
        .getByRole("main")
        .getByRole("button", { name: "Filters", exact: true })
        .click();
      await expect(
        filterDrawer(page).getByRole("button", { name: /^Apply \(/ }),
      ).toBeVisible();
      await page.mouse.move(0, 0);
      await snap(page, name, { fullPage: false });
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

// The library's states (Phase 5a, Task 9): the filter drawer (1440 and
// 375), all columns, stacked audio tracks, the tracks popover of Arrival
// with four tracks and its track menu, compact rows, and the instance
// segment with two enabled movie instances.
const allColumns = (page: Page) =>
  page
    .getByRole("main")
    .getByRole("button", { name: "All columns", exact: true })
    .click();
const arrivalTrack = (page: Page) =>
  page
    .getByRole("row")
    .filter({ has: page.getByRole("checkbox", { name: "Select Arrival" }) });
const libraryStates: {
  name: string;
  sizes: Size[];
  fullPage: boolean;
  setup?(page: Page): Promise<void>;
  open(page: Page): Promise<void>;
}[] = [
  {
    name: "movies-drawer",
    sizes,
    fullPage: false,
    async open(page) {
      await page
        .getByRole("main")
        .getByRole("button", { name: "Filters", exact: true })
        .click();
      await expect(
        filterDrawer(page).getByRole("button", { name: /^Apply/ }),
      ).toHaveText("Apply (26 matches)");
      await page.mouse.move(0, 0);
    },
  },
  {
    name: "movies-all-columns",
    sizes: [sizes[0]],
    fullPage: true,
    async open(page) {
      await allColumns(page);
      await page.mouse.move(0, 0);
    },
  },
  {
    name: "movies-stacked",
    sizes: [sizes[0]],
    fullPage: true,
    setup: (page) => withListPrefs(page, { stacked: true }),
    async open(page) {
      await allColumns(page);
      await page.mouse.move(0, 0);
    },
  },
  {
    name: "movies-tracks-popover",
    sizes: [sizes[0]],
    fullPage: false,
    setup: withAudioTracks,
    async open(page) {
      await allColumns(page);
      await arrivalTrack(page)
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
    name: "movies-track-menu",
    sizes: [sizes[0]],
    fullPage: false,
    async open(page) {
      await allColumns(page);
      await arrivalTrack(page)
        .getByRole("button", {
          name: "Track 1 · German · DTS · 5.1 · Default track",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("menu", { name: "Filter by this track" }),
      ).toBeVisible();
      await page.mouse.move(0, 0);
    },
  },
  {
    name: "movies-compact",
    sizes: [sizes[0]],
    fullPage: true,
    setup: (page) => withListPrefs(page, { density: "compact" }),
    async open() {},
  },
  {
    name: "movies-instances",
    sizes: [sizes[0]],
    fullPage: true,
    setup: withTwoMovieInstances,
    async open(page) {
      await expect(
        page.getByRole("navigation", { name: "Instances" }).getByRole("link"),
      ).toHaveCount(3);
    },
  },
];

for (const state of libraryStates) {
  for (const size of state.sizes) {
    test.describe(`${state.name} ${size.width}x${size.height}`, () => {
      test.use({ viewport: size });
      test.beforeEach(async ({ page }) => {
        await page.clock.setFixedTime(NOW);
      });
      for (const theme of themes) {
        const name = `${state.name}-${size.width}x${size.height}-${theme}`;
        test(name, async ({ page }) => {
          await state.setup?.(page);
          await openApp(page, { theme });
          await views.movies(page);
          await state.open(page);
          await snap(page, name, {
            fullPage: state.fullPage,
            mask: libraryVolatile(page),
          });
        });
      }
    });
  }
}

// The tool pages' states (Phase 5b, Task 10) with the rows of the tool
// fixtures (the demo has none): Muxing's jobs, Disk placement's items with
// its disk row (two disks in standby) and Files & permissions' findings
// (1440 and 375), Disk placement's filter drawer and Muxing with its
// Failed KPI card pressed (1440).
const toolStates: {
  name: string;
  hash: string;
  sizes: Size[];
  fullPage: boolean;
  open?(page: Page): Promise<void>;
}[] = [
  { name: "mux-jobs", hash: "#/tools/mux", sizes, fullPage: true },
  { name: "placement-items", hash: "#/tools/placement", sizes, fullPage: true },
  { name: "files-findings", hash: "#/tools/files", sizes, fullPage: true },
  {
    name: "placement-drawer",
    hash: "#/tools/placement",
    sizes: [sizes[0]],
    fullPage: false,
    async open(page) {
      await page
        .getByRole("main")
        .getByRole("button", { name: "Filters", exact: true })
        .click();
      await expect(
        filterDrawer(page).getByRole("button", { name: /^Apply/ }),
      ).toHaveText("Apply (5 matches)");
      await page.mouse.move(0, 0);
    },
  },
  {
    name: "mux-kpi-failed",
    hash: "#/tools/mux",
    sizes: [sizes[0]],
    fullPage: true,
    async open(page) {
      const failed = page
        .getByRole("main")
        .getByRole("button", { name: "Failed 1", exact: true });
      await failed.click();
      await expect(failed).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.locator("table.v2-table--fixed > tbody > tr"),
      ).toHaveCount(1);
      await page.mouse.move(0, 0);
    },
  },
];

for (const state of toolStates) {
  for (const size of state.sizes) {
    test.describe(`${state.name} ${size.width}x${size.height}`, () => {
      test.use({ viewport: size });
      test.beforeEach(async ({ page }) => {
        await page.clock.setFixedTime(NOW);
      });
      for (const theme of themes) {
        const name = `${state.name}-${size.width}x${size.height}-${theme}`;
        test(name, async ({ page }) => {
          await withMuxJobs(page);
          await withPlacement(page, { standby: true });
          await withFindings(page);
          await openRoute(page, state.hash, { theme });
          await expect(
            page.locator("table.v2-table--fixed > tbody > tr").first(),
          ).toBeVisible({ timeout: 15_000 });
          await state.open?.(page);
          await snap(page, name, { fullPage: state.fullPage });
        });
      }
    });
  }
}

// The dashboard's Codec card with More open (Phase 5a, Task 11): its
// eight values, four of them beyond the demo's (withMoreValues).
test.describe("dashboard-more 1440x900", () => {
  test.use({ viewport: sizes[0] });
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
  });
  for (const theme of themes) {
    const name = `dashboard-more-1440x900-${theme}`;
    test(name, async ({ page }) => {
      await withMoreValues(page);
      await openApp(page, { theme });
      await views.dashboard(page);
      const main = page.getByRole("main");
      await main.getByRole("button", { name: "More", exact: true }).click();
      await expect(
        main.getByRole("button", { name: "Less", exact: true }),
      ).toBeVisible();
      await page.mouse.move(0, 0);
      await snap(page, name);
    });
  }
});

// Services on the tab of a library (Phase 5c, Task 5): the Radarr HD
// card of two enabled movie instances (the demo has none), its status
// first (1440 and 375).
for (const size of sizes) {
  test.describe(`settings-services-radarr ${size.width}x${size.height}`, () => {
    test.use({ viewport: size });
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(NOW);
    });
    for (const theme of themes) {
      const name = `settings-services-radarr-${size.width}x${size.height}-${theme}`;
      test(name, async ({ page }) => {
        await withTwoMovieInstances(page);
        // The demo's sync times move with the server's start; a fixed one
        // keeps the masked status line (and its mask) the same width.
        await withStatus(page, (status) => {
          for (const sync of Object.values(status.sync ?? {}) as {
            lastSuccess?: string;
          }[])
            if (sync.lastSuccess) sync.lastSuccess = RELEASE_CHECKED_AT;
        });
        await openApp(page, { theme });
        await openSettings(page, "Services");
        const tab = page
          .getByRole("tablist", { name: "Configured services" })
          .getByRole("tab", { name: "Radarr HD", exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(
          page.getByRole("tabpanel", { name: "Radarr HD" }),
        ).toBeVisible();
        await page.mouse.move(0, 0);
        await snap(page, name);
      });
    }
  });
}

// Display's other two sections (Phase 5c, Task 6) at 1440: Lists &
// columns (the Icons list, its preview and Audio tracks) and Colors (the
// warning and tag color tables).
for (const [section, label] of [
  ["lists", "Lists & columns"],
  ["colors", "Colors"],
] as const) {
  test.describe(`settings-display-${section} 1440x900`, () => {
    test.use({ viewport: sizes[0] });
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(NOW);
    });
    for (const theme of themes) {
      const name = `settings-display-${section}-1440x900-${theme}`;
      test(name, async ({ page }) => {
        await openApp(page, { theme });
        await openSettings(page, "Display");
        const tab = page
          .getByRole("tablist", { name: "Display sections" })
          .getByRole("tab", { name: label, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(page.locator("#display-panel-" + section)).toBeVisible();
        await page.mouse.move(0, 0);
        await snap(page, name);
      });
    }
  });
}

// New settings states (Phase 5c, Task 11) at 1440: the Unraid tab of
// Services (its status read once), Display with a stored band choice
// (seeded like movies-band-*: strong in dark, muted in light, each not
// the mode's default), and Services scrolled to its end with a draft,
// where the save dock stands (ruling R-D).
test.describe("settings states 1440x900", () => {
  test.use({ viewport: sizes[0] });
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
  });
  for (const theme of themes) {
    const name = `settings-services-unraid-1440x900-${theme}`;
    test(name, async ({ page }) => {
      await openApp(page, { theme });
      await openSettings(page, "Services");
      const tab = page
        .getByRole("tablist", { name: "Configured services" })
        .getByRole("tab", { name: /^Unraid/ });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(
        page.getByRole("tabpanel", { name: "Unraid" }),
      ).toBeVisible();
      await page.mouse.move(0, 0);
      await snap(page, name);
    });
  }
  for (const [band, theme] of [
    ["strong", "dark"],
    ["muted", "light"],
  ] as const) {
    const name = `settings-display-band-${band}-1440x900-${theme}`;
    test(name, async ({ page }) => {
      await page.addInitScript((value) => {
        try {
          localStorage.setItem("scopearr-band", value);
        } catch {
          // Storage can be blocked; the default band is then used.
        }
      }, band);
      await openApp(page, { theme });
      await openSettings(page, "Display");
      await expect(page.locator("html")).toHaveAttribute("data-band", band);
      await expect(
        page
          .getByRole("radiogroup", { name: "Accent band", exact: true })
          .getByRole("radio", { name: band === "strong" ? "Strong" : "Muted" }),
      ).toBeChecked();
      await page.mouse.move(0, 0);
      await snap(page, name);
    });
  }
  for (const theme of themes) {
    const name = `settings-save-dock-1440x900-${theme}`;
    test(name, async ({ page }) => {
      await openApp(page, { theme });
      await openSettings(page, "Services");
      await page.getByLabel("Sync timezone", { exact: true }).fill("UTC");
      await page.mouse.move(0, 0);
      await snap(page, name, {
        fullPage: false,
        after: async () => {
          await page.evaluate(() =>
            window.scrollTo(0, document.documentElement.scrollHeight),
          );
          await expect(
            page.locator(".v2-save-dock").getByRole("button", {
              name: "Save settings",
            }),
          ).toBeVisible();
          await page.evaluate(
            () => new Promise((done) => requestAnimationFrame(done)),
          );
        },
      });
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
          await viewFixtures[name]?.(page);
          await openApp(page, { theme });
          await show(page);
          await snap(page, `${name}-${variant}`);
        });
      }
    });
  }
}
