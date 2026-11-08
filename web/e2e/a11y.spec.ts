// axe-core on the frame (D18, E23): WCAG 2.0 and 2.1, A and AA, on the
// visible frame regions in every mode and its open states. Zero violations;
// incomplete results are logged. The 1.7.0 content is checked with its
// rebuild in Phase 5; sign-in, setup and the loading screen are v2 as a
// whole (Task 15).
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  axeFrame,
  axeScreen,
  goTo,
  jobsMenu,
  mainNavigation,
  openApp,
  quickSearch,
  syncPopover,
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
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Hide password", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
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
