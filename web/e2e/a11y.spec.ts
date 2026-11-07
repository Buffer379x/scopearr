// axe-core on the frame (D18, E23): WCAG 2.0 and 2.1, A and AA, on the
// visible frame regions in every mode and its open states. Zero violations;
// incomplete results are logged. The 1.7.0 content is checked with its
// rebuild in Phase 5.
import { expect, test, type Page } from "@playwright/test";
import {
  axeFrame,
  goTo,
  mainNavigation,
  openApp,
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

test("the frame has no axe violations", async ({ page }) => {
  test.setTimeout(240_000);
  for (const item of cases) {
    await test.step(name(item), async () => {
      await page.setViewportSize(item);
      await openApp(page, { theme: item.theme });
      await checkStates(page, name(item));
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
