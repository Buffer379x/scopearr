// Shared helpers for driving the demo like a user.
// Views have hash routes (#/…) since 2.0.0, but tests reach them through the
// visible navigation like a user; openRoute starts on a route instead. The
// navigation is the frame's: the sidebar from 740px (with its flyouts in the
// rail), the tab bar and the drawer on phones.
import { expect, type Locator, type Page } from "@playwright/test";

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

// Waits until requests and web fonts are done so geometry no longer moves.
// The quiet window also covers the 180 ms delay before a list request starts.
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  const state = traffic.get(page);
  const started = Date.now();
  if (state) {
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
