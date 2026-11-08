// Shared helpers for driving the demo like a user.
// Views have hash routes (#/…) since 2.0.0, but tests reach them through the
// visible navigation like a user; openRoute starts on a route instead. The
// navigation is the frame's: the sidebar from 740px (with its flyouts in the
// rail), the tab bar and the drawer on phones.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createRequire } from "node:module";

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
  settings: "Settings",
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

export async function rect(page: Page, selector: string): Promise<DOMRect> {
  const box = await page.evaluate((query) => {
    const element = document.querySelector(query);
    return element ? element.getBoundingClientRect().toJSON() : null;
  }, selector);
  if (!box) throw new Error(`No element matches ${selector}`);
  return box as DOMRect;
}

export async function pageOverflowX(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
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
      body.querySelectorAll(".toast").forEach((toast) => toast.remove());
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
const muxJob = (id: number, status: string, title: string, file: string) => ({
  id,
  service: "radarr",
  // No demo file has these ids, so the library marks none of its rows.
  fileId: 900_000 + id,
  mediaId: 900_000 + id,
  title,
  sourceName: file,
  status,
  revision: 1,
  spec: {
    outputName: title,
    deleteOriginal: false,
    tracks: {},
    chapters: true,
    attachments: true,
  },
  source: {
    container: "matroska",
    durationNs: 0,
    tracks: [],
    chapters: 0,
    attachments: 0,
    size: 0,
    modTime: "",
  },
  check: {
    workWritable: true,
    workFreeSpace: true,
    exists: true,
    readable: true,
    writable: true,
    freeSpace: true,
    sizeMatches: true,
    unchanged: true,
  },
  progress: status === "running" ? 40 : 0,
  message: "",
  log: "",
  backupName: "",
  createdAt: "",
  updatedAt: "",
});
const finding = (
  id: number,
  jobStatus: string,
  title: string,
  rel: string,
) => ({
  id,
  service: "radarr",
  instance: "radarr",
  mediaId: 900_000 + id,
  title,
  rel,
  dir: false,
  kind: "permissions",
  fix: "chmod",
  size: 0,
  mode: 420,
  uid: 99,
  gid: 100,
  mtime: 0,
  note: "",
  jobStatus,
  queuePos: null,
  progress: 0,
  message: "",
  updatedAt: "",
  finishedAt: null,
});
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
// rebuild in Phase 5. The 1.7.0 toast region (5d) is left out: the dialog
// stack hosts it in the topmost dialog, so it sits in quick search's.
const FRAME_REGIONS =
  ".v2-sidebar, .v2-fly, .v2-topbar, .v2-page-head, .v2-tabbar, .v2-pop, .v2-qs";
const LEGACY_IN_REGIONS = ".toast-region";
// Sign-in, setup and the loading screen are v2 as a whole (Task 15): axe
// checks the whole document there, except the 1.7.0 toast region.
const START_SCREENS = ".v2-login, .v2-loading";
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
      const include = [...document.querySelectorAll(regions as string)].filter(
        (element) =>
          element.checkVisibility({
            opacityProperty: true,
            visibilityProperty: true,
          }),
      );
      const lines = (rules: Rule[]) =>
        rules.flatMap((rule) =>
          rule.nodes.map((node) => `${rule.id}: ${node.target.join(" ")}`),
        );
      if (!include.length)
        return { regions: 0, violations: [], incomplete: [] };
      const exclude = [...document.querySelectorAll(legacy as string)];
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
    `${label}: no ${whole ? "start screen" : "frame region"} is visible`,
  ).toBeGreaterThan(0);
  expect(result.violations, `${label}: axe violations`).toEqual([]);
}
