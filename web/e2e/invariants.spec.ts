// Layout invariants that hold on the current interface and must keep holding.
// Measured after network idle and loaded fonts; tolerance 0.5 px.
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  goTo,
  inLanguage,
  LANGUAGES,
  mainNavigation,
  openApp,
  openRoute,
  pageOverflowX,
  rect,
  settingsSection,
  settingsSections,
  surfaceTop,
  withOpenJobs,
  type View,
} from "./app";
import { muxJob, withMuxJobs } from "./tool-fixtures";

const TOLERANCE = 0.5;
const lists: View[] = ["movies", "series", "mux", "placement", "files"];
// The libraries and Muxing carry their filters in the card head (Phase
// 5a, Phase 5b Task 6); Disk placement and Files & permissions keep the
// 1.7.0 filter panel until their switch (Tasks 7 and 8).
const V2_LISTS: View[] = ["movies", "series", "mux"];
const filtersOf = (view: View) =>
  V2_LISTS.includes(view) ? ".v2-filter-bar" : ".filter-panel";

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
        // A v2 list's filter bar sits in its card head: its place in the
        // card is the same on every v2 list; the card itself follows the
        // blocks above it (Muxing's KPI row and setup notice).
        const filters =
          (await rect(page, selector)).top -
          (selector === ".v2-filter-bar"
            ? (await rect(page, ".v2-table-card")).top
            : 0);
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
// (the libraries and the dashboard, Phase 5a) has no sheet, and its first
// card starts there.
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

// Tool table headers after a late web font (Phase 5a, E22): with the
// typeface 1.5s late, fontsReady in main.tsx renders after 1s with the
// fallback and the mux table (the open jobs of withOpenJobs) comes before
// the face; once it arrives the headers are measured again and get the
// widths they have with the face from the start, in four languages.
test("tool headers fit after the font arrives late", async ({ page }) => {
  test.setTimeout(120_000);
  await withOpenJobs(page);
  // Whether the table was there before the face, recorded on every load.
  await page.addInitScript(() => {
    const w = window as unknown as { __tableBeforeFont?: boolean };
    new MutationObserver((_, observer) => {
      if (!document.querySelector("table.v2-table--fixed thead th")) return;
      const family = getComputedStyle(document.documentElement)
        .getPropertyValue("--font")
        .trim();
      w.__tableBeforeFont = !document.fonts.check("1em " + family);
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
  const headers = async () => {
    await expect(page.locator("table.v2-table--fixed tbody tr")).toHaveCount(4);
    return page.evaluate(() => ({
      before: (window as unknown as { __tableBeforeFont?: boolean })
        .__tableBeforeFont,
      cells: [
        ...document.querySelectorAll("table.v2-table--fixed thead th"),
      ].map((cell) => ({
        name: cell.textContent?.trim() || cell.className,
        width: cell.getBoundingClientRect().width,
        clipped: cell.scrollWidth > cell.clientWidth,
      })),
    }));
  };
  const late = /\/assets\/inter-[\w-]+\.woff2$/;
  for (const language of LANGUAGES) {
    await test.step(language, async () => {
      await inLanguage(page, language);
      await page.goto("about:blank");
      await openRoute(page, "#/tools/mux");
      const ready = await headers();
      expect(ready.before, "the face is there before the table").toBe(false);

      await page.route(late, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      });
      await page.goto("about:blank");
      await openRoute(page, "#/tools/mux");
      const after = await headers();
      await page.unroute(late);
      expect(after.before, "the table comes before the face").toBe(true);
      expect(after.cells.map((cell) => cell.name)).toEqual(
        ready.cells.map((cell) => cell.name),
      );
      after.cells.forEach((cell, i) => {
        expectSame(
          cell.width,
          ready.cells[i].width,
          `${language}: the ${cell.name} header after the late face`,
        );
        expect(cell.clipped, `${language}: ${cell.name} is cut`).toBe(false);
      });
    });
  }
});

// Ruling I14 (Phase 5b, Task 6): polling moves a job from waiting to
// running to successful, and nothing of its row moves: every column keeps
// its place and width, Start keeps its place (always there, locked while
// the job cannot start) and the removing action stays second (Cancel,
// then Remove). The row may change its place in the list (running jobs
// come first), so its parts are measured from the row's own top.
test("mux rows keep their columns and buttons while a job runs", async ({
  page,
}) => {
  const steps = [
    { status: "queued", progress: 0, shown: "Waiting" },
    { status: "running", progress: 64, shown: "Running" },
    { status: "succeeded", progress: 100, shown: "Successful" },
  ];
  let step = 0;
  await withMuxJobs(page, () => [
    muxJob(1, steps[step].status, "Arrival", "Arrival (2016).mkv", {
      progress: steps[step].progress,
    }),
    muxJob(2, "ready", "Dune", "Dune (2021).mkv"),
  ]);
  await start(page, desktop);
  await openRoute(page, "#/tools/mux");
  const row = page
    .locator("table.v2-table--fixed tbody tr")
    .filter({ hasText: "Arrival (2016).mkv" });
  const measure = () =>
    row.evaluate((tr) => {
      const top = tr.getBoundingClientRect().top;
      const box = (element: Element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y: y - top, width, height };
      };
      return {
        cells: [...tr.children].map(box),
        buttons: [...tr.querySelectorAll(".v2-row-btn")]
          .filter((button) => getComputedStyle(button).display !== "none")
          .map(box),
        heads: [...tr.closest("table")!.querySelectorAll("thead th")].map(
          (th) => {
            const { x, width } = th.getBoundingClientRect();
            return { x, width };
          },
        ),
      };
    });
  const shape = async (shown: string) => {
    await expect(
      row.getByRole("button", { name: `Status: ${shown}. Show checks` }),
    ).toBeVisible({ timeout: 10_000 });
    return measure();
  };
  const first = await shape(steps[0].shown);
  // Info: Mux options and Terminal; Actions: Start and Cancel.
  expect(first.buttons).toHaveLength(4);
  for (const index of [1, 2]) {
    step = index;
    const now = await shape(steps[index].shown);
    const where = `${steps[index].status} vs ${steps[0].status}`;
    expect(now.buttons, where).toHaveLength(first.buttons.length);
    for (const [part, list] of Object.entries(now))
      list.forEach((box, i) => {
        const base = (first as Record<string, Record<string, number>[]>)[part][
          i
        ];
        for (const [edge, value] of Object.entries(box))
          expectSame(value, base[edge], `${where}, ${part} ${i} ${edge}`);
      });
  }
  // Start stays first: locked while the job waits, runs or succeeded.
  await expect(
    row.getByRole("button", { name: "Start item Arrival", exact: true }),
  ).toBeDisabled();
  await expect(
    row.getByRole("button", {
      name: "Remove Arrival (2016).mkv from the list",
      exact: true,
    }),
  ).toBeEnabled();
});
