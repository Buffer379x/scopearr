// Shared helpers for driving the demo like a user.
// 1.7.0 has no URL routes, so every view is reached through the visible navigation.
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
  await page.addInitScript((value) => {
    try {
      localStorage.setItem("scopearr-theme", value);
    } catch {
      // Storage can be blocked; the default theme is then used.
    }
  }, theme);
  trackRequests(page);
  await page.goto("/");
  await expect(page.locator("main h1").first()).toBeVisible();
  await settle(page);
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
