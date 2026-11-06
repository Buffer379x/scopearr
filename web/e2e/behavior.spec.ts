// Behavior of the current interface that the restructuring must keep:
// unsaved settings, navigation state, log links, polling and startup, and the
// hash routes of 2.0.0 (deep links, Back/Forward, reload, sign-in).
// Nothing here saves settings, because all tests share one demo database.
import { expect, test, type Page } from "@playwright/test";
import {
  currentHash,
  goTo,
  historyLength,
  openApp,
  openRoute,
  recordApi,
  settingsSection,
  settle,
} from "./app";

// Waits for the "Really cancel?" dialog and answers it.
async function answerDiscard(page: Page, answer: "Cancel" | "Discard changes") {
  const dialog = page.getByRole("dialog", { name: "Really cancel?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: answer, exact: true }).click();
  await expect(dialog).toBeHidden();
}

// Whether a cancelable beforeunload event is held back by the page. A plain
// Event would treat `returnValue = ""` as cancelling, so the browser's own
// BeforeUnloadEvent is used: it asks only when cancelled or given a message.
function leaveIsBlocked(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const event = document.createEvent("BeforeUnloadEvent");
    event.initEvent("beforeunload", false, true);
    window.dispatchEvent(event);
    return event.defaultPrevented || event.returnValue !== "";
  });
}

function sectionButton(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name, exact: true });
}

function heading(page: Page, name: string) {
  return page.getByRole("heading", { level: 1, name, exact: true });
}

// Back and Forward as the browser buttons do them, without waiting for a
// load like page.goBack().
function back(page: Page) {
  return page.evaluate(() => history.back());
}
function forward(page: Page) {
  return page.evaluate(() => history.forward());
}

test("settings keep unsaved changes until they are discarded", async ({
  page,
}) => {
  await openApp(page);
  await goTo(page, "settings");
  await settingsSection(page, "Display");
  const entries = page.getByLabel("Entries per page", { exact: true });
  const before = await entries.inputValue();
  const changed = before === "37" ? "38" : "37";
  await entries.fill(changed);
  // The page listens again after it renders the change.
  await expect.poll(() => leaveIsBlocked(page)).toBe(true);

  await sectionButton(page, "Widgets").click();
  await answerDiscard(page, "Cancel");
  await expect(sectionButton(page, "Display")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(entries).toHaveValue(changed);

  const dashboard = page
    .getByRole("banner")
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Dashboard", exact: true });
  await dashboard.click();
  await answerDiscard(page, "Cancel");
  await expect(heading(page, "Settings")).toBeVisible();
  await expect(entries).toHaveValue(changed);

  // Back asks before it leaves the section; Cancel returns to this entry.
  await back(page);
  await answerDiscard(page, "Cancel");
  await expect.poll(() => currentHash(page)).toBe("#/settings/appearance");
  await expect(sectionButton(page, "Display")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(entries).toHaveValue(changed);
  await back(page);
  await answerDiscard(page, "Discard changes");
  await expect.poll(() => currentHash(page)).toBe("#/settings/connections");
  await expect(sectionButton(page, "Services")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The forward entry is kept and opens without a question.
  await forward(page);
  await expect.poll(() => currentHash(page)).toBe("#/settings/appearance");
  await expect(sectionButton(page, "Display")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(entries).toHaveValue(before);
  await expect(
    page.getByRole("dialog", { name: "Really cancel?" }),
  ).toHaveCount(0);
  await expect.poll(() => leaveIsBlocked(page)).toBe(false);

  await entries.fill(changed);
  await expect.poll(() => leaveIsBlocked(page)).toBe(true);
  await dashboard.click();
  await answerDiscard(page, "Discard changes");
  await expect(heading(page, "Dashboard")).toBeVisible();
  await expect.poll(() => leaveIsBlocked(page)).toBe(false);
});

test("navigation survives a reload and a new sign-in", async ({
  page,
  context,
}) => {
  await openApp(page);
  await goTo(page, "settings");
  await settingsSection(page, "System");
  await page.reload();
  await expect(heading(page, "Settings")).toBeVisible();
  await expect(sectionButton(page, "System")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await currentHash(page)).toBe("#/settings/system");
  await settle(page);

  await goTo(page, "placement");
  expect(await currentHash(page)).toBe("#/tools/placement");
  // Only this browser context loses its session; e2e/.auth/demo.json stays valid.
  await context.clearCookies();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("scopearr:unauthorized")),
  );
  await expect(
    page.getByText("Your session expired. Sign in again.", { exact: true }),
  ).toBeVisible();
  // The demo fills in its credentials.
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(heading(page, "Disk placement")).toBeVisible();
  expect(await currentHash(page)).toBe("#/tools/placement");
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a signed-out deep link opens after sign-in", async ({ page }) => {
    await page.goto("/#/settings/appearance");
    // The demo fills in its credentials.
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(heading(page, "Settings")).toBeVisible();
    await expect(sectionButton(page, "Display")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await currentHash(page)).toBe("#/settings/appearance");
  });
});

test("back and forward move between pages", async ({ page }) => {
  await openApp(page);
  await goTo(page, "movies");
  await goTo(page, "settings");
  await back(page);
  await expect(heading(page, "Movie library")).toBeVisible();
  expect(await currentHash(page)).toBe("#/movies");
  await back(page);
  await expect(heading(page, "Dashboard")).toBeVisible();
  expect(await currentHash(page)).toBe("#/dashboard");
  await forward(page);
  await expect(heading(page, "Movie library")).toBeVisible();
  expect(await currentHash(page)).toBe("#/movies");
});

test("a reload keeps the route", async ({ page }) => {
  await openApp(page);
  await goTo(page, "series");
  const search = page.getByPlaceholder("Series, episode or file …", {
    exact: true,
  });
  await search.fill("Dark");
  const sortByYear = page.getByRole("button", {
    name: "Sort by Year",
    exact: true,
  });
  await sortByYear.click();
  const year = page.getByRole("columnheader").filter({ has: sortByYear });
  await expect(year).toHaveAttribute("aria-sort", "ascending");
  await expect
    .poll(() => currentHash(page))
    .toMatch(/^#\/series\?(?=.*\bq=Dark\b)(?=.*\bsort=year&dir=asc\b)/);
  const hash = await currentHash(page);
  await page.reload();
  await expect(heading(page, "TV library")).toBeVisible();
  expect(await currentHash(page)).toBe(hash);
  await expect(search).toHaveValue("Dark");
  await expect(year).toHaveAttribute("aria-sort", "ascending");
});

test("a reload right after typing keeps the last keystroke", async ({
  page,
}) => {
  await openApp(page);
  await goTo(page, "movies");
  const search = page.getByPlaceholder("Search movie or file …", {
    exact: true,
  });
  // The reload starts within the 300 ms the URL waits after a keystroke.
  await search.pressSequentially("Tenet", { delay: 20 });
  await page.reload();
  await expect(heading(page, "Movie library")).toBeVisible();
  await expect(search).toHaveValue("Tenet");
  expect(await currentHash(page)).toBe("#/movies?q=Tenet");
});

test("the other library keeps its filters through a reload", async ({
  page,
}) => {
  await openApp(page);
  await goTo(page, "series");
  const series = page.getByPlaceholder("Series, episode or file …", {
    exact: true,
  });
  await series.fill("Dark");
  await expect.poll(() => currentHash(page)).toBe("#/series?q=Dark");
  await goTo(page, "movies");
  await page.reload();
  await expect(heading(page, "Movie library")).toBeVisible();
  expect(await currentHash(page)).toBe("#/movies");
  await settle(page);
  await goTo(page, "series");
  await expect(series).toHaveValue("Dark");
  expect(await currentHash(page)).toBe("#/series?q=Dark");
});

// The movie instance of the demo, measured from its /api/settings.
const DEMO_MOVIE_INSTANCE = "radarr";

test("library deep links set filters and the instance", async ({ page }) => {
  await openRoute(page, `#/movies?instance=${DEMO_MOVIE_INSTANCE}&q=Tenet`);
  await expect(heading(page, "Movie library")).toBeVisible();
  await expect(
    page.getByPlaceholder("Search movie or file …", { exact: true }),
  ).toHaveValue("Tenet");
  await expect(page.getByRole("row").filter({ hasText: "Tenet" })).toHaveCount(
    1,
  );
  await expect(
    page
      .getByRole("banner")
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Movies", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(await currentHash(page)).toBe(
    `#/movies?instance=${DEMO_MOVIE_INSTANCE}&q=Tenet`,
  );
});

test("typing filters adds no history entries", async ({ page }) => {
  await openApp(page);
  await goTo(page, "movies");
  const length = await historyLength(page);
  await page
    .getByPlaceholder("Search movie or file …", { exact: true })
    .pressSequentially("Interstell", { delay: 120 });
  await expect.poll(() => currentHash(page)).toBe("#/movies?q=Interstell");
  expect(await historyLength(page)).toBe(length);
  await back(page);
  await expect(heading(page, "Dashboard")).toBeVisible();
  expect(await currentHash(page)).toBe("#/dashboard");
});

test("deep links open tool filters", async ({ page, context }) => {
  await openRoute(page, "#/tools/files?q=Tenet");
  await expect(heading(page, "Files & permissions")).toBeVisible();
  const search = page.getByPlaceholder("Search title or path …", {
    exact: true,
  });
  await expect(search).toHaveValue("Tenet");
  expect(await currentHash(page)).toBe("#/tools/files?q=Tenet");
  // A link to the open tool starts it again with its own filters.
  await page.evaluate(() => {
    location.hash = "#/tools/files?q=Dune";
  });
  await expect(search).toHaveValue("Dune");
  await back(page);
  await expect(search).toHaveValue("Tenet");
  expect(await currentHash(page)).toBe("#/tools/files?q=Tenet");

  const placement = await context.newPage();
  await openRoute(placement, "#/tools/placement?status=several");
  await expect(heading(placement, "Disk placement")).toBeVisible();
  await expect(
    placement.getByRole("button", {
      name: "Status: Several disks",
      exact: true,
    }),
  ).toBeVisible();
  expect(await currentHash(placement)).toBe("#/tools/placement?status=several");
});

test("tool filters reach the URL without history entries", async ({ page }) => {
  await openApp(page);
  await goTo(page, "mux");
  await goTo(page, "dashboard");
  await goTo(page, "mux");
  const length = await historyLength(page);
  const search = page.getByPlaceholder("Search filename …", { exact: true });
  await search.pressSequentially("Dune", { delay: 120 });
  await expect.poll(() => currentHash(page)).toBe("#/tools/mux?q=Dune");
  expect(await historyLength(page)).toBe(length);

  // Back shows the earlier visit with its own filters, not the stored ones.
  await back(page);
  await expect(heading(page, "Dashboard")).toBeVisible();
  await back(page);
  await expect(heading(page, "Muxing")).toBeVisible();
  await expect(search).toHaveValue("");
  expect(await currentHash(page)).toBe("#/tools/mux");
  await forward(page);
  await expect(heading(page, "Dashboard")).toBeVisible();
  await forward(page);
  await expect(heading(page, "Muxing")).toBeVisible();
  await expect(search).toHaveValue("Dune");

  await page.reload();
  await expect(heading(page, "Muxing")).toBeVisible();
  await expect(search).toHaveValue("Dune");
  expect(await currentHash(page)).toBe("#/tools/mux?q=Dune");
});

test("unknown hashes fall back to the dashboard", async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { loadLength?: number }).loadLength = history.length;
  });
  await openRoute(page, "#/nope");
  await expect(heading(page, "Dashboard")).toBeVisible();
  expect(await currentHash(page)).toBe("#/dashboard");
  expect(await historyLength(page)).toBe(
    await page.evaluate(
      () => (window as Window & { loadLength?: number }).loadLength,
    ),
  );
});

// The log as three pages of 25 entries, so a return to page 1 shows. The
// demo log has only a few entries.
async function longLog(page: Page) {
  await page.route(/\/api\/events\?/, (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get("offset"),
    );
    return route.fulfill({
      json: {
        events: Array.from({ length: 25 }, (_, i) => ({
          id: offset + i + 1,
          ts: Date.parse("2026-11-06T09:00:00Z") - (offset + i) * 1000,
          level: "info",
          source: "sync",
          instance: "",
          message: "Sync finished",
          params: {},
          subject: "",
          detail: "",
          repeat: 1,
        })),
        total: 60,
        counts: {
          level: { error: 60, info: 60 },
          source: { sync: 60, mux: 60 },
          instance: {},
        },
      },
    });
  });
}

// "Show in log" in a toast sets the hash of System → Log with its filter.
function openLog(page: Page, query: string) {
  return page.evaluate((hash) => {
    location.hash = hash;
  }, "#/settings/system/log?" + query);
}

function systemTab(page: Page, name: "Info" | "Log") {
  return page
    .getByRole("tablist", { name: "System sections" })
    .getByRole("tab", { name, exact: true });
}

test("a log link switches settings to System → Log", async ({ page }) => {
  await longLog(page);
  const log = page.locator(".event-log");
  const chips = log.locator(".filter-chip");
  await openApp(page);
  await goTo(page, "movies");
  await openLog(page, "source=sync");
  await expect(heading(page, "Settings")).toBeVisible();
  await expect(sectionButton(page, "System")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(systemTab(page, "Log")).toHaveAttribute("aria-selected", "true");
  await expect(chips).toHaveText(["Synchronization"]);
  await settle(page);

  // From another section, unsaved changes are asked about once; Cancel
  // stays on the section.
  await settingsSection(page, "Display");
  const entries = page.getByLabel("Entries per page", { exact: true });
  const before = await entries.inputValue();
  const changed = before === "37" ? "38" : "37";
  await entries.fill(changed);
  await expect.poll(() => leaveIsBlocked(page)).toBe(true);
  await openLog(page, "source=sync");
  await answerDiscard(page, "Cancel");
  await expect.poll(() => currentHash(page)).toBe("#/settings/appearance");
  await expect(sectionButton(page, "Display")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(entries).toHaveValue(changed);
  await openLog(page, "source=sync");
  await answerDiscard(page, "Discard changes");
  await expect(sectionButton(page, "System")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(systemTab(page, "Log")).toHaveAttribute("aria-selected", "true");
  await expect(chips).toHaveText(["Synchronization"]);
  await expect(
    page.getByRole("dialog", { name: "Really cancel?" }),
  ).toHaveCount(0);
  await expect.poll(() => leaveIsBlocked(page)).toBe(false);

  // On the open log, a link with another filter starts it again on page 1.
  await log.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(log.getByText("Page 2 / 3", { exact: true })).toBeVisible();
  await openLog(page, "level=error");
  await expect(chips).toHaveText(["Error"]);
  await expect(log.getByText("Page 1 / 3", { exact: true })).toBeVisible();
  expect(await currentHash(page)).toBe("#/settings/system/log?level=error");
});

// A service tab of the demo that is not the first one (MKVToolNix or
// MediaInfo sort before it), from its Services section.
const DEMO_SERVICE_TAB = "unraid";

test("deep links open settings sections and tabs", async ({
  page,
  context,
}) => {
  await openRoute(page, "#/settings/appearance/lists");
  await expect(sectionButton(page, "Display")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page
      .getByRole("tablist", { name: "Display sections" })
      .getByRole("tab", { name: "Lists & columns", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(await currentHash(page)).toBe("#/settings/appearance/lists");

  const services = await context.newPage();
  await openRoute(services, `#/settings/connections/${DEMO_SERVICE_TAB}`);
  await expect(sectionButton(services, "Services")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    services
      .getByRole("tablist", { name: "Configured services" })
      .getByRole("tab", { name: "Unraid", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(await currentHash(services)).toBe(
    `#/settings/connections/${DEMO_SERVICE_TAB}`,
  );

  const log = await context.newPage();
  await openRoute(log, "#/settings/system/log?level=error");
  await expect(sectionButton(log, "System")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(systemTab(log, "Log")).toHaveAttribute("aria-selected", "true");
  await expect(log.locator(".event-log .filter-chip")).toHaveText(["Error"]);
  expect(await currentHash(log)).toBe("#/settings/system/log?level=error");
});

// Longest delay between two list requests while nothing runs, from
// DiskPlacementPage.tsx and FileCheckPage.tsx (10000 ms), plus 2 s.
const IDLE_WAIT_MS = 10_000 + 2_000;
// Requests the dashboard makes itself, measured on 1.7.0 interface.
// None of them belongs to a tool page poll.
const dashboardLoads = ["mux/jobs", "statistics", "storage"];
const toolPolls = [
  {
    view: "placement" as const,
    list: "placement/items",
    polled: (path: string) =>
      path.startsWith("placement/") || path === "unraid/status",
  },
  {
    view: "files" as const,
    list: "filecheck/items",
    polled: (path: string) => path.startsWith("filecheck/"),
  },
];

test("tool pages poll once and stop after leaving", async ({ page }) => {
  test.setTimeout(90_000);
  const api = recordApi(page);
  await openApp(page);
  for (const tool of toolPolls) {
    await test.step(tool.view, async () => {
      let mark = api.mark();
      await goTo(page, tool.view);
      const lists = api.since(mark).filter((call) => call.path === tool.list);
      expect(lists, `${tool.list} requests`).toHaveLength(1);

      mark = api.mark();
      await goTo(page, "dashboard");
      await page.waitForTimeout(IDLE_WAIT_MS);
      const after = api.since(mark).map((call) => call.path);
      expect(
        after.filter(tool.polled),
        `requests after leaving ${tool.view}`,
      ).toEqual([]);
      expect(
        after.filter(
          (path) => path !== "status" && !dashboardLoads.includes(path),
        ),
        "requests besides the dashboard's own",
      ).toEqual([]);
    });
  }
});

test("startup loads the same API endpoints", async ({ page }) => {
  const api = recordApi(page);
  await openApp(page);
  const counts = new Map<string, number>();
  for (const { path } of api.all())
    if (path !== "status") counts.set(path, (counts.get(path) || 0) + 1);
  expect([...counts.keys()].sort()).toEqual([
    "custom-tags",
    "mux/jobs",
    "presets",
    "settings",
    "statistics",
    "storage",
    "tag-presentation",
  ]);
  // measured on 1.7.0 interface
  expect({
    settings: counts.get("settings"),
    presets: counts.get("presets"),
    "custom-tags": counts.get("custom-tags"),
    "tag-presentation": counts.get("tag-presentation"),
  }).toEqual({
    settings: 1,
    presets: 1,
    "custom-tags": 1,
    "tag-presentation": 2,
  });
});

test("theme toggle updates the document and storage", async ({ page }) => {
  await openApp(page, { theme: "dark" });
  const header = page.getByRole("banner");
  const theme = () =>
    page.evaluate(() => ({
      document: document.documentElement.dataset.theme,
      stored: localStorage.getItem("scopearr-theme"),
    }));
  expect(await theme()).toEqual({ document: "dark", stored: "dark" });

  await header
    .getByRole("button", { name: "Light theme", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await theme()).toEqual({ document: "light", stored: "light" });

  await header.getByRole("button", { name: "Dark theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await theme()).toEqual({ document: "dark", stored: "dark" });
});
