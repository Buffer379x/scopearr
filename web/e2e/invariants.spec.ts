// Layout invariants that hold on the current interface and must keep holding.
// Measured after network idle and loaded fonts; tolerance 0.5 px.
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  goTo,
  openApp,
  pageOverflowX,
  rect,
  settingsSection,
  settingsSections,
  type View,
} from "./app";

const TOLERANCE = 0.5;
const lists: View[] = ["movies", "series", "mux", "placement", "files"];

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

function headerActions(page: Page): Record<string, Locator> {
  const header = page.getByRole("banner");
  return {
    theme: header.getByRole("button", { name: /^(Light|Dark) theme$/ }),
    settings: header.getByRole("button", { name: "Settings", exact: true }),
    signOut: header.getByRole("button", { name: "Sign out", exact: true }),
  };
}

test("tool pages share header, title and filter geometry", async ({ page }) => {
  for (const size of [desktop, tablet]) {
    await test.step(label(size), async () => {
      await start(page, size);
      let first: { view: View; title: number; filters: number } | undefined;
      for (const view of lists) {
        await goTo(page, view);
        const title = (await rect(page, ".library-intro h1")).top;
        const filters = (await rect(page, ".filter-panel")).top;
        if (!first) {
          first = { view, title, filters };
          continue;
        }
        const where = `${view} vs ${first.view} at ${label(size)}`;
        expectSame(title, first.title, `${where}, .library-intro h1 top`);
        expectSame(filters, first.filters, `${where}, .filter-panel top`);
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
        for (const [name, button] of Object.entries(headerActions(page))) {
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

// Targets for later phases (concept §1 success criteria). 1.7.0 does not meet them yet.
test.fixme("movies shows at least 10 rows above the fold at 1440x900", async ({
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
});

test.fixme("expanded filters cover at most 60% of the viewport", async ({
  page,
}) => {
  await start(page, desktop);
  for (const view of lists) {
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

test.fixme("mobile result headings share one height", async ({ page }) => {
  await start(page, phone);
  let first: { view: View; height: number } | undefined;
  for (const view of lists) {
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
