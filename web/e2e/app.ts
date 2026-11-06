// Shared helpers for driving the demo like a user.
// Views have hash routes (#/…) since 2.0.0, but tests reach them through the
// visible navigation like a user; openRoute starts on a route instead.
import { expect, type Page } from "@playwright/test";

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
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
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

export async function goTo(page: Page, view: View) {
  const header = page.getByRole("banner");
  const nav = header.getByRole("navigation", { name: "Main navigation" });
  if (view === "dashboard") {
    await nav.getByRole("button", { name: "Dashboard", exact: true }).click();
  } else if (view === "movies") {
    await nav.getByRole("button", { name: "Movies", exact: true }).click();
  } else if (view === "series") {
    await nav.getByRole("button", { name: "TV series", exact: true }).click();
  } else if (view === "settings") {
    await header.getByRole("button", { name: "Settings", exact: true }).click();
  } else {
    // The Tools button is named "Tools, {count} open jobs".
    await nav.getByRole("button", { name: /^Tools\b/ }).click();
    await page
      .getByRole("menu", { name: "Tools" })
      .getByRole("menuitem", { name: tools[view], exact: true })
      .click();
  }
  await expect(
    page.getByRole("heading", { level: 1, name: headings[view], exact: true }),
  ).toBeVisible();
  await settle(page);
}

export async function settingsSection(page: Page, name: SettingsSection) {
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name, exact: true })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
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
// Attribute values with clock text (such as event-time titles) are masked too,
// except SVG path data, whose numbers can look like a date.
export async function domSnapshot(page: Page): Promise<string> {
  return page.evaluate(
    ({ time, date }) => {
      const moving = [new RegExp(time), new RegExp(date)];
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
            name !== "d" && moving.some((pattern) => pattern.test(stable))
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
