// axe-core on the frame (D18, E23): WCAG 2.0 and 2.1, A and AA, on the
// visible frame regions in every mode and its open states. Zero violations;
// incomplete results are logged. The 1.7.0 content is checked with its
// rebuild in Phase 5.
import { expect, test, type Page } from "@playwright/test";
import {
  axeFrame,
  goTo,
  jobsMenu,
  mainNavigation,
  openApp,
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
        if (jobs) await expect(menu.locator(".v2-job")).toHaveCount(6);
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
});
