// axe-core on the frame (D18, E23): WCAG 2.0 and 2.1, A and AA, on the
// visible frame regions in every mode and its open states. Zero violations;
// incomplete results are logged. The 1.7.0 content is checked with its
// rebuild in Phase 5; sign-in, setup and the loading screen are v2 as a
// whole (Task 15).
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  axeFrame,
  axeScreen,
  axeView,
  currentHash,
  filterDrawer,
  goTo,
  jobsMenu,
  mainNavigation,
  openApp,
  openRoute,
  quickSearch,
  settle,
  storageArea,
  syncPopover,
  withAudioTracks,
  withMoreValues,
  withOpenJobs,
  withStatus,
  withTwoMovieInstances,
  type Theme,
} from "./app";

type Case = { width: number; height: number; theme: Theme };
const cases: Case[] = [
  { width: 1600, height: 900, theme: "dark" },
  { width: 1440, height: 900, theme: "dark" },
  { width: 1440, height: 900, theme: "light" },
  { width: 820, height: 1180, theme: "light" },
  { width: 375, height: 812, theme: "dark" },
  { width: 375, height: 812, theme: "light" },
];
const name = ({ width, height, theme }: Case) => `${width}x${height}-${theme}`;

// The frame at rest, with the topbar scrolled, and with each of its open
// states this mode has: the rail flyout, a popover, the drawer, the tab
// bar's Tools menu.
async function checkStates(page: Page, label: string) {
  const mode = await page.locator("#v2-sidebar").getAttribute("data-mode");
  await axeFrame(page, `${label} at rest`);
  await goTo(page, "movies");
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(page.locator(".v2-topbar")).toHaveAttribute("data-scrolled", "");
  await axeFrame(page, `${label} with the topbar scrolled`);
  await page.evaluate(() => window.scrollTo(0, 0));
  const nav = mainNavigation(page);
  if (mode === "rail") {
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("#v2-fly")).toHaveAttribute("data-open", "");
    await axeFrame(page, `${label} with the Settings flyout`);
    await page.keyboard.press("Escape");
  }
  if (mode === "drawer") {
    await nav.getByRole("button", { name: "Tools", exact: true }).click();
    await expect(page.getByRole("menu", { name: "Tools" })).toBeVisible();
    await axeFrame(page, `${label} with the Tools menu`);
    await page.keyboard.press("Escape");
    await nav.getByRole("button", { name: "More", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Main navigation" }),
    ).toBeVisible();
    await axeFrame(page, `${label} with the drawer`);
    await page.keyboard.press("Escape");
  } else {
    await page
      .getByRole("banner")
      .getByRole("button", { name: /open jobs/ })
      .click();
    await expect(page.locator(".v2-pop")).toBeVisible();
    await axeFrame(page, `${label} with a popover`);
    await page.keyboard.press("Escape");
  }
}

// The sync popover open from the sync display of this mode: the chip
// (rail), the card (expanded) or the drawer row.
async function checkSyncPopover(page: Page, label: string) {
  const mode = await page.locator("#v2-sidebar").getAttribute("data-mode");
  if (mode === "drawer") {
    await mainNavigation(page)
      .getByRole("button", { name: "More", exact: true })
      .click();
    await page.locator("#v2-sidebar .v2-sync--row").click();
  } else if (mode === "expanded")
    await page.locator("#v2-sidebar .v2-sync--card").click();
  else await page.getByRole("banner").locator(".v2-sync-chip").click();
  await expect(syncPopover(page)).toBeVisible();
  await axeFrame(page, `${label} with the sync popover (${mode})`);
  await page.keyboard.press("Escape");
  await expect(syncPopover(page)).toHaveCount(0);
  if (mode === "drawer") await page.keyboard.press("Escape");
}

test("the frame has no axe violations", async ({ page }) => {
  test.setTimeout(240_000);
  for (const item of cases) {
    await test.step(name(item), async () => {
      await page.setViewportSize(item);
      await openApp(page, { theme: item.theme });
      await checkStates(page, name(item));
      // Without an enabled instance there is no sync display (Task 11).
      await expect(
        page.locator(".v2-sync-chip, .v2-sync--card, .v2-sync--row"),
      ).toHaveCount(0);
    });
  }
});

// The same with two enabled movie instances: the Movies group (arrow,
// sub-entries, group flyout) and the sync display (card, chip, drawer row).
test("the frame has no axe violations with instance groups", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await withTwoMovieInstances(page);
  for (const item of [cases[0], cases[1], cases[4]]) {
    await test.step(name(item), async () => {
      await page.setViewportSize(item);
      await openApp(page, { theme: item.theme });
      await checkStates(page, `${name(item)} with instances`);
      await checkSyncPopover(page, `${name(item)} with instances`);
      if (item.width === 1440) {
        await mainNavigation(page)
          .getByRole("link", { name: "Movies", exact: true })
          .hover();
        await expect(page.locator("#v2-fly")).toHaveAttribute(
          "aria-label",
          "Movies",
        );
        await axeFrame(page, `${name(item)} with the Movies flyout`);
      }
    });
  }
});

// The sync popover with unlocked buttons (outside the demo) and without any
// sync data ("Not synced yet"), in each mode and both themes.
test("the sync popover has no axe violations without sync data", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await withTwoMovieInstances(page);
  await withStatus(page, (status) => {
    status.demo = false;
    delete status.sync;
  });
  for (const item of [cases[0], cases[2], cases[3], cases[5]]) {
    await test.step(name(item), async () => {
      await page.setViewportSize(item);
      await openApp(page, { theme: item.theme });
      await checkSyncPopover(page, `${name(item)} without sync data`);
    });
  }
});

// The bell's jobs menu (Task 12) in each mode: in the demo without open
// jobs ("No open jobs."), then with open jobs (tool rows, their jobs,
// "Show in log") once they have loaded.
test("the jobs menu has no axe violations", async ({ page }) => {
  test.setTimeout(240_000);
  const check = async (jobs: boolean) => {
    for (const item of [cases[0], cases[2], cases[3], cases[4]]) {
      const label = `${name(item)} with the jobs menu${jobs ? " and jobs" : ""}`;
      await test.step(label, async () => {
        await page.setViewportSize(item);
        await openApp(page, { theme: item.theme });
        await page
          .getByRole("banner")
          .getByRole("button", { name: /open jobs/ })
          .click();
        const menu = jobsMenu(page);
        await expect(menu).toBeVisible();
        if (jobs)
          await expect(menu.locator(".v2-job:not([aria-hidden])")).toHaveCount(
            6,
          );
        else await expect(menu).toContainText("No open jobs.");
        await axeFrame(page, label);
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
      });
    }
  };
  await check(false);
  await withOpenJobs(page);
  await check(true);
  // Fix round 1: while the jobs load (answers held), with the placeholder
  // rows in their place.
  await test.step("1440x900-light while the jobs load", async () => {
    await page.setViewportSize(cases[2]);
    await openApp(page, { theme: cases[2].theme });
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      /\/api\/(mux\/jobs$|filecheck\/items\?)/,
      async (route) => {
        await held;
        await route.fallback();
      },
    );
    await page
      .getByRole("banner")
      .getByRole("button", { name: /open jobs/ })
      .click();
    const menu = jobsMenu(page);
    await expect(menu.locator('.v2-job[aria-hidden="true"]')).toHaveCount(6);
    await axeFrame(
      page,
      "1440x900-light with the jobs menu while its jobs load",
    );
    release();
    await expect(menu.locator(".v2-job:not([aria-hidden])")).toHaveCount(6);
    await page.keyboard.press("Escape");
  });
});

// Quick search (Task 13) in each mode, opened with Ctrl+K (phones have no
// button): with its pages and titles, without a match, and while its
// titles are on their way (answers held).
test("quick search has no axe violations", async ({ page }) => {
  test.setTimeout(240_000);
  // The title answers of the query "wait" are held until released.
  const held: (() => void)[] = [];
  await page.route(/\/api\/files\?.*limit=6/, async (route) => {
    if (route.request().url().includes("q=wait"))
      await new Promise<void>((resolve) => held.push(resolve));
    await route.fallback();
  });
  for (const item of [cases[0], cases[2], cases[3], cases[4]]) {
    await test.step(`${name(item)} with quick search`, async () => {
      await page.setViewportSize(item);
      await openApp(page, { theme: item.theme });
      await page.keyboard.press("Control+k");
      const dialog = quickSearch(page);
      const field = dialog.getByRole("combobox", { name: "Quick search" });
      const list = dialog.getByRole("listbox");
      await expect(field).toBeFocused();
      await axeFrame(page, `${name(item)} with quick search and its pages`);
      await field.fill("da");
      await expect(
        dialog.getByRole("group", { name: "TV series" }),
      ).toBeVisible();
      await expect(list).not.toHaveAttribute("aria-busy");
      await axeFrame(page, `${name(item)} with quick search and titles`);
      await field.fill("zzz");
      await expect(
        dialog.getByText("No matches.", { exact: true }),
      ).toBeVisible();
      await axeFrame(page, `${name(item)} with quick search without a match`);
      await field.fill("wait");
      await expect(list).toHaveAttribute("aria-busy", "true");
      await expect.poll(() => held.length).toBe(2);
      await axeFrame(
        page,
        `${name(item)} with quick search while its titles load`,
      );
      for (const go of held.splice(0)) go();
      await expect(list).not.toHaveAttribute("aria-busy");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    });
  }
});

// The libraries (Phase 5a, E28): axeView on the content of Movies and TV
// series and axeFrame on the frame with the instance segment, in each mode
// and theme: the list (card rows at 375), the track menu, the "+n" popover
// and the sort menu of the audio tracks (Arrival with four tracks), the
// filter drawer with an open value list, its operator menu and its help,
// the TV series' group rows and the empty state.
test("the libraries have no axe violations", async ({ page }) => {
  test.setTimeout(480_000);
  await withTwoMovieInstances(page);
  await withAudioTracks(page);
  const shown = async (locator: Locator, what: string, label: string) => {
    await expect(locator).toBeVisible();
    await axeView(page, `${label} with ${what}`);
    await page.keyboard.press("Escape");
    await expect(locator).toHaveCount(0);
  };
  for (const item of cases) {
    const label = name(item);
    await test.step(label, async () => {
      await page.setViewportSize(item);
      await openApp(page, { theme: item.theme });
      await goTo(page, "movies");
      await expect(page.locator(".v2-row--placeholder")).toHaveCount(0);
      await axeView(page, `${label} movies`);
      await axeFrame(page, `${label} movies`);
      const main = page.getByRole("main");
      await main
        .getByRole("button", { name: "All columns", exact: true })
        .click();
      const arrival = main.getByRole("row").filter({
        has: page.getByRole("checkbox", { name: "Select Arrival" }),
      });
      await arrival
        .getByRole("button", {
          name: "Track 1 · German · DTS · 5.1 · Default track",
          exact: true,
        })
        .click();
      await shown(
        page.getByRole("menu", { name: "Filter by this track" }),
        "the track menu",
        label,
      );
      await arrival
        .getByRole("button", {
          name: "+2 · Show all 4 audio tracks",
          exact: true,
        })
        .click();
      await shown(
        page.getByRole("dialog", { name: "Audio tracks of Arrival" }),
        "the tracks popover",
        label,
      );
      await main
        .getByRole("button", { name: "Sort by Audio tracks", exact: true })
        .click();
      await shown(
        page.getByRole("menu", { name: "Sort by Audio tracks" }),
        "the sort menu",
        label,
      );
      await main
        .getByRole("button", { name: "Default view", exact: true })
        .click();
      await main.getByRole("button", { name: "Filters", exact: true }).click();
      const drawer = filterDrawer(page);
      await expect(drawer).toBeVisible();
      await settle(page);
      await axeView(page, `${label} with the filter drawer`);
      await drawer
        .getByRole("button", { name: "Resolution All", exact: true })
        .click();
      await expect(drawer.locator(".v2-ff-opt").first()).toBeVisible();
      await axeView(page, `${label} with the drawer's values`);
      await drawer
        .getByRole("button", {
          name: "HDR: contains at least one",
          exact: true,
        })
        .click();
      await shown(
        page.getByRole("menu", { name: "HDR: operator" }),
        "the drawer's operator menu",
        label,
      );
      await drawer
        .getByRole("button", { name: "Filter logic", exact: true })
        .click();
      await shown(page.locator(".v2-pop"), "the drawer's help", label);
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await goTo(page, "series");
      await expect(page.locator(".v2-row--placeholder")).toHaveCount(0);
      await axeView(page, `${label} TV series`);
      await page.evaluate(() => {
        location.hash = "#/movies?q=zzzz";
      });
      await expect.poll(() => currentHash(page)).toBe("#/movies?q=zzzz");
      await expect(
        page.getByText("No matching files.", { exact: true }),
      ).toBeVisible();
      await axeView(page, `${label} with the empty state`);
      // The library keeps its filters through a reload: the next case
      // starts without them.
      await main
        .getByRole("button", { name: "Reset filters", exact: true })
        .first()
        .click();
      await expect.poll(() => currentHash(page)).toBe("#/movies");
    });
  }
});

// The dashboard (Phase 5a, E28): axeView on its content and axeFrame on
// the frame, in each mode and theme: loaded (the Codec card with More, the
// storage ring with an area's error), with a matching HelpTip open, with
// More open, on the TV series tab, while loading (placeholders), empty (no
// files in cache, no storage paths) and after a failed load with Retry.
test("the dashboard has no axe violations", async ({ page }) => {
  test.setTimeout(480_000);
  let mode: "data" | "empty" | "error" | "hold" = "data";
  const held: (() => void)[] = [];
  const zero = { all: 0, radarr: 0, sonarr: 0 };
  await withMoreValues(page);
  await page.route(/\/api\/statistics$/, async (route) => {
    if (mode === "error")
      return route.fulfill({ status: 500, json: { error: "unavailable" } });
    if (mode === "empty")
      return route.fulfill({
        json: {
          fileTotals: zero,
          languageTotals: zero,
          movies: 0,
          series: 0,
          episodes: 0,
          files: 0,
          emby: {},
          incomplete: 0,
          distributions: { all: {}, radarr: {}, sonarr: {} },
        },
      });
    if (mode === "hold") await new Promise<void>((go) => held.push(go));
    await route.fallback();
  });
  await page.route(/\/api\/storage$/, (route) =>
    mode === "empty"
      ? route.fallback()
      : route.fulfill({
          json: {
            services: {},
            areas: {
              all: [
                storageArea("movies", 9.3, {
                  error:
                    "Shared storage readings have different total capacities",
                }),
                storageArea("series", 3),
              ],
              radarr: [],
              sonarr: [],
            },
          },
        }),
  );
  const main = page.getByRole("main");
  const kpi = page.locator(".v2-dash-kpis .v2-kpi-value").first();
  for (const item of cases) {
    const label = name(item);
    await test.step(label, async () => {
      mode = "data";
      await page.setViewportSize(item);
      await openApp(page, { theme: item.theme });
      await expect(kpi).toHaveText(/\d/);
      await expect(main.locator(".v2-ring-error")).toBeVisible();
      await axeView(page, `${label} dashboard`);
      await axeFrame(page, `${label} dashboard`);
      await main.getByRole("button", { name: "Matched", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Matched" })).toBeVisible();
      await axeView(page, `${label} with a HelpTip`);
      await page.keyboard.press("Escape");
      await expect(page.locator(".v2-pop")).toHaveCount(0);
      await main.getByRole("button", { name: "More", exact: true }).click();
      await expect(
        main.getByRole("button", { name: "Less", exact: true }),
      ).toBeVisible();
      await axeView(page, `${label} with More open`);
      await main
        .getByRole("tablist", { name: "Statistics scope" })
        .getByRole("tab", { name: "TV series", exact: true })
        .click();
      await settle(page);
      await axeView(page, `${label} TV series`);
      // The next case starts on the entire library.
      await main
        .getByRole("tab", { name: "Entire library", exact: true })
        .click();

      mode = "hold";
      await page.goto("about:blank");
      await page.goto("/#/dashboard");
      await expect(
        page.getByRole("status").filter({ hasText: "Loading dashboard …" }),
      ).toHaveCount(1);
      await page.evaluate(() => document.fonts.ready);
      await axeView(page, `${label} while loading`);
      mode = "data";
      for (const go of held.splice(0)) go();
      await expect(kpi).toHaveText(/\d/);

      mode = "empty";
      await openApp(page, { theme: item.theme });
      await expect(
        main.getByText("No files in cache yet", { exact: true }),
      ).toHaveCount(5);
      await expect(main.locator(".v2-ring-note")).toBeVisible();
      await axeView(page, `${label} empty`);

      mode = "error";
      await openApp(page, { theme: item.theme });
      const retry = main.getByRole("button", { name: "Retry", exact: true });
      await expect(retry).toBeVisible();
      await axeView(page, `${label} after a failed load`);
      await axeFrame(page, `${label} after a failed load`);
    });
  }
});

// Sign-in, setup and the loading screen (Task 15), as whole pages in both
// themes at 1440 and 375: the password hidden and shown (ruling R-A); setup
// with its code field; the loading screen while the status is held. Each
// case is a fresh signed-out browser context with its stored theme.
const screens = [cases[1], cases[2], cases[4], cases[5]];

async function signedOut(browser: Browser, item: Case): Promise<Page> {
  const { baseURL, locale } = test.info().project.use;
  const context = await browser.newContext({
    baseURL,
    locale,
    viewport: { width: item.width, height: item.height },
    reducedMotion: "reduce",
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.addInitScript((value) => {
    try {
      localStorage.setItem("scopearr-theme", value);
    } catch {
      // Storage can be blocked; the default theme is then used.
    }
  }, item.theme);
  return page;
}

async function checkPassword(page: Page, label: string) {
  await axeScreen(page, label);
  const toggle = page.getByRole("button", {
    name: "Show password",
    exact: true,
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await axeScreen(page, `${label} with the password shown`);
}

test("the sign-in page has no axe violations", async ({ browser }) => {
  test.setTimeout(240_000);
  for (const item of screens) {
    await test.step(name(item), async () => {
      const page = await signedOut(browser, item);
      await page.goto("/");
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
      await checkPassword(page, `${name(item)} sign-in`);
      await page.context().close();
    });
  }
});

test("setup and the loading screen have no axe violations", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  for (const item of screens) {
    await test.step(name(item), async () => {
      const page = await signedOut(browser, item);
      await withStatus(page, (status) => {
        (status as { initialized?: boolean }).initialized = false;
      });
      // The status answers are held: the loading screen stays.
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route(/\/api\/status$/, async (route) => {
        await held;
        await route.fallback();
      });
      await page.goto("/");
      await expect(page.locator(".v2-loading")).toBeVisible();
      await axeScreen(page, `${name(item)} loading screen`);
      release();
      await expect(
        page.getByRole("button", { name: "Create account", exact: true }),
      ).toBeVisible();
      await checkPassword(page, `${name(item)} setup`);
      await page.context().close();
    });
  }
});

// Fix round 1: sign-in after an expired session, with the warn-toned notice,
// in both themes. The session ends in this browser context only (as in
// behavior.spec), so the stored demo session stays valid.
test("sign-in after an expired session has no axe violations", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  for (const item of [cases[1], cases[2]]) {
    await test.step(name(item), async () => {
      const { baseURL, locale, storageState } = test.info().project.use;
      const context = await browser.newContext({
        baseURL,
        locale,
        storageState,
        viewport: { width: item.width, height: item.height },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await openApp(page, { theme: item.theme });
      await context.clearCookies();
      await page.evaluate(() =>
        window.dispatchEvent(new Event("scopearr:unauthorized")),
      );
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Your session expired. Sign in again." }),
      ).toBeVisible();
      await expect(page.locator(".v2-notice--warn")).toBeVisible();
      await axeScreen(page, `${name(item)} sign-in after an expired session`);
      await context.close();
    });
  }
});

// Fix round 1: fields and the language select show focus by their border
// and shadow, which forced colors drop; a transparent outline (painted by
// the system colors there) keeps their focus visible.
test("sign-in fields keep a focus outline in forced colors", async ({
  browser,
}) => {
  const page = await signedOut(browser, cases[1]);
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/");
  for (const control of [
    page.getByLabel("Username", { exact: true }),
    page.getByLabel("Password", { exact: true }),
    page.getByRole("combobox", { name: "Interface language" }),
  ]) {
    await control.focus();
    await expect(control).toBeFocused();
    expect(
      await control.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.outlineStyle, style.outlineWidth];
      }),
    ).toEqual(["solid", "2px"]);
  }
  await page.context().close();
});

// Final review I3: forced colors drop backgrounds, gradients and shadows,
// so quick search's field (no ring, the caret shows it), its active option
// (a tint) and the current page's tile in the rail and the tab bar (a
// gradient) carry a transparent 2px outline that forced colors paint. The
// other options and tiles have none; without forced colors it draws
// nothing (the pixel run).
test("frame markers stay visible in forced colors", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  const outline = (locator: Locator) =>
    locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        style: style.outlineStyle,
        width: style.outlineWidth,
        painted: !/^rgba\(.*,\s*0\)$|^transparent$/.test(style.outlineColor),
      };
    });
  const shown = { style: "solid", width: "2px", painted: true };
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  const nav = mainNavigation(page);

  await test.step("the rail's current page", async () => {
    const current = nav.locator('[aria-current="page"] .v2-tile');
    await expect(current).toHaveCount(1);
    expect(await outline(current)).toEqual(shown);
    const other = nav.getByRole("link", { name: "Movies", exact: true });
    expect((await outline(other.locator(".v2-tile"))).style).toBe("none");
  });

  await test.step("quick search's field and active option", async () => {
    await page.keyboard.press("Control+k");
    const dialog = quickSearch(page);
    const field = dialog.getByRole("combobox", { name: "Quick search" });
    await expect(field).toBeFocused();
    expect(await outline(field)).toEqual(shown);
    const options = dialog.getByRole("option");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    expect(await outline(options.first())).toEqual(shown);
    expect((await outline(options.nth(1))).style).toBe("none");
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    expect(await outline(options.nth(1))).toEqual(shown);
    expect((await outline(options.first())).style).toBe("none");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  await test.step("the tab bar's current page", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    const tabs = page.locator(".v2-tabbar");
    await expect(tabs).toBeVisible();
    const current = tabs.locator("[aria-current] .v2-tab-tile");
    await expect(current).toHaveCount(1);
    expect(await outline(current)).toEqual(shown);
    const other = tabs.getByRole("link", { name: "Movies", exact: true });
    expect((await outline(other.locator(".v2-tab-tile"))).style).toBe("none");
  });
});

// 5a final review I5 and M2: the current item of a segment (the
// dashboard's scope tab, the instance segment's link) and the current page
// button carry the inset transparent outline that forced colors paint
// (offset -2), and only while they have no focus: focused (by keyboard),
// they show the focus ring outside (offset 2), so focus stays visible on
// the current item (WCAG 2.4.7). The other items have no outline.
test("current items show their focus ring in forced colors", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await withTwoMovieInstances(page);
  const outline = (locator: Locator) =>
    locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        style: style.outlineStyle,
        width: style.outlineWidth,
        offset: style.outlineOffset,
        painted: !/^rgba\(.*,\s*0\)$|^transparent$/.test(style.outlineColor),
      };
    });
  const marked = {
    style: "solid",
    width: "2px",
    offset: "-2px",
    painted: true,
  };
  const ring = { ...marked, offset: "2px" };
  // Focus by keyboard, as a user tabs there: the ring is :focus-visible.
  const keyboardFocus = async (locator: Locator) => {
    await page.keyboard.press("Shift");
    await locator.focus();
    await expect(locator).toBeFocused();
    expect(
      await locator.evaluate((element) => element.matches(":focus-visible")),
    ).toBe(true);
  };
  const check = async (current: Locator, other: Locator) => {
    expect(await outline(current), "the current item").toEqual(marked);
    expect((await outline(other)).style, "another item").toBe("none");
    await keyboardFocus(current);
    expect(await outline(current), "the focused current item").toEqual(ring);
    await keyboardFocus(other);
    expect(await outline(current), "the current item again").toEqual(marked);
    expect(await outline(other), "the focused other item").toEqual(ring);
  };

  await test.step("the dashboard's scope tab", async () => {
    await openRoute(page, "#/dashboard");
    const tabs = page.getByRole("tablist", { name: "Statistics scope" });
    await check(
      tabs.getByRole("tab", { name: "Entire library", exact: true }),
      tabs.getByRole("tab", { name: "Movies", exact: true }),
    );
  });

  await test.step("the instance segment", async () => {
    await openRoute(page, "#/movies");
    const segment = page.getByRole("navigation", { name: "Instances" });
    await check(
      segment.getByRole("link", { name: "All", exact: true }),
      segment.getByRole("link", { name: "Radarr 4K", exact: true }),
    );
  });

  await test.step("the current page button", async () => {
    await openRoute(page, "#/series");
    const pager = page.getByRole("navigation", { name: "Page 1 / 2" });
    await check(
      pager.getByRole("button", { name: "1", exact: true }),
      pager.getByRole("button", { name: "2", exact: true }),
    );
  });
});
