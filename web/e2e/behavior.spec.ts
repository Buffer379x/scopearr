// Behavior of the current interface that the restructuring must keep:
// unsaved settings, navigation state, log links, polling and startup, and the
// hash routes of 2.0.0 (deep links, Back/Forward, reload, sign-in).
// Nothing here saves settings, because all tests share one demo database
// (a save is answered by a route instead).
import { expect, test, type Page } from "@playwright/test";
import {
  answerDiscard,
  currentHash,
  expectSection,
  goTo,
  historyLength,
  leaveIsBlocked,
  mainNavigation,
  networkQuiet,
  openApp,
  openRoute,
  recordApi,
  sectionLink,
  settingsSection,
  settle,
  withStatus,
} from "./app";

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

  await (await sectionLink(page, "Widgets")).click();
  await answerDiscard(page, "Cancel");
  await expectSection(page, "Display");
  await expect(entries).toHaveValue(changed);

  const dashboard = mainNavigation(page).getByRole("link", {
    name: "Dashboard",
    exact: true,
  });
  await dashboard.click();
  await answerDiscard(page, "Cancel");
  await expect(heading(page, "Display")).toBeVisible();
  await expect(entries).toHaveValue(changed);

  // Back asks before it leaves the section; Cancel returns to this entry.
  await back(page);
  await answerDiscard(page, "Cancel");
  await expect.poll(() => currentHash(page)).toBe("#/settings/appearance");
  await expectSection(page, "Display");
  await expect(entries).toHaveValue(changed);
  await back(page);
  await answerDiscard(page, "Discard changes");
  await expect.poll(() => currentHash(page)).toBe("#/settings/connections");
  await expectSection(page, "Services");
  // The forward entry is kept and opens without a question.
  await forward(page);
  await expect.poll(() => currentHash(page)).toBe("#/settings/appearance");
  await expectSection(page, "Display");
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

// Ruling T3-M4: a save from the dock unmounts it; focus goes to the band's
// heading, not to the page, and the page keeps its scroll position. The
// save is answered here (the demo database is shared, so nothing is
// stored): the PUT succeeds and the next GET returns the saved time zone.
test("a save from the dock hands focus to the band heading", async ({
  page,
}) => {
  await openApp(page);
  await goTo(page, "settings");
  let sent: { syncTimezone?: string } | null = null;
  await page.route(/\/api\/settings$/, async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      sent = request.postDataJSON();
      return route.fulfill({ json: {} });
    }
    if (!sent) return route.fallback();
    const response = await route.fetch();
    return route.fulfill({
      response,
      json: { ...(await response.json()), syncTimezone: sent.syncTimezone },
    });
  });
  await page.getByLabel("Sync timezone", { exact: true }).fill("Europe/Berlin");
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  const dock = page.locator(".v2-save-dock");
  const docked = dock.getByRole("button", { name: "Save settings" });
  await expect(docked).toBeVisible();
  await docked.focus();
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled, "saved far down the page").toBeGreaterThan(0);
  await page.keyboard.press("Enter");
  await expect(dock).toHaveCount(0);
  await expect(heading(page, "Services")).toBeFocused();
  // The heading takes focus without scrolling the page back to the band.
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  expect(sent).toMatchObject({ syncTimezone: "Europe/Berlin" });
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
  await expectSection(page, "System");
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
    await expect(heading(page, "Display")).toBeVisible();
    await expectSection(page, "Display");
    expect(await currentHash(page)).toBe("#/settings/appearance");
  });

  // Ruling R-A: the password toggle of the approved design. A press keeps
  // focus and the caret in the field; from the keyboard it stays on the
  // toggle. Its name stays "Show password"; aria-pressed carries the state.
  test("the password toggle keeps focus in the field", async ({ page }) => {
    await page.goto("/");
    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toHaveAttribute("type", "password");
    // The demo fills in its password; the caret goes to its end.
    await password.click();
    await page.keyboard.press("End");
    const show = page.getByRole("button", {
      name: "Show password",
      exact: true,
    });
    await expect(show).toHaveAttribute("aria-pressed", "false");
    await show.click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toBeFocused();
    await expect(show).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.type("!");
    await expect(password).toHaveValue("Scopearr-demo-2026!");
    await page.keyboard.press("Backspace");
    // Keyboard: Tab reaches the toggle, Space switches it, focus stays.
    await page.keyboard.press("Tab");
    await expect(show).toBeFocused();
    await page.keyboard.press("Space");
    await expect(password).toHaveAttribute("type", "password");
    await expect(show).toBeFocused();
    await expect(show).toHaveAttribute("aria-pressed", "false");
    // Signing in still works with the toggle in between.
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(heading(page, "Dashboard")).toBeVisible();
  });

  // The 1.7.0 checks and messages of sign-in and setup: a refused sign-in
  // shows the server's message (lockout included) and stays; setup needs its
  // code and 12 characters (the browser's own check, no request) and shows a
  // refused code. Answers are routed, so the demo's session, log and lockout
  // stay untouched.
  test("sign-in and setup keep their checks and messages", async ({ page }) => {
    const api = recordApi(page);
    await page.route(/\/api\/login$/, (route) =>
      route.fulfill({
        status: 401,
        json: { error: "Login failed or temporarily locked" },
      }),
    );
    await page.goto("/");
    const signIn = page.getByRole("button", { name: "Sign in", exact: true });
    await signIn.click();
    await expect(
      page.getByText("Login failed or temporarily locked", { exact: true }),
    ).toBeVisible();
    await expect(signIn).toBeEnabled();
    expect(await currentHash(page)).toBe("");

    await withStatus(page, (status) => {
      (status as { initialized?: boolean }).initialized = false;
    });
    await page.route(/\/api\/setup$/, (route) =>
      route.fulfill({ status: 400, json: { error: "Setup code is invalid" } }),
    );
    await page.reload();
    const create = page.getByRole("button", {
      name: "Create account",
      exact: true,
    });
    await expect(create).toBeVisible();
    const code = page.getByLabel("Setup code", { exact: true });
    const password = page.getByLabel("Password", { exact: true });
    await expect(code).toHaveAccessibleDescription(
      "Copy the one-time code from /data/setup-token in the container console.",
    );
    await expect(password).toHaveAccessibleDescription(
      "At least 12 characters, at most 72 UTF-8 bytes.",
    );
    await expect(password).toHaveAttribute("autocomplete", "new-password");
    const mark = api.mark();
    // Without a code, then with a short password: the browser stops both.
    await create.click();
    expect(
      await code.evaluate(
        (input: HTMLInputElement) => input.validity.valueMissing,
      ),
    ).toBe(true);
    await code.fill("not-the-code");
    await password.fill("short");
    await create.click();
    expect(
      await password.evaluate(
        (input: HTMLInputElement) => input.validity.tooShort,
      ),
    ).toBe(true);
    expect(api.since(mark).filter((call) => call.path === "setup")).toEqual([]);
    await password.fill("a-long-password-1");
    await create.click();
    await expect(
      page.getByText("Setup code is invalid", { exact: true }),
    ).toBeVisible();
    await expect(create).toBeEnabled();
    expect(api.since(mark).filter((call) => call.path === "setup").length).toBe(
      1,
    );
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

test("the brand link opens the dashboard without a reload", async ({
  page,
  context,
}) => {
  // The visible brand: the sidebar's from 740px, the topbar's on phones.
  const brand = page.getByRole("link", { name: "Scopearr home", exact: true });
  const discard = page.getByRole("dialog", { name: "Really cancel?" });
  // A page load drops this marker.
  const kept = () =>
    page.evaluate(() => (window as Window & { __keep?: number }).__keep);
  await openApp(page);
  await goTo(page, "movies");
  await page.evaluate(() => {
    (window as Window & { __keep?: number }).__keep = 1;
  });

  // A modified click keeps the browser's link: a new tab loads / and shows
  // the dashboard, this page stays.
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    brand.click({ modifiers: ["ControlOrMeta"] }),
  ]);
  await expect(heading(tab, "Dashboard")).toBeVisible();
  await expect.poll(() => currentHash(tab)).toBe("#/dashboard");
  await tab.close();
  await expect(heading(page, "Movie library")).toBeVisible();
  expect(await currentHash(page)).toBe("#/movies");

  // A plain click is a push like Dashboard: Back returns to the library.
  const length = await historyLength(page);
  await brand.click();
  await expect(heading(page, "Dashboard")).toBeVisible();
  await expect.poll(() => currentHash(page)).toBe("#/dashboard");
  expect(await historyLength(page)).toBe(length + 1);
  expect(await kept()).toBe(1);
  await back(page);
  await expect(heading(page, "Movie library")).toBeVisible();
  await expect.poll(() => currentHash(page)).toBe("#/movies");

  // With unsaved settings, it asks once; Cancel stays on the section.
  await goTo(page, "settings");
  await settingsSection(page, "Display");
  const entries = page.getByLabel("Entries per page", { exact: true });
  const before = await entries.inputValue();
  const changed = before === "37" ? "38" : "37";
  await entries.fill(changed);
  await expect.poll(() => leaveIsBlocked(page)).toBe(true);
  await brand.click();
  await answerDiscard(page, "Cancel");
  await expect(heading(page, "Display")).toBeVisible();
  await expect(entries).toHaveValue(changed);
  expect(await currentHash(page)).toBe("#/settings/appearance");
  await expect(discard).toHaveCount(0);
  await brand.click();
  await answerDiscard(page, "Discard changes");
  await expect(heading(page, "Dashboard")).toBeVisible();
  await expect.poll(() => currentHash(page)).toBe("#/dashboard");
  await expect(discard).toHaveCount(0);
  await expect.poll(() => leaveIsBlocked(page)).toBe(false);
  expect(await kept()).toBe(1);
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
    mainNavigation(page).getByRole("link", { name: "Movies", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(await currentHash(page)).toBe(
    `#/movies?instance=${DEMO_MOVIE_INSTANCE}&q=Tenet`,
  );
});

// L21 (1.7.0 "Marking … 3/12"): a mux run counts its files in the mark
// tool's slot (its name, what it shows, follows; its title reads "Marking
// … n/3"), announces them politely and moves no tool. The mux requests
// are answered here, so the demo's jobs do not change.
test("mux marking counts its run in place", async ({ page }) => {
  await withStatus(page, (status) => {
    const shown = status as { mux?: Record<string, unknown> };
    shown.mux = { ...shown.mux, enabled: true, installed: true };
  });
  const held: { fulfill(options: { json: unknown }): Promise<void> }[] = [];
  await page.route(/\/api\/mux\/jobs$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    held.push(route);
  });
  await openApp(page);
  await goTo(page, "movies");
  for (const title of ["Alien", "Annihilation", "Arrival"])
    await page
      .getByRole("checkbox", { name: `Select ${title}`, exact: true })
      .check();
  const tools = page.locator(".v2-tc-tools");
  const before = await tools.boundingBox();
  await page
    .getByRole("button", { name: "Mark for muxing 3", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mark", exact: true })
    .click();
  const running = page.getByRole("button", { name: /^Mark for muxing \d$/ });
  const slot = running.locator(".v2-count-num");
  const live = tools.locator('[aria-live="polite"]');
  await expect.poll(() => held.length).toBe(1);
  await expect(slot).toHaveText("0");
  await expect(live).toHaveText("");
  await held[0].fulfill({ json: {} });
  await expect.poll(() => held.length).toBe(2);
  await expect(running).toHaveAccessibleName("Mark for muxing 1");
  await expect(running).toHaveAttribute("title", /^Marking … 1\/3 · /);
  await expect(slot).toHaveText("1");
  await expect(running.locator(".v2-count")).toHaveClass(/v2-count--on/);
  await expect(live).toHaveText("Marking … 1/3");
  expect(await tools.boundingBox(), "the tools keep their place").toEqual(
    before,
  );
  await held[1].fulfill({ json: {} });
  await expect.poll(() => held.length).toBe(3);
  await expect(live).toHaveText("Marking … 2/3");
  await held[2].fulfill({ json: {} });
  await expect(page.getByText("3 items marked for muxing.")).toBeVisible();
  await expect(live).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Mark for muxing 3", exact: true }),
  ).toBeVisible();
  expect(await tools.boundingBox()).toEqual(before);
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

// What "Show in log" in a toast does (openLog in event-log.ts): the router
// may start the shown route again; otherwise the link sets the hash of
// System → Log with its filter.
function openLog(page: Page, query: string) {
  return page.evaluate((hash) => {
    const link = new CustomEvent("scopearr:link", {
      detail: hash,
      cancelable: true,
    });
    if (window.dispatchEvent(link)) location.hash = hash;
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
  await expectSection(page, "System");
  await expect(systemTab(page, "Log")).toHaveAttribute("aria-selected", "true");
  await expect(chips).toHaveText(["Synchronization"]);
  await settle(page);

  // From another section without changes, the link opens the log at once.
  await settingsSection(page, "Display");
  await openLog(page, "source=sync");
  await expectSection(page, "System");
  await expect(systemTab(page, "Log")).toHaveAttribute("aria-selected", "true");
  await expect(chips).toHaveText(["Synchronization"]);
  await expect(
    page.getByRole("dialog", { name: "Really cancel?" }),
  ).toHaveCount(0);

  // With unsaved changes, they are asked about once; Cancel stays on the
  // section.
  await settingsSection(page, "Display");
  const entries = page.getByLabel("Entries per page", { exact: true });
  const before = await entries.inputValue();
  const changed = before === "37" ? "38" : "37";
  await entries.fill(changed);
  await expect.poll(() => leaveIsBlocked(page)).toBe(true);
  await openLog(page, "source=sync");
  await answerDiscard(page, "Cancel");
  await expect.poll(() => currentHash(page)).toBe("#/settings/appearance");
  await expectSection(page, "Display");
  await expect(entries).toHaveValue(changed);
  await openLog(page, "source=sync");
  await answerDiscard(page, "Discard changes");
  await expectSection(page, "System");
  await expect(systemTab(page, "Log")).toHaveAttribute("aria-selected", "true");
  await expect(chips).toHaveText(["Synchronization"]);
  await expect(
    page.getByRole("dialog", { name: "Really cancel?" }),
  ).toHaveCount(0);
  await expect.poll(() => leaveIsBlocked(page)).toBe(false);

  // On the open log, a link with another filter starts it again on page 1
  // and keeps the sort.
  const sortByLevel = log.getByRole("button", {
    name: "Sort by Level",
    exact: true,
  });
  const level = log.getByRole("columnheader").filter({
    has: page.getByRole("button", { name: "Sort by Level", exact: true }),
  });
  await sortByLevel.click();
  await expect(level).toHaveAttribute("aria-sort", "ascending");
  const nextPage = log.getByRole("button", { name: "Next page", exact: true });
  await nextPage.click();
  await expect(log.getByText("Page 2 / 3", { exact: true })).toBeVisible();
  await openLog(page, "level=error");
  await expect(chips).toHaveText(["Error"]);
  await expect(log.getByText("Page 1 / 3", { exact: true })).toBeVisible();
  await expect(level).toHaveAttribute("aria-sort", "ascending");
  expect(await currentHash(page)).toBe("#/settings/system/log?level=error");

  // A link to the shown filter returns to page 1, too.
  const length = await historyLength(page);
  await nextPage.click();
  await expect(log.getByText("Page 2 / 3", { exact: true })).toBeVisible();
  await openLog(page, "level=error");
  await expect(log.getByText("Page 1 / 3", { exact: true })).toBeVisible();
  await expect(chips).toHaveText(["Error"]);
  await expect(level).toHaveAttribute("aria-sort", "ascending");
  expect(await currentHash(page)).toBe("#/settings/system/log?level=error");
  expect(await historyLength(page)).toBe(length);
});

// A service tab of the demo that is not the first one (MKVToolNix or
// MediaInfo sort before it), from its Services section.
const DEMO_SERVICE_TAB = "unraid";

test("deep links open settings sections and tabs", async ({
  page,
  context,
}) => {
  await openRoute(page, "#/settings/appearance/lists");
  await expectSection(page, "Display");
  await expect(
    page
      .getByRole("tablist", { name: "Display sections" })
      .getByRole("tab", { name: "Lists & columns", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(await currentHash(page)).toBe("#/settings/appearance/lists");

  const services = await context.newPage();
  await openRoute(services, `#/settings/connections/${DEMO_SERVICE_TAB}`);
  await expectSection(services, "Services");
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
  await expectSection(log, "System");
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

// Stored languages stay canonical German; the dialog names them in English.
test("file details name languages in the interface language", async ({
  page,
}) => {
  await openApp(page);
  await goTo(page, "movies");
  await page
    .getByRole("button", { name: "Filename and metadata: Arrival" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "File & metadata",
    exact: true,
  });
  const row = dialog.getByRole("row").filter({
    has: page.getByRole("rowheader", { name: "Language", exact: true }),
  });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("German");
  await expect(row).toContainText("English");
  for (const cell of await row.getByRole("cell").all())
    await expect(cell).not.toContainText(/Englisch|Deutsch/);
});

// Paths of the script and style files the page requests from now on,
// including module preloads.
function recordAssets(page: Page): string[] {
  const assets: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/assets/")) assets.push(pathname);
  });
  return assets;
}

// The dashboard needs only the language core; the full registry is its own
// chunk and loads for a language list or a value outside the core.
test("the dashboard loads no language data", async ({ page }) => {
  const assets = recordAssets(page);
  await openApp(page);
  expect(
    assets.some((path) => path.startsWith("/assets/Library-")),
    "the application chunk was recorded",
  ).toBe(true);
  expect(
    assets.filter((path) => path.startsWith("/assets/language-data-")),
  ).toEqual([]);
});

// One waiting job with a German audio track, so the options dialog opens.
// The demo has no mux jobs, and nothing here may create one.
const muxJob = {
  id: 1,
  service: "radarr",
  fileId: 1,
  mediaId: 1,
  title: "Arrival",
  sourceName: "Arrival.2016.mkv",
  status: "draft",
  revision: 1,
  spec: {
    outputName: "Arrival.2016",
    deleteOriginal: false,
    tracks: {
      0: {
        keep: true,
        language: "ger",
        name: "",
        default: true,
        forced: false,
      },
    },
    chapters: true,
    attachments: true,
  },
  source: {
    container: "Matroska",
    durationNs: 0,
    tracks: [
      {
        id: 0,
        type: "audio",
        codec: "AC-3",
        language: "ger",
        name: "",
        default: true,
        forced: false,
        channels: 6,
        enabled: true,
      },
    ],
    chapters: 0,
    attachments: 0,
    size: 1,
    modTime: "2026-11-06T09:00:00Z",
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
  progress: 0,
  message: "",
  log: "",
  backupName: "",
  createdAt: "2026-11-06T09:00:00Z",
  updatedAt: "2026-11-06T09:00:00Z",
};

// Serves the one mux job above instead of the demo's empty list.
function serveMuxJob(page: Page) {
  return page.route(/\/api\/mux\/jobs(?:\?|$)/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: [muxJob] })
      : route.fallback(),
  );
}

test("mux options load the full language list", async ({ page }) => {
  await serveMuxJob(page);
  const assets = recordAssets(page);
  await openApp(page);
  await goTo(page, "mux");
  expect(
    assets.filter((path) => path.startsWith("/assets/language-data-")),
    "before the dialog",
  ).toEqual([]);
  await page.getByRole("button", { name: "Mux options for Arrival" }).click();
  await expect(
    page.getByRole("dialog", { name: "Mux options", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      assets.filter((path) => path.startsWith("/assets/language-data-")),
    )
    .toHaveLength(1);
  await expect
    .poll(() => page.locator("datalist#mux-languages option").count())
    .toBeGreaterThan(7000);
});

// An old tab after an update asks for a registry chunk that is gone. The
// failed load reaches Vite's preload helper, so the reload guard in
// preload-recovery.ts loads the page again, once: when the chunk is still
// missing after that reload, the page stays (final review, parked Task 5).
test("a missing language chunk reloads the page once", async ({ page }) => {
  await serveMuxJob(page);
  await page.route(/\/assets\/language-data-/, (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await openApp(page);
  await goTo(page, "mux");
  let loads = 0;
  page.on("load", () => loads++);
  const options = page.getByRole("button", { name: "Mux options for Arrival" });
  const reload = page.waitForEvent("load");
  await options.click();
  await reload;
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("scopearr-preload-reloaded"),
    ),
  ).toBe("1");
  // The reloaded page, marked: a further reload would drop the mark.
  await expect(options).toBeVisible();
  await page.evaluate(() => {
    (window as Window & { __kept?: number }).__kept = 1;
  });
  const missing = page.waitForResponse(/\/assets\/language-data-/);
  await options.click();
  expect((await missing).status()).toBe(404);
  await expect(
    page.getByRole("dialog", { name: "Mux options", exact: true }),
  ).toBeVisible();
  // A reload would ask for the page again: wait until no request is open.
  await networkQuiet(page);
  expect(loads, "load events after the first click").toBe(1);
  expect(
    await page.evaluate(() => (window as Window & { __kept?: number }).__kept),
  ).toBe(1);
});
