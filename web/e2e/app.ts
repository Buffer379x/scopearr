// Shared helpers for driving the demo like a user.
// Views have hash routes (#/…) since 2.0.0, but tests reach them through the
// visible navigation like a user; openRoute starts on a route instead. The
// navigation is the frame's: the sidebar from 740px (with its flyouts in the
// rail), the tab bar and the drawer on phones.
import {
  expect,
  test,
  type Browser,
  type ElementHandle,
  type Locator,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import {
  finding,
  muxJob,
  withFindings,
  withMuxJobs,
  withPlacement,
} from "./tool-fixtures";

export type Theme = "dark" | "light";
export type View =
  | "dashboard"
  | "movies"
  | "series"
  | "mux"
  | "placement"
  | "files"
  | "settings";

// Names come from web/src/locales/en.json.
const headings: Record<View, string> = {
  dashboard: "Dashboard",
  movies: "Movie library",
  series: "TV library",
  mux: "Muxing",
  placement: "Disk placement",
  files: "Files & permissions",
  // The settings open on Services, titled by its area (ruling R-B).
  settings: "Services",
};
const tools: Partial<Record<View, string>> = {
  mux: "Muxing",
  placement: "Disk placement",
  files: "Files & permissions",
};
const links: Partial<Record<View, string>> = {
  dashboard: "Dashboard",
  movies: "Movies",
  series: "TV series",
};

// Text that moves between runs: clock times and dates. The pixel run masks
// elements with this text; the DOM fingerprint masks the text nodes.
export const TIME = /\b\d{1,2}:\d{2}\b/;
export const DATE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/;

export const settingsSections = [
  "Services",
  "Display",
  "Widgets",
  "Custom tags",
  "Tag rules",
  "System",
] as const;
export type SettingsSection = (typeof settingsSections)[number];

// Views switch without a page load, so Playwright's "networkidle" state is
// reached once and never again. Requests are counted per page instead.
const QUIET_MS = 500;
const traffic = new WeakMap<Page, { open: number; last: number }>();

function trackRequests(page: Page) {
  if (traffic.has(page)) return;
  const state = { open: 0, last: Date.now() };
  traffic.set(page, state);
  const done = () => {
    state.open = Math.max(0, state.open - 1);
    state.last = Date.now();
  };
  page.on("request", () => {
    state.open += 1;
    state.last = Date.now();
  });
  page.on("requestfinished", done);
  page.on("requestfailed", done);
}

// Waits until no request is open and none started for QUIET_MS. The
// quiet window also covers the 180 ms delay before a list request starts.
// It scrolls nothing (settle does).
export async function networkQuiet(page: Page) {
  const state = traffic.get(page);
  const started = Date.now();
  if (!state) return;
  // Quiet counts from the later of the last request and this call, so a
  // request that has not started yet is still waited for.
  const quiet = () => Date.now() - Math.max(state.last, started);
  await expect
    .poll(() => state.open === 0 && quiet() >= QUIET_MS, {
      message: "network did not go quiet",
      intervals: [100],
    })
    .toBe(true);
}

// Waits until requests and web fonts are done so geometry no longer moves,
// and scrolls to the top.
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await networkQuiet(page);
  const font = await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    // The face named by --font, as fontsReady in main.tsx loads it. A
    // capture with the fallback stack would record wrong glyph widths.
    const family = getComputedStyle(document.documentElement)
      .getPropertyValue("--font")
      .trim();
    return {
      family,
      loaded: !!family && document.fonts.check("1em " + family),
    };
  });
  expect(
    font.loaded,
    `the v2 typeface did not load before settling (--font: ${font.family || "unset"})`,
  ).toBe(true);
}

export async function openApp(
  page: Page,
  { theme = "dark" }: { theme?: Theme } = {},
) {
  await openRoute(page, "", { theme });
}

// Like openApp, but the page loads with a hash route such as "#/movies".
export async function openRoute(
  page: Page,
  hash: string,
  { theme = "dark" }: { theme?: Theme } = {},
) {
  await page.addInitScript((value) => {
    try {
      localStorage.setItem("scopearr-theme", value);
    } catch {
      // Storage can be blocked; the default theme is then used.
    }
  }, theme);
  trackRequests(page);
  await page.goto("/" + hash);
  await expect(page.locator("main h1").first()).toBeVisible();
  await settle(page);
}

export function currentHash(page: Page): Promise<string> {
  return page.evaluate(() => location.hash);
}

export function historyLength(page: Page): Promise<number> {
  return page.evaluate(() => history.length);
}

// The visible main navigation: the sidebar from 740px, the tab bar below
// (the closed drawer and the hidden tab bar are not in the page's tree).
export function mainNavigation(page: Page): Locator {
  return page.getByRole("navigation", { name: "Main navigation" });
}

async function sidebarMode(page: Page) {
  return page.locator("#v2-sidebar").getAttribute("data-mode");
}

// Moves the pointer off the frame, so no hover state or flyout stays behind.
async function rest(page: Page) {
  await page.mouse.move(0, 0);
}

export async function goTo(page: Page, view: View) {
  const nav = mainNavigation(page);
  if (view === "settings") {
    await (await sectionLink(page, "Services")).click();
  } else if (tools[view] && (await sidebarMode(page)) === "drawer") {
    // The tab bar's Tools menu.
    await nav.getByRole("button", { name: "Tools", exact: true }).click();
    await page
      .getByRole("menu", { name: "Tools" })
      .getByRole("menuitem", { name: tools[view], exact: true })
      .click();
  } else {
    await nav
      .getByRole("link", { name: tools[view] ?? links[view], exact: true })
      .click();
  }
  await expect(
    page.getByRole("heading", { level: 1, name: headings[view], exact: true }),
  ).toBeVisible();
  await rest(page);
  await settle(page);
}

// The link of a settings area in the Settings group: the rail's flyout,
// the expanded group, or the group in the drawer (More) on phones.
export async function sectionLink(
  page: Page,
  name: SettingsSection,
): Promise<Locator> {
  const mode = await sidebarMode(page);
  let scope = mainNavigation(page);
  if (mode === "drawer") {
    await scope.getByRole("button", { name: "More", exact: true }).click();
    scope = page.getByRole("dialog", { name: "Main navigation" });
  }
  const group = scope.getByRole("button", { name: "Settings", exact: true });
  if (mode === "rail") {
    // A click always opens the flyout.
    await group.click();
    scope = page.getByRole("group", { name: "Settings" });
  } else if ((await group.getAttribute("aria-expanded")) !== "true") {
    await group.click();
  }
  return scope.getByRole("link", { name, exact: true });
}

// The shown settings area: the current breadcrumb from 740px; on phones,
// which have no breadcrumbs, the current entry of the (closed) drawer.
export async function expectSection(page: Page, name: SettingsSection) {
  const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  const current = (await crumbs.isVisible())
    ? crumbs.locator('[aria-current="page"]')
    : page.locator('#v2-sidebar a[aria-current="page"]');
  await expect(current).toHaveText(name);
}

export async function settingsSection(page: Page, name: SettingsSection) {
  await (await sectionLink(page, name)).click();
  await expectSection(page, name);
  await rest(page);
  await settle(page);
}

// Waits for the "Really cancel?" dialog and answers it.
export async function answerDiscard(
  page: Page,
  answer: "Cancel" | "Discard changes",
) {
  const dialog = page.getByRole("dialog", { name: "Really cancel?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: answer, exact: true }).click();
  await expect(dialog).toBeHidden();
}

// Whether a cancelable beforeunload event is held back by the page. A plain
// Event would treat `returnValue = ""` as cancelling, so the browser's own
// BeforeUnloadEvent is used: it asks only when cancelled or given a message.
export function leaveIsBlocked(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const event = document.createEvent("BeforeUnloadEvent");
    event.initEvent("beforeunload", false, true);
    window.dispatchEvent(event);
    return event.defaultPrevented || event.returnValue !== "";
  });
}

export async function rect(page: Page, selector: string): Promise<DOMRect> {
  const box = await page.evaluate((query) => {
    const element = document.querySelector(query);
    return element ? element.getBoundingClientRect().toJSON() : null;
  }, selector);
  if (!box) throw new Error(`No element matches ${selector}`);
  return box as DOMRect;
}

// The top of the page's surface: its first block, which stands on the band
// itself (the setup notice or the first card).
export async function surfaceTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const first = document.querySelector(".v2-view")!.firstElementChild;
    if (!first) throw new Error("the page has no content");
    return first.getBoundingClientRect().top;
  });
}

export async function pageOverflowX(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
}

// A fresh context with a touch screen and the project's sign-in.
export async function touchPage(
  browser: Browser,
  size: { width: number; height: number },
  { isMobile = false } = {},
): Promise<Page> {
  const { baseURL, storageState, locale, timezoneId } = test.info().project.use;
  const context = await browser.newContext({
    baseURL,
    storageState,
    locale,
    timezoneId,
    viewport: size,
    hasTouch: true,
    isMobile,
    reducedMotion: "reduce",
  });
  return context.newPage();
}

// The targets of `query` that a touch reaches and that stay below 44 × 44
// (a box, or an invisible ::after hit area centered on it), visible and
// not inert, as "name: w×h". `checked` counts the visible targets that
// also match `counted` (the state's own region), so a selector that
// matches nothing fails instead of passing. With `fields`, content hidden
// from assistive technology is skipped and a field inside a label counts
// with its label (the lists); the frame counts every target as it is.
export function smallTargets(
  page: Page,
  query: string,
  {
    counted = "*",
    fields = false,
  }: { counted?: string; fields?: boolean } = {},
): Promise<{ checked: number; small: string[] }> {
  return page.evaluate(
    ([query, counted, fields]) => {
      const small: string[] = [];
      let checked = 0;
      for (const element of document.querySelectorAll(query)) {
        if (
          element.closest(fields ? "[inert], [aria-hidden=true]" : "[inert]") ||
          (fields && element.matches("input") && element.closest("label")) ||
          !element.checkVisibility({
            visibilityProperty: true,
            opacityProperty: true,
          })
        )
          continue;
        const box = element.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        if (element.matches(counted)) checked++;
        const after = getComputedStyle(element, "::after");
        const area = after.content !== "none" && after.position === "absolute";
        const width = area
          ? Math.max(box.width, parseFloat(after.width) || 0)
          : box.width;
        const height = area
          ? Math.max(box.height, parseFloat(after.height) || 0)
          : box.height;
        if (width < 44 - 0.5 || height < 44 - 0.5)
          small.push(
            `${element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName}: ${box.width}×${box.height}`,
          );
      }
      return { checked, small: [...new Set(small)] };
    },
    [query, counted, fields] as const,
  );
}

// A stored sidebar choice (E8) for every load of this page.
export async function preferSidebar(page: Page, mode: "expanded" | "rail") {
  await page.addInitScript((value) => {
    try {
      localStorage.setItem("scopearr-sidebar", value);
    } catch {
      // Storage can be blocked; the default mode is then used.
    }
  }, mode);
}

// Recorded from the first script on: the frame's targets when .v2-nav first
// appears (a MutationObserver), and in every animation frame from then on
// whether the page header is there and where the frame stands.
export async function recordFirstPaint(page: Page) {
  await page.addInitScript(() => {
    type Record = { [key: string]: [number, number, number, number] };
    const w = window as unknown as {
      __firstNav?: Record;
      __frames?: { at: number; head: boolean; boxes: Record }[];
    };
    const read = (): Record => {
      const boxes: Record = {};
      const add = (key: string, element: Element | null) => {
        if (!element) return;
        const { x, y, width, height } = element.getBoundingClientRect();
        boxes[key] = [x, y, width, height];
      };
      document
        .querySelectorAll(
          "#v2-sidebar :is(a, button), .v2-topbar :is(a, button), .v2-tabbar .v2-tab",
        )
        .forEach((element, index) => add(`target ${index}`, element));
      add("page slot", document.querySelector(".v2-page-slot"));
      add("view", document.querySelector(".v2-view"));
      add("page header", document.querySelector(".v2-page-head"));
      add("h1", document.querySelector("main h1"));
      return boxes;
    };
    w.__frames = [];
    const observer = new MutationObserver(() => {
      if (w.__firstNav || !document.querySelector(".v2-nav")) return;
      w.__firstNav = read();
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
    const frame = () => {
      if (document.querySelector(".v2-nav"))
        w.__frames!.push({
          at: performance.now(),
          head: !!document.querySelector(".v2-page-head"),
          boxes: read(),
        });
      if (w.__frames!.length < 90) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

// What recordFirstPaint saw against the settled frame: no target, slot,
// view (top, width), page header or h1 moves, and no target appears or
// leaves after the first paint. `first` lists the moves of the first
// navigation (null when it never appeared), `frames` those of every
// recorded animation frame (`recorded` of them); `late` is the index of
// the first frame with the page header (-1: none), `ms` its time after
// the first frame.
export async function firstPaintChanges(page: Page): Promise<{
  first: string[] | null;
  frames: string[];
  recorded: number;
  late: number;
  ms: number;
}> {
  const { first, frames, final } = await page.evaluate(() => {
    const w = window as unknown as {
      __firstNav?: Record<string, number[]>;
      __frames?: {
        at: number;
        head: boolean;
        boxes: Record<string, number[]>;
      }[];
    };
    const final: Record<string, number[]> = {};
    const add = (key: string, element: Element | null) => {
      if (!element) return;
      const { x, y, width, height } = element.getBoundingClientRect();
      final[key] = [x, y, width, height];
    };
    document
      .querySelectorAll(
        "#v2-sidebar :is(a, button), .v2-topbar :is(a, button), .v2-tabbar .v2-tab",
      )
      .forEach((element, index) => add(`target ${index}`, element));
    add("page slot", document.querySelector(".v2-page-slot"));
    add("view", document.querySelector(".v2-view"));
    add("page header", document.querySelector(".v2-page-head"));
    add("h1", document.querySelector("main h1"));
    return { first: w.__firstNav, frames: w.__frames ?? [], final };
  });
  const targets = (boxes: Record<string, number[]>) =>
    Object.keys(boxes).filter((key) => key.startsWith("target ")).length;
  const moved = (boxes: Record<string, number[]>, when: string) => [
    ...(targets(boxes) === targets(final)
      ? []
      : [`${when}: ${targets(boxes)} targets, settled ${targets(final)}`]),
    ...Object.entries(boxes)
      .filter(([key, box]) =>
        final[key]
          ? // The view grows with its content; its top and width stay.
            box.some(
              (value, i) =>
                (key !== "view" || i !== 3) &&
                Math.abs(value - final[key][i]) > 0.5,
            )
          : key !== "page header" && key !== "h1",
      )
      .map(([key, box]) => `${when}: ${key} ${box} → ${final[key]}`),
  ];
  const late = frames.findIndex((frame) => frame.head);
  return {
    first: first ? moved(first, "first navigation") : null,
    frames: frames.flatMap((frame, index) =>
      moved(frame.boxes, `frame ${index}`),
    ),
    recorded: frames.length,
    late,
    ms: late < 0 ? 0 : Math.round(frames[late].at - frames[0].at),
  };
}

// Records, from the first script of every load on, the box of the first
// element of each selector in every animation frame (before its paint) in
// which it is in the page. recordedBoxes returns what was recorded since
// the last call and starts a new recording, so a test can check the boxes
// of each step (a load, a view switch, an open drawer) against the settled
// ones of that step.
export async function recordBoxes(
  page: Page,
  selectors: string[],
): Promise<void> {
  await page.addInitScript((list) => {
    const w = window as unknown as { __boxes?: Record<string, DOMRect[]> };
    w.__boxes = Object.fromEntries(list.map((query) => [query, []]));
    const frame = () => {
      for (const query of list) {
        const element = document.querySelector(query);
        if (element)
          w.__boxes![query]?.push(
            element.getBoundingClientRect().toJSON() as DOMRect,
          );
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, selectors);
}
export async function recordedBoxes(
  page: Page,
): Promise<Record<string, DOMRect[]>> {
  return page.evaluate(() => {
    const w = window as unknown as { __boxes?: Record<string, DOMRect[]> };
    const boxes = w.__boxes ?? {};
    w.__boxes = Object.fromEntries(Object.keys(boxes).map((key) => [key, []]));
    return boxes;
  });
}

// The widths of the rebuilt pages' geometry checks (Phase 5a): around
// the frame's and the cards' thresholds, and the smallest phone; 820 is a
// tablet in portrait, phones are 812 high.
export const WIDTHS = [1600, 1440, 1119, 820, 740, 739, 375, 320];
export const sizeOf = (width: number) => ({
  width,
  height: width === 820 ? 1180 : width <= 739 ? 812 : 900,
});
export const sizeLabel = ({
  width,
  height,
}: {
  width: number;
  height: number;
}) => `${width}x${height}`;

// Geometry checks of the rebuilt pages (Phase 5a): a box edge, as
// getBoundingClientRect reports it, matches within TOLERANCE px.
export const TOLERANCE = 0.5;
export type Edge = "x" | "y" | "width" | "height";
export const ALL: Edge[] = ["x", "y", "width", "height"];
export const PLACE: Edge[] = ["x", "y", "width"];

export function expectSame(actual: number, expected: number, what: string) {
  expect(
    Math.abs(actual - expected),
    `${what}: got ${actual}px, expected ${expected}px (±${TOLERANCE}px)`,
  ).toBeLessThanOrEqual(TOLERANCE);
}

// The first box of each selector now.
export function boxesOf(
  page: Page,
  selectors: string[],
): Promise<Record<string, DOMRect | null>> {
  return page.evaluate(
    (list) =>
      Object.fromEntries(
        list.map((query) => {
          const element = document.querySelector(query);
          return [
            query,
            element
              ? (element.getBoundingClientRect().toJSON() as DOMRect)
              : null,
          ];
        }),
      ),
    selectors,
  );
}

// Every box recorded since the last call (recordBoxes) and the settled
// one equal `base` (else the settled boxes) in the given edges; each part
// was in the page at least once, so a renamed class fails instead of
// passing. Returns the recorded boxes.
export async function expectSteady(
  page: Page,
  parts: Record<string, Edge[]>,
  where: string,
  base?: Record<string, DOMRect | null>,
) {
  const recorded = await recordedBoxes(page);
  const now = await boxesOf(page, Object.keys(parts));
  const reference = base ?? now;
  const moved: string[] = [];
  for (const [query, edges] of Object.entries(parts)) {
    const expected = reference[query];
    if (!expected) {
      moved.push(`${query}: not in the page`);
      continue;
    }
    const frames = [...(recorded[query] ?? []), now[query]];
    frames.forEach((box, index) => {
      if (!box) return moved.push(`${query}: gone in the settled page`);
      for (const edge of edges)
        if (Math.abs(box[edge] - expected[edge]) > TOLERANCE)
          moved.push(
            `${query} ${index === frames.length - 1 ? "settled" : `frame ${index}`}: ${edge} ${box[edge]} → ${expected[edge]}`,
          );
    });
  }
  expect(moved, where).toEqual([]);
  return recorded;
}

// The interface language of every load of this page (scopearr-language).
export const LANGUAGES = ["en", "de", "es", "it"] as const;
const pageLanguages = new WeakMap<Page, string>();
export async function inLanguage(page: Page, language: string) {
  pageLanguages.set(page, language);
  await page.addInitScript((value) => {
    try {
      localStorage.setItem("scopearr-language", value);
    } catch {
      // Storage can be blocked; English is then used.
    }
  }, language);
}

// The settings the app loads with `seasonMode` set (Settings → Display →
// Lists: "matches" shows the matching files of a season, "season" the
// whole season as context).
export async function withSeasonMode(
  page: Page,
  mode: "matches" | "season",
): Promise<void> {
  await page.route(/\/api\/settings$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const settings = await response.json();
    settings.seasonMode = mode;
    await route.fulfill({ response, json: settings });
  });
}

// The list preferences of this browser (E13) for every load of this page:
// compact rows and stacked audio tracks; a missing one is the default.
export async function withListPrefs(
  page: Page,
  prefs: Partial<{ density: "compact"; stacked: true; filename: false }>,
): Promise<void> {
  await page.addInitScript((values) => {
    try {
      if (values.density)
        localStorage.setItem("scopearr-density", values.density);
      else localStorage.removeItem("scopearr-density");
      if (values.stacked)
        localStorage.setItem("scopearr-tracks-stacked", "true");
      else localStorage.removeItem("scopearr-tracks-stacked");
      if (values.filename === false)
        localStorage.setItem("scopearr-title-filename", "hidden");
      else localStorage.removeItem("scopearr-title-filename");
    } catch {
      // Storage can be blocked; the defaults are then used.
    }
  }, prefs);
}

// The C+ column set (STYLEGUIDE 3): Info, title, year, resolution, codec,
// source, HDR, audio tracks, custom tags and size.
export const CPLUS_COLUMNS = [
  "info",
  "title",
  "year",
  "resolution",
  "codec",
  "source",
  "hdr",
  "audio",
  "custom",
  "size",
];

// Both libraries show `columns` first, in this order, through the settings
// the app loads; the other columns follow, hidden.
export async function withColumns(
  page: Page,
  columns: string[],
): Promise<void> {
  await page.route(/\/api\/settings$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const settings = await response.json();
    for (const service of ["radarr", "sonarr"]) {
      settings.visibleColumns[service] = columns;
      settings.columnOrder[service] = [
        ...columns,
        ...settings.columnOrder[service].filter(
          (column: string) => !columns.includes(column),
        ),
      ];
    }
    await route.fulfill({ response, json: settings });
  });
}

// Arrival with four audio tracks in every file list the app loads (no demo
// file has more than two): its own German DTS 5.1 (default) and English
// AC-3 5.1, then English E-AC-3 7.1 and an English AAC 2.0 commentary, so
// its compact cell shows two chips and "+2". The demo server still filters
// by its own data.
export async function withAudioTracks(page: Page): Promise<void> {
  await page.route(/\/api\/files\?/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const file of body.files ?? []) {
      if (file.title !== "Arrival" || file.audioTracks?.length !== 2) continue;
      file.audioTracks = [
        ...file.audioTracks,
        {
          index: 3,
          language: "Englisch",
          codec: "E-AC-3",
          channels: 8,
          channelLayout: "7.1",
          title: "",
          default: false,
        },
        {
          index: 4,
          language: "Englisch",
          codec: "AAC",
          channels: 2,
          channelLayout: "2.0",
          title: "Commentary",
          default: false,
        },
      ];
      file.audioStreamCount = 4;
    }
    await route.fulfill({ response, json: body });
  });
}

// Four more codecs in every scope's statistics (the demo has at most five
// values a distribution): the Codec card of the dashboard shows five of
// its eight values and offers More. The scope's files grow by as many, so
// the heads and the audio shares agree with them (final review T11-f).
export const MORE_CODECS = [
  { value: "AV1", count: 3 },
  { value: "VC-1", count: 2 },
  { value: "MPEG-2", count: 2 },
  { value: "XviD", count: 1 },
];
export async function withMoreValues(page: Page): Promise<void> {
  await page.route(/\/api\/statistics$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const added = MORE_CODECS.reduce((sum, codec) => sum + codec.count, 0);
    for (const [key, scope] of Object.entries(body.distributions) as [
      string,
      { codec: { value: string; count: number }[] },
    ][]) {
      scope.codec = [...scope.codec, ...MORE_CODECS];
      body.fileTotals[key] += added;
    }
    await route.fulfill({ response, json: body });
  });
}

// A storage area of the dashboard's storage card (the demo selects no
// storage paths): 12 TB with `used` TB in use, as /api/storage reports it.
export type StorageArea = {
  key: string;
  label: string;
  paths: string[];
  total: number;
  free: number;
  used: number;
  error: string;
};
export function storageArea(
  key: string,
  used: number,
  { error = "", total = 12e12 }: { error?: string; total?: number } = {},
): StorageArea {
  return {
    key,
    label: `radarr · ${key}`,
    paths: [`/mnt/user/${key}`],
    total,
    used: total ? used * 1e12 : 0,
    free: total ? total - used * 1e12 : 0,
    error,
  };
}

// /api/storage answers with `areas` for every scope (all, radarr, sonarr)
// that lists some, and none for the others.
export async function withStorageAreas(
  page: Page,
  areas: Partial<Record<"all" | "radarr" | "sonarr", StorageArea[]>>,
): Promise<void> {
  await page.route(/\/api\/storage$/, (route) =>
    route.fulfill({
      json: {
        services: {},
        areas: { all: [], radarr: [], sonarr: [], ...areas },
      },
    }),
  );
}

// The open filter drawer of a list, named "Filters".
export function filterDrawer(page: Page): Locator {
  return page.getByRole("dialog", { name: "Filters", exact: true });
}

// The results card of a library, named by its title ("Your movies", "Your
// TV series", with " · {instance}").
export function libraryCard(page: Page): Locator {
  return page.locator("main section.v2-table-card");
}

// The library's column menu (rc.3 K1): the page tool "Columns" and the
// dialog it opens.
export function columnsButton(page: Page): Locator {
  return libraryCard(page).getByRole("button", {
    name: "Columns",
    exact: true,
  });
}
export function columnsMenu(page: Page): Locator {
  return page.getByRole("dialog", { name: "Columns", exact: true });
}

// The column menu saves at once (PUT /api/settings). This keeps those
// saves in the page: the shared demo server keeps its settings, and every
// later settings load of the page, a reload too, answers with the
// settings saved last (which hold the routes' changes the app loaded).
export async function keepColumnSaves(page: Page): Promise<void> {
  let saved: Record<string, unknown> | null = null;
  await page.route(/\/api\/settings$/, async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      const { tagApprovals: _, ...settings } = request.postDataJSON();
      saved = settings;
      return route.fulfill({ json: {} });
    }
    if (request.method() === "GET" && saved)
      return route.fulfill({ json: saved });
    return route.fallback();
  });
}

// Turns columns on or off in the column menu (`names`: their labels; null:
// every column) and closes it with Escape; returns the labels it changed.
export async function setColumns(
  page: Page,
  names: string[] | null,
  on: boolean,
): Promise<string[]> {
  await columnsButton(page).click();
  const menu = columnsMenu(page);
  await expect(menu).toBeVisible();
  const changed: string[] = [];
  for (const box of await menu.getByRole("checkbox").all()) {
    const name = await box.evaluate(
      (input) => input.closest("label")?.textContent?.trim() ?? "",
    );
    if ((names && !names.includes(name)) || (await box.isChecked()) === on)
      continue;
    await box.setChecked(on);
    changed.push(name);
  }
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  return changed;
}

// Every hidden column of the list shown through the column menu, its
// saves kept in the page (keepColumnSaves), as the 1.7.0 tool All columns
// showed them; returns the labels it turned on (to hide them again with
// setColumns).
export async function showHiddenColumns(page: Page): Promise<string[]> {
  await keepColumnSaves(page);
  return setColumns(page, null, true);
}

// The results card of a tool page (Phase 5b), named by its title ("Jobs",
// "Items", "Findings").
export function toolCard(page: Page): Locator {
  return page.locator("main section.v2-table-card");
}

// The KPI row of Muxing and Files & permissions, named "Overview".
export function toolKpis(page: Page): Locator {
  return page.locator("main section.v2-dash-kpis");
}

// The disk row of Disk placement: a region named "Disks and pools" only
// while it overflows (ruling I9).
export function diskRow(page: Page): Locator {
  return page.locator("main section.v2-disks");
}

export type ApiCall = { at: number; method: string; path: string };

export type ApiRecorder = {
  all(): ApiCall[];
  since(mark: number): ApiCall[];
  mark(): number;
};

// Records every request under /api/ from now on. `path` has no "/api/" prefix
// and no query; `mark()` returns a position for `since()`.
export function recordApi(page: Page): ApiRecorder {
  const calls: ApiCall[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return;
    calls.push({
      at: Date.now(),
      method: request.method(),
      path: url.pathname.slice("/api/".length),
    });
  });
  return {
    all: (): ApiCall[] => [...calls],
    since: (mark: number): ApiCall[] => calls.slice(mark),
    mark: (): number => calls.length,
  };
}

// Markup of the page body that stays the same between runs: no toasts,
// attributes in name order, `useId` values replaced and clock text masked.
// Of the attribute values only title, aria-label and datetime are masked
// when they hold clock text (such as event-time titles); other numbers,
// such as SVG data or "16:9", stay in the fingerprint.
export async function domSnapshot(page: Page): Promise<string> {
  return page.evaluate(
    ({ time, date }) => {
      const moving = [new RegExp(time), new RegExp(date)];
      const masked = ["title", "aria-label", "datetime"];
      const generated = /^P\d+-\d+$/;
      const body = document.body.cloneNode(true) as HTMLElement;
      body.querySelectorAll(".v2-toast").forEach((toast) => toast.remove());
      // A hidden sidebar flyout keeps the top of its last opening (so it
      // fades out in place); whether a step hovered the rail before is not
      // part of the page.
      body
        .querySelectorAll('#v2-fly[aria-hidden="true"]')
        .forEach((fly) => fly.removeAttribute("style"));
      for (const element of [body, ...body.querySelectorAll("*")]) {
        const attributes = [...element.attributes].sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        );
        for (const attribute of attributes)
          element.removeAttributeNode(attribute);
        for (const { namespaceURI, name, value } of attributes) {
          const linked =
            name === "id" ||
            name === "for" ||
            name === "form" ||
            name.startsWith("aria-");
          const stable = linked
            ? value
                .split(" ")
                .map((part) => (generated.test(part) ? "ID" : part))
                .join(" ")
            : value;
          const next =
            masked.includes(name) &&
            moving.some((pattern) => pattern.test(stable))
              ? "[masked]"
              : stable;
          if (namespaceURI) element.setAttributeNS(namespaceURI, name, next);
          else element.setAttribute(name, next);
        }
      }
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        if (moving.some((pattern) => pattern.test(text.data)))
          text.data = "[masked]";
      }
      return body.outerHTML;
    },
    { time: TIME.source, date: DATE.source },
  );
}

// Two enabled Radarr instances in the settings the app loads: the Movies
// entry becomes a group (sub-entries, an arrow when expanded, a group
// flyout in the rail) and the frame shows its sync display (card, chip or
// drawer row). The demo itself has no enabled instance.
export async function withTwoMovieInstances(page: Page) {
  await page.route(/\/api\/settings$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const settings = await response.json();
    const radarr = settings.instances.find(
      (instance: { id: string }) => instance.id === "radarr",
    );
    settings.instances = [
      { ...radarr, enabled: true, name: "Radarr HD" },
      { ...radarr, id: "radarr-4k", enabled: true, name: "Radarr 4K" },
      ...settings.instances.filter(
        (instance: { type: string }) => instance.type !== "radarr",
      ),
    ];
    await route.fulfill({ response, json: settings });
  });
}

// The demo server asks GitHub for the latest release when it starts, so
// System → Info reads "Checking for a new version …" or "Release check is
// unavailable" whenever that request is slow or fails. Captures that must
// not depend on the network (the pixel and review projects) pin the answer
// their baselines show: up to date. Only a status that carries the field
// changes (signed out it has none). A pinned page keeps it when a later
// helper (withStatus, withOpenJobs) answers the status as well.
const pinnedRelease = new WeakSet<Page>();
export const RELEASE_CHECKED_AT = "2026-11-06T09:00:00Z";
function pinRelease(page: Page, status: Record<string, unknown>) {
  if (!pinnedRelease.has(page) || !("releaseCheck" in status)) return;
  status.releaseCheck = {
    latest: status.version,
    checkedAt: RELEASE_CHECKED_AT,
    successAt: RELEASE_CHECKED_AT,
    error: "",
    updateAvailable: false,
  };
}
export async function pinReleaseCheck(page: Page) {
  pinnedRelease.add(page);
  await page.route(/\/api\/status$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const status = await response.json();
    pinRelease(page, status);
    await route.fulfill({ response, json: status });
  });
}

// The status the app loads and polls, changed by `change` for every request
// from now on: such as no sync data at all, or a status outside the demo
// (unlocked sync buttons). The server itself stays the demo.
export async function withStatus(
  page: Page,
  change: (status: { demo: boolean; sync?: unknown }) => void,
) {
  await page.route(/\/api\/status$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const status = await response.json();
    pinRelease(page, status);
    change(status);
    await route.fulfill({ response, json: status });
  });
}

// Renaming is available (Phase 5d, Task 6): the mux tool is enabled and
// the status is outside the demo, so File & metadata's pencil is not
// locked. The server itself stays the demo.
export async function withRenameAvailable(page: Page) {
  await withStatus(page, (status) => {
    const mux = status as { demo: boolean; mux?: { enabled: boolean } };
    mux.demo = false;
    mux.mux = { ...mux.mux, enabled: true };
  });
}

// The frame's sync popover, named "Synchronization".
export function syncPopover(page: Page): Locator {
  return page.getByRole("dialog", { name: "Synchronization", exact: true });
}

// The bell's jobs menu, named "Jobs".
export function jobsMenu(page: Page): Locator {
  return page.getByRole("dialog", { name: "Jobs", exact: true });
}

// The quick search dialog, named "Quick search".
export function quickSearch(page: Page): Locator {
  return page.getByRole("dialog", { name: "Quick search", exact: true });
}

// The open jobs of withOpenJobs, as the status counts them: mux running,
// waiting and failed; Disk placement visible without open jobs (no row);
// Files & permissions waiting and failed. 6 in all.
export const OPEN_JOBS = {
  mux: { pending: 1, running: 1, failed: 1 },
  unraid: { pending: 0, running: 0, failed: 0 },
  files: { pending: 2, running: 0, failed: 1 },
};
// The bell's two Files & permissions requests (frame-status.jobRequests)
// with their answers; a cancelled finding is no open job.
const FINDINGS: Record<string, ReturnType<typeof finding>[]> = {
  "?status=active&sort=status&dir=desc&limit=3": [
    finding(11, "queued", "Up", "Movies/Up (2009)/Up (2009).mkv"),
    finding(12, "queued", "Big", "Movies/Big (1988)/Big (1988).mkv"),
  ],
  "?status=failed&sort=status&dir=desc&limit=3": [
    finding(13, "failed", "Tron", "Movies/Tron (1982)/Tron (1982).mkv"),
    finding(14, "cancelled", "Elf", "Movies/Elf (2003)/Elf (2003).mkv"),
  ],
};

// OPEN_JOBS in the status the app loads and polls (changed further by
// `change`, such as leaving the demo), and the job lists the bell loads
// when it opens: mux/jobs (also a finished job) and the bell's Files &
// permissions requests. The demo has no job; other item requests (the tool
// pages') still reach the demo server.
export async function withOpenJobs(
  page: Page,
  change: (status: Record<string, unknown>) => void = () => {},
) {
  await page.route(/\/api\/status$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const status = await response.json();
    pinRelease(page, status);
    for (const [tool, jobs] of Object.entries(OPEN_JOBS))
      status[tool] = { ...status[tool], ...jobs };
    change(status);
    await route.fulfill({ response, json: status });
  });
  await page.route(/\/api\/mux\/jobs$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      json: [
        muxJob(1, "running", "Arrival", "Arrival (2016).mkv"),
        muxJob(2, "queued", "Dune", "Dune (2021).mkv"),
        muxJob(3, "failed", "Heat", "Heat (1995).mkv"),
        muxJob(4, "succeeded", "Alien", "Alien (1979).mkv"),
      ],
    });
  });
  await page.route(/\/api\/filecheck\/items\?/, async (route) => {
    const items = FINDINGS[new URL(route.request().url()).search];
    if (route.request().method() !== "GET" || !items) return route.continue();
    await route.fulfill({
      json: { items, total: items.length, selectableIds: [], shares: {} },
    });
  });
}

// The frame regions axe checks (D18): 1.7.0 content is checked with its
// rebuild in Phase 5. The toast region is v2 since Phase 5d and checked with
// the frame (nothing is left out).
const FRAME_REGIONS =
  ".v2-sidebar, .v2-fly, .v2-topbar, .v2-page-head, .v2-tabbar, .v2-pop, .v2-qs, .v2-toasts";
const LEGACY_IN_REGIONS = "";
// Sign-in, setup and the loading screen are v2 as a whole (Task 15): axe
// checks the whole document there.
const START_SCREENS = ".v2-login, .v2-loading";
// The content of a rebuilt page (axeView), with an open v2 dialog.
const VIEW_REGIONS =
  ".v2-view, dialog.v2-drawer[open], dialog.v2-modal[open], .v2-pop";
// An open v2 dialog (axeDialog, Phase 5d E35).
const DIALOG_REGIONS = "dialog.v2-modal[open]";
const AXE_SCRIPT = createRequire(import.meta.url).resolve(
  "axe-core/axe.min.js",
);
// The app's Content-Security-Policy allows scripts from its own origin only,
// so axe is served from there instead of inline.
const AXE_PATH = "/__e2e/axe.min.js";
const axePages = new WeakSet<Page>();

// Runs axe-core (WCAG 2.0 and 2.1, A and AA) on the visible frame regions
// and fails with one line per violation, "id: target". Incomplete results
// (such as text on the band's gradient, whose contrast contrast.test checks
// from the tokens) are logged as an annotation, not failed.
export function axeFrame(page: Page, label: string): Promise<void> {
  return runAxe(page, label, FRAME_REGIONS, false);
}

// The same on a start screen (sign-in, setup or the loading screen): the
// whole document, so page rules such as the language of <html> count too.
export function axeScreen(page: Page, label: string): Promise<void> {
  return runAxe(page, label, START_SCREENS, true);
}

// The same on the content of a rebuilt page (E28, Phase 5a on): the view,
// an open filter drawer and an open popover (one inside the drawer counts
// with it). The frame around it is axeFrame's.
export function axeView(page: Page, label: string): Promise<void> {
  return runAxe(page, label, VIEW_REGIONS, false);
}

// The same on the open v2 dialogs (Phase 5d, E35): a popover inside one
// counts with it.
export function axeDialog(page: Page, label: string): Promise<void> {
  return runAxe(page, label, DIALOG_REGIONS, false);
}

// The open dialog named `name` (its h2), as a screen reader finds it.
export function dialog(page: Page, name: string): Locator {
  return page.getByRole("dialog", { name, exact: true });
}

async function runAxe(
  page: Page,
  label: string,
  regions: string,
  whole: boolean,
): Promise<void> {
  if (!axePages.has(page)) {
    axePages.add(page);
    await page.route(AXE_PATH, (route) =>
      route.fulfill({ path: AXE_SCRIPT, contentType: "text/javascript" }),
    );
  }
  if (!(await page.evaluate(() => "axe" in window)))
    await page.addScriptTag({ url: AXE_PATH });
  const result = await page.evaluate(
    async ([regions, legacy, whole]) => {
      type Rule = { id: string; nodes: { target: unknown[] }[] };
      const axe = (
        window as unknown as {
          axe: {
            run(
              context: unknown,
              options: unknown,
            ): Promise<{ violations: Rule[]; incomplete: Rule[] }>;
          };
        }
      ).axe;
      const shown = [...document.querySelectorAll(regions as string)].filter(
        (element) =>
          element.checkVisibility({
            opacityProperty: true,
            visibilityProperty: true,
          }),
      );
      // A region inside another one (a popover in the drawer) is checked
      // with it.
      const include = shown.filter(
        (element) =>
          !shown.some((other) => other !== element && other.contains(element)),
      );
      const lines = (rules: Rule[]) =>
        rules.flatMap((rule) =>
          rule.nodes.map((node) => `${rule.id}: ${node.target.join(" ")}`),
        );
      if (!include.length)
        return { regions: 0, violations: [], incomplete: [] };
      const exclude = legacy
        ? [...document.querySelectorAll(legacy as string)]
        : [];
      const { violations, incomplete } = await axe.run(
        whole ? { exclude } : { include, exclude },
        {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
          },
          resultTypes: ["violations", "incomplete"],
        },
      );
      return {
        regions: include.length,
        violations: lines(violations),
        incomplete: lines(incomplete),
      };
    },
    [regions, LEGACY_IN_REGIONS, whole] as const,
  );
  if (result.incomplete.length)
    test.info().annotations.push({
      type: "axe incomplete",
      description: `${label}: ${result.incomplete.join("; ")}`,
    });
  expect(
    result.regions,
    `${label}: no ${whole ? "start screen" : regions === VIEW_REGIONS ? "view region" : regions === DIALOG_REGIONS ? "dialog" : "frame region"} is visible`,
  ).toBeGreaterThan(0);
  expect(result.violations, `${label}: axe violations`).toEqual([]);
}

// The band of a settings area (Phase 5c): its PageHeader with the area's
// title, summary, segment and Save settings.
export function settingsBand(page: Page): Locator {
  return page.locator(".v2-page-head");
}

// The card of the open service tab in Settings → Services.
export function serviceCard(page: Page): Locator {
  return page.locator("main section.v2-svc");
}

// The answers the settings areas load after their first paint, each held
// back `ms`: the tool and Unraid states of Services, the tag catalog
// (Display → Colors), the storage of Widgets, the rules of Tag rules and
// the event log. The settings and the status are not held (the areas
// need them to render at all). Other routes of the page still answer.
export async function withDelayedSettingsData(
  page: Page,
  ms: number,
): Promise<void> {
  await page.route(
    /\/api\/(mux\/tool|mediainfo\/tool|unraid\/status|tag-catalog|storage|recognition|events)(\?|$)/,
    async (route) => {
      if (route.request().method() === "GET")
        await new Promise((resolve) => setTimeout(resolve, ms));
      await route.fallback();
    },
  );
}

// The dialogs of Phase 5d (web/src/dialog-model.ts, E4), as the tests of
// dialogs.spec.ts and a11y.spec.ts open them: the route the trigger is on,
// the fixture the dialog needs before the app loads (a status outside the
// demo, tool rows, an answer the demo does not give), and the trigger,
// after any step before it (a tab, the dialog the trigger is in). At 739
// and below the desk buttons of the tool rows are hidden, so the mux
// options and the logs open from the row's status dialog there. `name` is
// the dialog's accessible name (its h2).
export type DialogId =
  | "confirm"
  | "savePreset"
  | "autoTag"
  | "customTags"
  | "file"
  | "renameCompanions"
  | "muxOptions"
  | "muxStatus"
  | "muxLog"
  | "pathCheck"
  | "placementScan"
  | "targetDisks"
  | "placementReport"
  | "placementDetails"
  | "placementStatus"
  | "placementLog"
  | "fileCheckScan"
  | "fileCheckDetails"
  | "fileCheckCommands"
  | "fileCheckReport"
  | "fileCheckNames"
  | "addService"
  | "unraidPathCheck"
  | "password"
  | "ruleEditor"
  | "tagPolicy"
  | "tagReview"
  | "logEntry";
type DialogOpener = {
  name: string;
  hash: string;
  fixture?: (page: Page) => Promise<void>;
  trigger: (page: Page) => Promise<Locator>;
};
const phoneWide = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 739;
// A catalog text in the language of the page (inLanguage; English by
// default), with its {parameters}: the openers find their triggers by the
// names a user reads in that language.
const locales = createRequire(import.meta.url);
export function L(
  page: Page,
  key: string,
  parameters: Record<string, string> = {},
): string {
  const language = pageLanguages.get(page) ?? "en";
  const catalog = locales(`../src/locales/${language}.json`) as {
    messages: Record<string, string>;
  };
  const fallback = locales("../src/locales/en.json") as typeof catalog;
  const message = catalog.messages[key] ?? fallback.messages[key] ?? key;
  return message.replace(/\{(\w+)\}/g, (all, name: string) =>
    name in parameters ? parameters[name] : all,
  );
}
// The start of a catalog text, up to its first parameter: a name such as
// "Status: Ready. Show checks" or "Set tag 2" (label and count).
const startOf = (page: Page, key: string) =>
  new RegExp(
    "^" +
      L(page, key)
        .split(/[({]/)[0]
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
const mainButton = (page: Page, name: string | RegExp) =>
  page.getByRole("main").getByRole("button", {
    name: typeof name === "string" ? L(page, name) : name,
    exact: typeof name === "string",
  });
const named = (
  page: Page,
  scope: Locator | Page,
  key: string,
  title?: string,
) =>
  scope.getByRole("button", {
    name: title === undefined ? L(page, key) : L(page, key, { title }),
    exact: true,
  });
// A library row's action (rc.4 R6): `key` is the name of its Info or
// custom tags button ("Filename and metadata: {title}", "Edit custom tags:
// {title}"). A phone card has neither button: its row menu ("Actions:
// {title}") holds the action as an entry of that name, so the menu opens
// first and the entry is returned. Which one the list shows is read from
// the page (a card below a card width of 560), once the row is there.
export async function rowAction(
  page: Page,
  key: string,
  title: string,
): Promise<Locator> {
  const box = page.getByRole("checkbox", {
    name: L(page, "Select {title}", { title }),
    exact: true,
  });
  await expect(box).toBeVisible({ timeout: 15_000 });
  const menu = page.getByRole("button", {
    name: L(page, "Actions: {title}", { title }),
    exact: true,
  });
  if (!(await menu.isVisible())) return named(page, page, key, title);
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  return page
    .getByRole("menu", { name: L(page, "Actions: {title}", { title }) })
    .getByRole("menuitem", { name: L(page, key, { title }), exact: true });
}
const toolRow = async (page: Page, text: string) => {
  const rows = page.locator("table.v2-table--fixed > tbody > tr");
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  await settle(page);
  return rows.filter({ hasText: text });
};
// Opens the dialog named `key` from `trigger` with a click and waits for it.
async function through(page: Page, trigger: Locator, key: string) {
  await trigger.click();
  const shown = dialog(page, L(page, key));
  await expect(shown).toBeVisible();
  await settle(page);
  return shown;
}
// A status outside the demo (unlocked buttons), with the tools on.
const outsideDemo = (page: Page) =>
  withStatus(page, (status) => {
    const s = status as Record<string, unknown> & {
      mux?: Record<string, unknown>;
    };
    s.demo = false;
    s.mux = { ...s.mux, enabled: true, installed: true };
  });
// The custom tags of Arrival (Phase 5d, Task 14): an auto tag of Radarr
// (protected, with its auto mark) and three manual ones.
export async function withCustomTags(page: Page) {
  await page.route(/\/api\/files\?/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const file of body.files ?? [])
      if (file.title === "Arrival")
        file.custom = [
          { id: 9001, name: "Auto", protected: true, sources: ["radarr"] },
          { id: 9002, name: "Favourite", manual: true },
          { id: 9003, name: "Rewatch", manual: true },
          { id: 9004, name: "Extra", manual: true },
        ];
    await route.fulfill({ response, json: body });
  });
}
// The selection Custom tags loads for two files (Phase 5d, Task 14, T5
// M-4): a tag both have, one only one has (mixed), the protected auto tag
// (locked) and one neither has.
export const CUSTOM_SELECTION = {
  total: 2,
  counts: { "9001": 1, "9002": 2, "9003": 1 },
  tags: [
    { id: 9001, name: "Auto", protected: true, sources: ["radarr"] },
    { id: 9002, name: "Favourite", manual: true },
    { id: 9003, name: "Rewatch", manual: true },
    { id: 9004, name: "Extra", manual: true },
  ],
};
export async function withCustomSelection(page: Page) {
  await page.route(/\/api\/custom-selection(\?|$)/, (route) =>
    ["GET", "POST"].includes(route.request().method())
      ? route.fulfill({ json: CUSTOM_SELECTION })
      : route.fallback(),
  );
}
// Answers of the checks the demo does not run: the mux and MediaInfo path
// checks, the Unraid path check, a rename preview with companion files and
// a tag preview with removals.
const MUX_PATH_CHECKS = {
  rootFolders: [
    {
      arrPath: "/movies",
      instances: ["Radarr"],
      mapped: true,
      localPath: "/media/movies",
      localExists: true,
      suggestion: "",
    },
  ],
  errors: [],
  syntax: { ok: true },
  mappings: [
    {
      arrPath: "/movies",
      localPath: "/media/movies",
      exists: true,
      isDir: true,
      readable: true,
      writable: true,
      freeBytes: 2 * 1024 ** 4,
    },
  ],
  samples: [{ instance: "Radarr", checked: 5, reachable: 5, sizeMatches: 5 }],
  workDir: {
    configured: true,
    exists: true,
    writable: true,
    freeBytes: 500 * 1024 ** 3,
  },
};
const UNRAID_PATH_CHECKS = {
  root: true,
  share: true,
  checked: 12,
  found: 12,
  disks: [
    {
      name: "disk1",
      kind: "array",
      total: 4 * 1024 ** 4,
      free: 1024 ** 4,
      writable: true,
      excluded: false,
    },
    {
      name: "cache",
      kind: "pool",
      total: 1024 ** 4,
      free: 512 * 1024 ** 3,
      writable: true,
      excluded: false,
    },
  ],
  state: { known: true, mover: false, parity: false },
  warnings: [],
};
const TAG_PREVIEW = {
  service: "radarr",
  token: "e2e-token",
  approvalRequired: true,
  rows: [
    {
      id: 1,
      label: "scopearr-2160p",
      origin: "scopearr",
      assignments: 3,
      deleteDefinition: true,
      retained: false,
      targets: [
        { id: 1, title: "Arrival" },
        { id: 2, title: "Dune" },
        { id: 3, title: "Heat" },
      ],
    },
  ],
  targetTotal: 3,
};
async function withAnswer(page: Page, path: RegExp, json: unknown) {
  await page.route(path, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ json })
      : route.fallback(),
  );
}

export const DIALOG_OPENERS: Record<DialogId, DialogOpener> = {
  confirm: {
    name: "Restore defaults",
    hash: "#/settings/appearance/lists",
    trigger: async (page) => {
      const movies = page.getByRole("tab", {
        name: L(page, "Movies"),
        exact: true,
      });
      await movies.click();
      await expect(movies).toHaveAttribute("aria-selected", "true");
      return page.getByRole("main").getByRole("button", {
        name: L(page, "Reset order for {tab}", { tab: L(page, "Movies") }),
        exact: true,
      });
    },
  },
  savePreset: {
    name: "Save filter view",
    hash: "#/movies?resolution=2160p",
    trigger: async (page) => mainButton(page, "Save preset"),
  },
  autoTag: {
    name: "External auto-tag",
    hash: "#/movies?q=Arrival",
    fixture: withCustomTags,
    // A phone card's chip line has no target (rc.4 R6): its row menu's
    // entry "Auto tag: {name}" opens the explanation.
    trigger: async (page) => {
      const edit = await rowAction(
        page,
        "Edit custom tags: {title}",
        "Arrival",
      );
      if (
        !(await edit.evaluate((el) => el.getAttribute("role") === "menuitem"))
      )
        return page.locator("button.v2-ctag-auto").first();
      return page
        .getByRole("menu", {
          name: L(page, "Actions: {title}", { title: "Arrival" }),
        })
        .getByRole("menuitem", {
          name: L(page, "Auto tag: {name}", { name: "Auto" }),
          exact: true,
        });
    },
  },
  customTags: {
    name: "Custom tags",
    hash: "#/movies",
    fixture: withCustomSelection,
    trigger: async (page) => {
      for (const title of ["Alien", "Arrival"])
        await page
          .getByRole("checkbox", {
            name: L(page, "Select {title}", { title }),
            exact: true,
          })
          .check();
      return page.getByRole("button", {
        name: startOf(page, "Set tag ({count})"),
      });
    },
  },
  file: {
    name: "File & metadata",
    hash: "#/movies",
    trigger: async (page) =>
      rowAction(page, "Filename and metadata: {title}", "Arrival"),
  },
  renameCompanions: {
    name: "Companion files found",
    hash: "#/movies?q=Arrival",
    fixture: async (page) => {
      await withRenameAvailable(page);
      await withAnswer(page, /\/api\/files\/rename\/preview$/, {
        filename: "Arrival (2016) Remux.mkv",
        companions: [
          {
            from: "Arrival (2016).nfo",
            to: "Arrival (2016) Remux.nfo",
            conflict: false,
            device: "disk1",
          },
          {
            from: "Arrival (2016).en.srt",
            to: "Arrival (2016) Remux.en.srt",
            conflict: false,
            device: "disk1",
          },
        ],
        device: "disk1",
        userShare: false,
      });
    },
    trigger: async (page) => {
      const file = await through(
        page,
        await rowAction(page, "Filename and metadata: {title}", "Arrival"),
        "File & metadata",
      );
      await named(page, file, "Rename file").click();
      const field = file.getByRole("textbox", { name: L(page, "Filename") });
      await expect(field).toBeFocused();
      await field.fill("Arrival (2016) Remux");
      return named(page, file, "Rename file");
    },
  },
  muxOptions: {
    name: "Mux options",
    hash: "#/tools/mux",
    fixture: (page) => withMuxJobs(page),
    trigger: async (page) => {
      const row = await toolRow(page, "Dune");
      if (!phoneWide(page))
        return named(page, row, "Mux options for {title}", "Dune");
      const status = await through(
        page,
        row.getByRole("button", {
          name: startOf(page, "Status: {label}. Show checks"),
        }),
        "Status",
      );
      return named(page, status, "Mux options");
    },
  },
  muxStatus: {
    name: "Status",
    hash: "#/tools/mux",
    fixture: (page) => withMuxJobs(page),
    trigger: async (page) =>
      (await toolRow(page, "Dune")).getByRole("button", {
        name: startOf(page, "Status: {label}. Show checks"),
      }),
  },
  muxLog: {
    name: "MKVToolNix log",
    hash: "#/tools/mux",
    fixture: (page) => withMuxJobs(page),
    trigger: async (page) => {
      const row = await toolRow(page, "Dune");
      if (!phoneWide(page))
        return named(page, row, "Terminal for {title}", "Dune");
      const status = await through(
        page,
        row.getByRole("button", {
          name: startOf(page, "Status: {label}. Show checks"),
        }),
        "Status",
      );
      return named(page, status, "Terminal");
    },
  },
  pathCheck: {
    name: "Path check",
    hash: "#/settings/connections/mux",
    fixture: async (page) => {
      await outsideDemo(page);
      await withAnswer(page, /\/api\/mux\/check-paths$/, MUX_PATH_CHECKS);
    },
    trigger: async (page) => mainButton(page, "Check paths"),
  },
  placementScan: {
    name: "Scan disk placement",
    hash: "#/tools/placement",
    fixture: (page) => withPlacement(page),
    trigger: async (page) => {
      await toolRow(page, "Breaking Bad");
      return mainButton(page, "Scan");
    },
  },
  targetDisks: {
    name: "Target disks",
    hash: "#/tools/placement",
    fixture: (page) => withPlacement(page),
    trigger: async (page) => {
      await toolRow(page, "Breaking Bad");
      const scan = await through(
        page,
        mainButton(page, "Scan"),
        "Scan disk placement",
      );
      return scan.getByRole("button", { name: L(page, "Edit target disks") });
    },
  },
  placementReport: {
    name: "Scan report",
    hash: "#/tools/placement",
    fixture: (page) => withPlacement(page),
    trigger: async (page) => {
      await toolRow(page, "Breaking Bad");
      return mainButton(page, startOf(page, "Scan report"));
    },
  },
  placementDetails: {
    name: "Breaking Bad",
    hash: "#/tools/placement",
    fixture: (page) => withPlacement(page),
    trigger: async (page) =>
      named(
        page,
        await toolRow(page, "Breaking Bad"),
        "Details for {title}",
        "Breaking Bad",
      ),
  },
  placementStatus: {
    name: "Status",
    hash: "#/tools/placement",
    fixture: (page) => withPlacement(page),
    trigger: async (page) =>
      (await toolRow(page, "Breaking Bad")).getByRole("button", {
        name: startOf(page, "Status: {label}. Show checks"),
      }),
  },
  placementLog: {
    name: "Disk placement log",
    hash: "#/tools/placement",
    fixture: (page) => withPlacement(page),
    trigger: async (page) => {
      const row = await toolRow(page, "Breaking Bad");
      if (!phoneWide(page))
        return named(page, row, "Terminal for {title}", "Breaking Bad");
      const details = await through(
        page,
        named(page, row, "Details for {title}", "Breaking Bad"),
        "Breaking Bad",
      );
      return named(page, details, "Terminal");
    },
  },
  fileCheckScan: {
    name: "Scan files & permissions",
    hash: "#/tools/files",
    fixture: (page) => withFindings(page),
    trigger: async (page) => {
      await toolRow(page, "Her.2013.nfo");
      return mainButton(page, "Scan");
    },
  },
  fileCheckDetails: {
    name: "Her",
    hash: "#/tools/files",
    fixture: (page) => withFindings(page),
    trigger: async (page) =>
      named(
        page,
        await toolRow(page, "Her.2013.nfo"),
        "Details for {title}",
        HER,
      ),
  },
  fileCheckCommands: {
    name: "Terminal commands",
    hash: "#/tools/files",
    fixture: async (page) => {
      await withFindings(page);
      await withAnswer(page, /\/api\/filecheck\/commands$/, {
        text: "chmod 644 '/mnt/user/movies/Her (2013)/Her.2013.nfo'",
        hostPaths: false,
      });
    },
    trigger: async (page) => {
      const row = await toolRow(page, "Her.2013.nfo");
      if (!phoneWide(page))
        return named(page, row, "Terminal for {title}", HER);
      const details = await through(
        page,
        named(page, row, "Details for {title}", HER),
        "Her",
      );
      return named(page, details, "Terminal command");
    },
  },
  fileCheckReport: {
    name: "Scan report",
    hash: "#/tools/files",
    fixture: (page) => withFindings(page),
    trigger: async (page) => {
      await toolRow(page, "Her.2013.nfo");
      return mainButton(page, startOf(page, "Scan report"));
    },
  },
  fileCheckNames: {
    name: "Allowed and ignored names",
    hash: "#/settings/connections/unraid",
    fixture: outsideDemo,
    trigger: async (page) =>
      named(
        page,
        page.getByRole("group", { name: L(page, "Allowed and ignored names") }),
        "Edit",
      ),
  },
  addService: {
    name: "Add service",
    hash: "#/settings/connections",
    fixture: outsideDemo,
    trigger: async (page) =>
      named(page, page.locator(".v2-svc-bar"), "Add service"),
  },
  unraidPathCheck: {
    name: "Unraid path check",
    hash: "#/settings/connections/unraid",
    fixture: async (page) => {
      await outsideDemo(page);
      await withAnswer(page, /\/api\/unraid\/check$/, UNRAID_PATH_CHECKS);
    },
    trigger: async (page) => mainButton(page, "Check paths"),
  },
  password: {
    name: "Change password",
    hash: "#/settings/system/info",
    trigger: async (page) => mainButton(page, "Change password"),
  },
  ruleEditor: {
    name: "Edit recognition rule",
    hash: "#/settings/recognition",
    trigger: async (page) =>
      page
        .getByRole("button", { name: startOf(page, "Edit rule: {name}") })
        .first(),
  },
  tagPolicy: {
    name: "Confirm tag synchronization changes",
    hash: "#/settings/connections/radarr",
    fixture: async (page) => {
      await withTwoMovieInstances(page);
      await outsideDemo(page);
    },
    trigger: async (page) => {
      await page
        .getByRole("main")
        .getByRole("checkbox", { name: L(page, "Resolution"), exact: true })
        .check();
      return named(page, page, "Save settings").first();
    },
  },
  tagReview: {
    name: "Review tag removals",
    hash: "#/settings/connections/radarr",
    fixture: async (page) => {
      await withTwoMovieInstances(page);
      await withStatus(page, (status) => {
        const s = status as Record<string, unknown>;
        s.demo = false;
        s.tagSync = {
          ...(s.tagSync as object),
          radarr: {
            running: false,
            pending: false,
            error: "",
            changed: 3,
            approvalRequired: true,
          },
        };
      });
      await withAnswer(page, /\/api\/tag-preview$/, TAG_PREVIEW);
    },
    trigger: async (page) => mainButton(page, "Review tag removals"),
  },
  logEntry: {
    name: "Log entry",
    hash: "#/settings/system/log",
    trigger: async (page) => page.locator(".v2-set-msg").first(),
  },
};
const HER = "movies/Her (2013)/Her.2013.nfo";

// Opens the dialog `id` like a user (DIALOG_OPENERS): its fixture (once
// per page), a fresh load of its route, then its trigger, by a click or
// with `keyboard` focused and Enter. `delay` holds the dialogs' own data
// that long (withDelayedDialogData); `armed` runs right before the trigger
// is used (a recording starts). openDialog returns the open
// dialog.v2-modal, openDialogFrom also the trigger.
type OpenOptions = {
  theme?: Theme;
  keyboard?: boolean;
  delay?: number;
  armed?: () => Promise<void>;
};
const fixtured = new WeakMap<Page, Set<DialogId>>();
export async function openDialog(
  page: Page,
  id: DialogId,
  options: OpenOptions = {},
): Promise<Locator> {
  return (await openDialogFrom(page, id, options)).dialog;
}
export async function openDialogFrom(
  page: Page,
  id: DialogId,
  { theme = "dark", keyboard = false, delay = 0, armed }: OpenOptions = {},
): Promise<{
  dialog: Locator;
  trigger: Locator;
  handle: ElementHandle<Node>;
}> {
  const opener = DIALOG_OPENERS[id];
  const done = fixtured.get(page) ?? new Set<DialogId>();
  fixtured.set(page, done);
  if (!done.has(id)) {
    done.add(id);
    await opener.fixture?.(page);
    if (delay) await withDelayedDialogData(page, delay);
  }
  await page.goto("about:blank");
  await openRoute(page, opener.hash, { theme });
  const found = await opener.trigger(page);
  await expect(found).toBeEnabled();
  // The trigger by a mark of its own: its name may match a button of the
  // dialog it opens (Scan, Rename file).
  await found.evaluate((el) => {
    for (const old of el.ownerDocument.querySelectorAll("[data-e2e-trigger]"))
      old.removeAttribute("data-e2e-trigger");
    el.setAttribute("data-e2e-trigger", "");
  });
  const trigger = page.locator("[data-e2e-trigger]");
  // A handle stays on the element after a step removes it (the logs open
  // in place of the dialog that holds their trigger on a phone).
  const handle = await found.elementHandle();
  await armed?.();
  if (keyboard) {
    await trigger.focus();
    await page.keyboard.press("Enter");
  } else await trigger.click();
  const shown = openModal(page, id);
  await expect(shown).toBeVisible();
  return { dialog: shown, trigger, handle: handle! };
}
// The open dialog.v2-modal of `id`, by its title.
export function openModal(page: Page, id: DialogId): Locator {
  return page
    .locator("dialog.v2-modal[open]")
    .filter({
      has: page.getByRole("heading", {
        level: 2,
        name: L(page, DIALOG_OPENERS[id].name),
        exact: true,
      }),
    })
    .last();
}

// The data the dialogs load once open, each answer held back `ms` (Phase
// 5d, Task 14): the custom tag selection, a mux job and its log, the
// placement log and report, the tag preview, the rename preview and the
// path checks. Registered after the dialog's fixture, so the fixture still
// answers after the wait.
export async function withDelayedDialogData(
  page: Page,
  ms: number,
): Promise<void> {
  await page.route(
    /\/api\/(custom-selection(\?|$)|mux\/jobs\?(id|service)=|mux\/jobs\/log\?|placement\/items\/\d+\/log\?|placement\/report$|tag-preview$|files\/rename\/preview$|(mux|mediainfo)\/check-paths$|unraid\/check$)/,
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await route.fallback();
    },
  );
}
