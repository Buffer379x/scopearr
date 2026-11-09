// Layout invariants that hold on the current interface and must keep holding.
// Measured after network idle and loaded fonts; tolerance 0.5 px.
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  goTo,
  mainNavigation,
  openApp,
  pageOverflowX,
  rect,
  settingsSection,
  settingsSections,
  surfaceTop,
  type View,
} from "./app";

const TOLERANCE = 0.5;
const lists: View[] = ["movies", "series", "mux", "placement", "files"];
// The libraries carry their filters in the card head (Phase 5a); the tools
// keep the 1.7.0 filter panel until Phase 5b.
const filtersOf = (view: View) =>
  view === "movies" || view === "series" ? ".v2-filter-bar" : ".filter-panel";

type Size = { width: number; height: number };
const desktop: Size = { width: 1440, height: 900 };
const tablet: Size = { width: 820, height: 1180 };
const phone: Size = { width: 375, height: 812 };
type Box = { x: number; y: number; width: number; height: number };
const label = ({ width, height }: Size) => `${width}x${height}`;

async function start(page: Page, size: Size) {
  await page.setViewportSize(size);
  await openApp(page, { theme: "dark" });
}

// Fails with the measured value, the expected value and where they differ.
function expectSame(actual: number, expected: number, what: string) {
  expect(
    Math.abs(actual - expected),
    `${what}: got ${actual}px, expected ${expected}px (±${TOLERANCE}px)`,
  ).toBeLessThanOrEqual(TOLERANCE);
}

// The frame's fixed actions: theme, bell and sign out in the topbar. Phones
// have theme and bell there; sign out moved into the drawer, whose list
// grows with its open groups, so the fixed tab bar's Tools and More stand
// in for it.
function headerActions(page: Page, size: Size): Record<string, Locator> {
  const header = page.getByRole("banner");
  const actions: Record<string, Locator> = {
    theme: header.getByRole("button", { name: /^(Light|Dark) theme$/ }),
    bell: header.getByRole("button", { name: /^Tools, \d+ open jobs$/ }),
  };
  if (size.width > 739)
    actions.signOut = header.getByRole("button", {
      name: "Sign out",
      exact: true,
    });
  else {
    const tabs = mainNavigation(page);
    actions.tools = tabs.getByRole("button", { name: "Tools", exact: true });
    actions.more = tabs.getByRole("button", { name: "More", exact: true });
  }
  return actions;
}

test("tool pages share header, title and filter geometry", async ({ page }) => {
  for (const size of [desktop, tablet]) {
    await test.step(label(size), async () => {
      await start(page, size);
      let first: { view: View; title: number } | undefined;
      const firstFilters: Record<string, { view: View; top: number }> = {};
      for (const view of lists) {
        await goTo(page, view);
        const title = (await rect(page, "main h1")).top;
        const selector = filtersOf(view);
        const filters = (await rect(page, selector)).top;
        if (!first) first = { view, title };
        else
          expectSame(
            title,
            first.title,
            `${view} vs ${first.view} at ${label(size)}, main h1 top`,
          );
        const shared = firstFilters[selector];
        if (!shared) firstFilters[selector] = { view, top: filters };
        else
          expectSame(
            filters,
            shared.top,
            `${view} vs ${shared.view} at ${label(size)}, ${selector} top`,
          );
      }
    });
  }
});

test("header actions keep one geometry", async ({ page }) => {
  const views: View[] = ["dashboard", ...lists, "settings"];
  for (const size of [desktop, phone]) {
    await test.step(label(size), async () => {
      await start(page, size);
      let first: { view: View; boxes: Record<string, Box> } | undefined;
      for (const view of views) {
        await goTo(page, view);
        const boxes: Record<string, Box> = {};
        for (const [name, button] of Object.entries(
          headerActions(page, size),
        )) {
          const box = await button.boundingBox();
          if (!box) throw new Error(`${name} button is not visible on ${view}`);
          boxes[name] = box;
        }
        if (!first) {
          first = { view, boxes };
          continue;
        }
        for (const [name, box] of Object.entries(boxes)) {
          const base = first.boxes[name];
          const where = `${name} button on ${view} vs ${first.view} at ${label(size)}`;
          expectSame(box.x, base.x, `${where}, x`);
          expectSame(box.y, base.y, `${where}, y`);
          expectSame(box.width, base.width, `${where}, width`);
          expectSame(box.height, base.height, `${where}, height`);
        }
      }
    });
  }
});

// The band and the transition sheet have fixed places (E2): from 740px the
// band is 16 from the top and 194 high, below 740 it starts at 0 and is 220
// high (the frame holds the topbar's margin); the sheet, and with it the
// page content, starts at 146 (phones 172) on every page; a rebuilt page
// (the libraries, Phase 5a) has no sheet, and its first card starts there.
test("the band and the transition sheet keep their place", async ({ page }) => {
  for (const [size, band, sheet] of [
    [desktop, { y: 16, height: 194 }, 146],
    [tablet, { y: 16, height: 194 }, 146],
    [phone, { y: 0, height: 220 }, 172],
  ] as const) {
    await test.step(label(size), async () => {
      await start(page, size);
      for (const view of ["dashboard", "movies", "mux", "settings"] as View[]) {
        await goTo(page, view);
        const where = `${view} at ${label(size)}`;
        const box = await rect(page, ".v2-band");
        expectSame(box.top, band.y, `${where}, band top`);
        expectSame(box.height, band.height, `${where}, band height`);
        const head = await rect(page, ".v2-page-head");
        expectSame(head.bottom, sheet, `${where}, page header bottom`);
        // The sheet is main's ::before, or the first card of a page
        // without one; the content starts with it.
        expectSame(await surfaceTop(page), sheet, `${where}, sheet top`);
        expectSame(
          (await rect(page, ".v2-view")).top,
          sheet,
          `${where}, content top`,
        );
      }
    });
  }
});

// The 1.7.0 settings heading sticks right under the topbar (bottom 60,
// phones 58) and shows its line once stuck.
test("the settings heading sticks under the topbar with its line", async ({
  page,
}) => {
  for (const size of [desktop, phone]) {
    await test.step(label(size), async () => {
      await start(page, size);
      await goTo(page, "settings");
      const heading = page
        .locator(".settings-section-heading")
        .filter({ visible: true })
        .first();
      const line = () =>
        heading.evaluate((el) => getComputedStyle(el).borderBottomColor);
      await expect(heading).not.toHaveClass(/\bscrolled\b/);
      const unstuck = await line();
      await page.evaluate(() => window.scrollTo(0, 600));
      await expect(heading).toHaveClass(/\bscrolled\b/);
      expect(await line(), "the stuck heading shows its line").not.toBe(
        unstuck,
      );
      const topbar = await rect(page, ".v2-topbar");
      const box = await heading.boundingBox();
      if (!box) throw new Error("the settings heading is not visible");
      const where = `settings heading at ${label(size)}`;
      expectSame(
        topbar.bottom,
        size.width > 739 ? 60 : 58,
        `${where}, topbar bottom`,
      );
      expectSame(box.y, topbar.bottom, `${where}, top`);
    });
  }
});

test("no horizontal page overflow", async ({ page }) => {
  for (const size of [phone, desktop]) {
    await test.step(label(size), async () => {
      await start(page, size);
      for (const view of ["dashboard", ...lists] as View[]) {
        await goTo(page, view);
        expect(
          await pageOverflowX(page),
          `${view} at ${label(size)} scrolls sideways`,
        ).toBeLessThanOrEqual(0);
      }
      await goTo(page, "settings");
      for (const section of settingsSections) {
        await settingsSection(page, section);
        expect(
          await pageOverflowX(page),
          `Settings → ${section} at ${label(size)} scrolls sideways`,
        ).toBeLessThanOrEqual(0);
      }
    });
  }
});

// Concept §1 success criteria. The libraries meet them since Phase 5a
// (their parts of the two targets below are in library.spec.ts: "the
// filter drawer leaves the table in place" and "mobile result headings
// share one height"); the tool pages keep the 1.7.0 filter panel and
// result heading until Phase 5b, which owns the two targets.
test("movies shows at least 10 rows above the fold at 1440x900", async ({
  page,
}) => {
  await start(page, desktop);
  await goTo(page, "movies");
  const rows = await page.evaluate(
    () =>
      [...document.querySelectorAll("main tbody tr")].filter((row) => {
        const box = row.getBoundingClientRect();
        return (
          box.height > 0 && box.top >= 0 && box.bottom <= window.innerHeight
        );
      }).length,
  );
  expect(rows, "fully visible movie rows at 1440x900").toBeGreaterThanOrEqual(
    10,
  );
  // The first row starts right below the table header (Phase 5a brief).
  expect(
    (await rect(page, "main tbody tr")).top,
    "first movie row top at 1440x900",
  ).toBeLessThanOrEqual(301);
});

const tools: View[] = ["mux", "placement", "files"];

// Owner: Phase 5b (the tools' filter drawer).
test.fixme("expanded filters cover at most 60% of the viewport", async ({
  page,
}) => {
  await start(page, desktop);
  for (const view of tools) {
    await goTo(page, view);
    const toggle = page.locator(".filter-panel button[aria-expanded]").first();
    if ((await toggle.getAttribute("aria-expanded")) !== "true")
      await toggle.click();
    const panel = await rect(page, ".filter-panel");
    expect(
      panel.height / desktop.height,
      `${view}: expanded filters are ${panel.height}px of ${desktop.height}px`,
    ).toBeLessThanOrEqual(0.6);
  }
});

// Owner: Phase 5b (the tools' table cards).
test.fixme("mobile result headings share one height", async ({ page }) => {
  await start(page, phone);
  let first: { view: View; height: number } | undefined;
  for (const view of tools) {
    await goTo(page, view);
    const height = (await rect(page, ".results-heading")).height;
    if (!first) first = { view, height };
    else
      expectSame(
        height,
        first.height,
        `${view} vs ${first.view}, .results-heading height`,
      );
  }
});
