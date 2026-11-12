// Layout invariants that hold on the current interface and must keep holding.
// Measured after network idle and loaded fonts; tolerance 0.5 px.
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ALL,
  boxesOf,
  expectSteady,
  filterDrawer,
  goTo,
  inLanguage,
  LANGUAGES,
  mainNavigation,
  openApp,
  openRoute,
  pageOverflowX,
  recordBoxes,
  recordedBoxes,
  rect,
  sectionLink,
  settle,
  settingsSection,
  settingsSections,
  surfaceTop,
  withOpenJobs,
  type Edge,
  type View,
} from "./app";
import {
  finding,
  findings,
  muxJob,
  muxJobs,
  placementItem,
  placementItems,
  withFindings,
  withMuxJobs,
  withPlacement,
} from "./tool-fixtures";

const TOLERANCE = 0.5;
// The five lists: the libraries (Phase 5a) and the tools (Phase 5b) carry
// their filters in the head of their table card.
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

// All five lists (Phase 5b, Task 8: one test for the libraries and the
// tools): the page title at one place, the table card at one left edge and
// width, and the filter bar at one place in the card head. The card itself
// follows the blocks above it (Muxing's KPI row and setup notice, Disk
// placement's disk row, Files & permissions' KPI row).
test("list pages share header, title, card and filter bar geometry", async ({
  page,
}) => {
  for (const size of [desktop, tablet]) {
    await test.step(label(size), async () => {
      await start(page, size);
      let first:
        | {
            view: View;
            title: number;
            card: Box;
            filters: { right: number; y: number; height: number };
          }
        | undefined;
      for (const view of lists) {
        await goTo(page, view);
        const title = (await rect(page, "main h1")).top;
        const card = await rect(page, ".v2-table-card");
        const bar = await rect(page, ".v2-filter-bar");
        // The bar ends at the card head's right edge, its width follows
        // its parts.
        const filters = {
          right: card.right - bar.right,
          y: bar.top - card.top,
          height: bar.height,
        };
        const box = {
          x: card.left,
          y: card.top,
          width: card.width,
          height: card.height,
        };
        if (!first) {
          first = { view, title, card: box, filters };
          continue;
        }
        const where = `${view} vs ${first.view} at ${label(size)}`;
        expectSame(title, first.title, `${where}, main h1 top`);
        expectSame(box.x, first.card.x, `${where}, card left`);
        expectSame(box.width, first.card.width, `${where}, card width`);
        for (const edge of ["right", "y", "height"] as const)
          expectSame(
            filters[edge],
            first.filters[edge],
            `${where}, .v2-filter-bar ${edge} in the card`,
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
// phones 58) and shows its line once stuck; Tag rules has it until Phase 5c
// rebuilds it (Services, Display, Widgets and Custom tags have the band's
// header). Its rules list is long enough to scroll past the heading's
// sticky top at 1440x900.
test("the settings heading sticks under the topbar with its line", async ({
  page,
}) => {
  for (const size of [desktop, phone]) {
    await test.step(label(size), async () => {
      await start(page, size);
      await goTo(page, "settings");
      await settingsSection(page, "Tag rules");
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

// The tool pages with rows (Phase 5b, Task 10), in all four languages:
// no width scrolls the page sideways, also with a table that scrolls
// inside its card and is scrolled to its end. Hidden texts in the rows
// (the disk tags' and status buttons' descriptions) stay inside the
// table's region.
test("tool rows never scroll the page sideways", async ({ page }) => {
  test.setTimeout(300_000);
  await withMuxJobs(page);
  await withPlacement(page, { standby: true });
  await withFindings(page);
  for (const language of LANGUAGES)
    await test.step(language, async () => {
      await inLanguage(page, language);
      for (const width of [1440, 1119, 820, 740, 375, 320]) {
        const size = { width, height: width <= 739 ? 812 : 900 };
        await page.setViewportSize(size);
        for (const view of tools) {
          await page.goto("about:blank");
          await openRoute(page, "#/tools/" + view);
          await expect(
            page.locator("table.v2-table--fixed > tbody > tr").first(),
          ).toBeVisible({ timeout: 15_000 });
          const where = `${view} in ${language} at ${label(size)}`;
          expect(
            await pageOverflowX(page),
            `${where} scrolls sideways`,
          ).toBeLessThanOrEqual(0);
          await page
            .locator(".v2-table-scroll")
            .evaluate((region) =>
              region.scrollTo({ left: region.scrollWidth }),
            );
          expect(
            await pageOverflowX(page),
            `${where} scrolls sideways with its table scrolled to the end`,
          ).toBeLessThanOrEqual(0);
        }
      }
    });
});

// Card rows (ruling R-C) hold every status of their tool in all four
// languages: no cell sticks out of its row and the table region does not
// scroll sideways at 375 and 320 (Task 10); a title, its sub-line and a
// path line stay one line (with an ellipsis) also with long names, while
// plain data cells wrap (Task 10 review I-1).
test("tool card rows stay inside their card in four languages", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const statuses = [
    "draft",
    "ready",
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "needs_review",
    "needs_attention",
  ];
  await withMuxJobs(page, () => [
    ...statuses.map((status, i) =>
      muxJob(i + 1, status, "Film " + i, `Film ${i} (2020).mkv`),
    ),
    muxJob(20, "ready", "Warned", "Warned (2020).mkv", {
      check: { exists: false },
    }),
    muxJob(
      21,
      "ready",
      "Blade Runner 2049",
      "Blade Runner 2049 (2017) Remux 2160p.mkv",
    ),
  ]);
  const GIB = 1024 ** 3;
  await withPlacement(page, {
    items: () => [
      ...[
        "split",
        "ok",
        "not_found",
        "seasons_spread",
        "empty_folders",
        "conflict",
        "no_space",
        "foreign_owner",
        "outside_share",
        "error",
      ].map((scanStatus, i) =>
        placementItem(
          i + 1,
          "Show " + i,
          { disk1: GIB, disk2: GIB },
          {
            scanStatus,
          },
        ),
      ),
      ...statuses.map((jobStatus, i) =>
        placementItem(
          20 + i,
          "Move " + i,
          { disk1: GIB, disk2: GIB },
          {
            jobStatus,
          },
        ),
      ),
      placementItem(41, "The Lord of the Rings: The Fellowship of the Ring", {
        disk1: GIB,
        disk2: GIB,
      }),
      placementItem(
        40,
        "Parity",
        { disk1: GIB, disk2: GIB },
        {
          jobStatus: "queued",
          message: "Waiting: parity operation in progress",
        },
      ),
    ],
  });
  await withFindings(page, {
    items: () =>
      [
        "",
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
        "needs_review",
      ]
        .map((jobStatus, i) =>
          finding(i + 1, jobStatus, "Film " + i, `movies/Film ${i}/a.nfo`),
        )
        .concat(
          finding(9, "", "Manual", "movies/Manual/b.nfo", { fix: "manual" }),
          finding(10, "", "Dark", "shows/Dark/Season 2/Dark S02E01 Secrets", {
            dir: true,
          }),
        ),
  });
  for (const language of LANGUAGES)
    await test.step(language, async () => {
      await inLanguage(page, language);
      for (const width of [375, 320]) {
        const size = { width, height: 812 };
        await page.setViewportSize(size);
        for (const view of tools) {
          await page.goto("about:blank");
          await openRoute(page, "#/tools/" + view);
          await expect(
            page.locator("table.v2-table--fixed > tbody > tr").first(),
          ).toBeVisible({ timeout: 15_000 });
          const where = `${view} in ${language} at ${label(size)}`;
          const out = await page.evaluate(() => {
            const region = document.querySelector(".v2-table-scroll")!;
            const cut: string[] = [];
            for (const row of region.querySelectorAll("tbody > tr")) {
              const right = row.getBoundingClientRect().right;
              const name = row.querySelector(".v2-table-name")?.textContent;
              for (const part of row.querySelectorAll("td > *, td > * > *"))
                if (part.getBoundingClientRect().right > right + 0.5)
                  cut.push(`${name}: ${part.textContent}`);
              // A cell's own text or bar wider than the cell, so it covers
              // the next one; a wide cell has the line to itself, so its
              // content only has to end inside the row (above).
              for (const cell of row.querySelectorAll("td:not(.v2-table-wide)"))
                if (cell.scrollWidth > cell.clientWidth + 0.5)
                  cut.push(
                    `${name}: ${cell.getAttribute("data-label")} ${cell.scrollWidth} in ${cell.clientWidth}`,
                  );
            }
            // Titles, sub-lines and path lines: one line each. A path line
            // (.v2-table-line, a flex row of the folder icon and the name)
            // has a fixed height, so it is one line when nothing in it
            // overflows that height and it is no taller than a title line
            // (Task 10 re-review).
            const title = parseFloat(
              getComputedStyle(document.documentElement).getPropertyValue(
                "--lh-row-title",
              ),
            );
            const lines = [
              ...region.querySelectorAll(
                "tbody :is(.v2-table-name, .v2-table-sub, .v2-table-line)",
              ),
            ];
            const wrapped = lines
              .filter((line) =>
                line.classList.contains("v2-table-line")
                  ? line.scrollHeight > line.clientHeight + 0.5 ||
                    line.getBoundingClientRect().height > title + 0.5
                  : line.getBoundingClientRect().height >
                    parseFloat(getComputedStyle(line).lineHeight) + 0.5,
              )
              .map((line) => line.textContent);
            const measured = title > 0;
            return {
              cut,
              wrapped,
              measured,
              paths: region.querySelectorAll("tbody .v2-table-line").length,
              scroll: region.scrollWidth,
              client: region.clientWidth,
            };
          });
          expect(out.cut, `${where}: parts outside their card row`).toEqual([]);
          expect(out.measured, `${where}: the line height is read`).toBe(true);
          if (view === "files")
            expect(out.paths, `${where}: path lines`).toBeGreaterThan(0);
          expect(out.wrapped, `${where}: title or path lines wrap`).toEqual([]);
          expect(
            out.scroll,
            `${where}: the region scrolls`,
          ).toBeLessThanOrEqual(out.client + 0.5);
        }
      }
    });
});

// Ruling I14 on a phone (Task 10): in card rows Start, Fix, Terminal and
// Mux options are hidden, so the Actions cell holds only Remove (Disk
// placement, Files & permissions: after a move or fix) or the removing
// action of a job. Polling moves a job from startable through waiting and
// running to successful, and its card row keeps its height and every cell
// its place: the Actions cell keeps a row button's height when it is
// empty, and the progress bar's line is as high as its dash.
test("tool card rows keep their height while a job runs", async ({ page }) => {
  const GIB = 1024 ** 3;
  const steps = ["", "queued", "running", "succeeded"];
  let step = 0;
  const progress = () => [0, 0, 64, 100][step];
  await withMuxJobs(page, () => [
    muxJob(1, steps[step] || "ready", "Arrival", "Arrival (2016).mkv", {
      progress: progress(),
    }),
  ]);
  await withPlacement(page, {
    items: () => [
      placementItem(
        1,
        "Breaking Bad",
        { disk1: 41 * GIB, disk3: 9 * GIB },
        { jobStatus: steps[step], progress: progress() },
      ),
    ],
  });
  await withFindings(page, {
    items: () => [
      finding(2, steps[step], "Her", "movies/Her (2013)/Her.2013.nfo", {
        progress: progress(),
      }),
    ],
  });
  await page.setViewportSize(phone);
  for (const view of tools) {
    await test.step(view, async () => {
      let first: { height: number; cells: number[][] } | undefined;
      for (step = 0; step < steps.length; step++) {
        await page.goto("about:blank");
        await openRoute(page, "#/tools/" + view);
        const row = page.locator("table.v2-table--fixed > tbody > tr").first();
        await expect(row).toBeVisible({ timeout: 15_000 });
        await expect(row).toHaveCSS("display", "grid");
        const now = await row.evaluate((tr) => {
          const box = tr.getBoundingClientRect();
          return {
            height: box.height,
            cells: [...tr.children].map((cell) => {
              const { x, y, height } = cell.getBoundingClientRect();
              return [x, y - box.top, height];
            }),
          };
        });
        if (!first) {
          first = now;
          continue;
        }
        const where = `${view}, ${steps[step]} vs idle`;
        expectSame(now.height, first.height, `${where}, card row height`);
        now.cells.forEach((cell, i) =>
          ["x", "y", "height"].forEach((edge, j) =>
            expectSame(
              cell[j],
              first!.cells[i][j],
              `${where}, cell ${i} ${edge}`,
            ),
          ),
        );
      }
    });
  }
});

// Concept §1 success criteria. The libraries meet them since Phase 5a
// (their parts of the two targets below are in library.spec.ts: "the
// filter drawer leaves the table in place" and "mobile result headings
// share one height"), the tool pages since Phase 5b (the two tests after
// this one).
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

// Replaces the tool part of the 1.7.0 "expanded filters cover at most 60%
// of the viewport" (Phase 5b, Task 10): the tools filter in a drawer, a
// modal layer, so opening and closing it (Escape, Close, Apply) moves
// nothing of the page, at its top and scrolled. It stands at the right
// edge, on phones over the whole screen.
test("the tool drawer leaves the table in place", async ({ page }) => {
  test.setTimeout(240_000);
  const parts: Record<string, Edge[]> = {
    ".v2-band": ALL,
    ".v2-page-head": ALL,
    ".v2-list-page > :first-child": ALL,
    ".v2-table-card": ALL,
    ".v2-tc-head": ALL,
    ".v2-table > thead": ALL,
    ".v2-table > tbody > tr:first-child": ALL,
    ".v2-tc-foot": ALL,
  };
  await recordBoxes(page, Object.keys(parts));
  // Enough rows to scroll 100 px (ruling I13).
  await withMuxJobs(page, () => muxJobs(25));
  await withPlacement(page, { items: () => placementItems(25) });
  await withFindings(page, { items: () => findings(25) });
  for (const size of [desktop, phone]) {
    await page.setViewportSize(size);
    for (const view of tools) {
      await test.step(`${view} at ${label(size)}`, async () => {
        await page.goto("about:blank");
        await openRoute(page, "#/tools/" + view);
        await expect(
          page.locator("table.v2-table--fixed > tbody > tr").first(),
        ).toBeVisible({ timeout: 15_000 });
        await settle(page);
        const filters = page
          .locator("main section.v2-table-card")
          .getByRole("button", { name: "Filters", exact: true });
        for (const scroll of [0, 100]) {
          await page.evaluate((y) => window.scrollTo(0, y), scroll);
          await expect
            .poll(() => page.evaluate(() => window.scrollY))
            .toBe(scroll);
          await recordedBoxes(page);
          const base = await boxesOf(page, Object.keys(parts));
          for (const close of ["Escape", "Close", "Apply"] as const) {
            const where = `${view}: ${close} at ${label(size)}, scrolled ${scroll}`;
            await filters.click();
            const drawer = filterDrawer(page);
            await expect(drawer).toBeVisible();
            await expect(
              drawer.getByRole("button", { name: /^Apply/ }),
            ).toHaveText(/\(\d+ match(es)?\)/);
            const box = (await drawer.boundingBox())!;
            if (size.width <= 739)
              expect(box, `${where}: the drawer fills the screen`).toEqual({
                x: 0,
                y: 0,
                width: size.width,
                height: size.height,
              });
            else {
              expect(
                size.width - (box.x + box.width),
                `${where}: the drawer stands at the right`,
              ).toBeLessThan(24);
              // The 1.7.0 bound kept (Task 10 review M-4): the filters
              // cover at most 60 % of the viewport's width.
              expect(
                box.width,
                `${where}: the drawer takes at most 60 %`,
              ).toBeLessThanOrEqual(0.6 * size.width);
            }
            if (close === "Escape") await page.keyboard.press("Escape");
            else if (close === "Close")
              await drawer
                .getByRole("button", { name: "Close", exact: true })
                .click();
            else await drawer.getByRole("button", { name: /^Apply/ }).click();
            await expect(drawer).toHaveCount(0);
            expect(
              await page.evaluate(() => window.scrollY),
              `${where}: the page scrolled`,
            ).toBe(scroll);
            await expectSteady(page, parts, where, base);
          }
        }
      });
    }
  }
});

// The tool part of "mobile result headings share one height" (Phase 5b,
// Task 10; the libraries' part is in library.spec.ts): on phones the card
// heads and chips rows of the three tools are as high and as wide (the
// chips row holds the tools on lines of their own below 560), with rows.
test("mobile result headings share one height", async ({ page }) => {
  await withMuxJobs(page);
  await withPlacement(page);
  await withFindings(page);
  for (const size of [phone, { width: 320, height: 812 }]) {
    await test.step(label(size), async () => {
      await page.setViewportSize(size);
      let first:
        { view: View; boxes: Record<string, DOMRect | null> } | undefined;
      for (const view of tools) {
        await page.goto("about:blank");
        await openRoute(page, "#/tools/" + view);
        await expect(
          page.locator("table.v2-table--fixed > tbody > tr").first(),
        ).toBeVisible({ timeout: 15_000 });
        await settle(page);
        const boxes = await boxesOf(page, [".v2-tc-head", ".v2-chips-row"]);
        if (!first) {
          first = { view, boxes };
          continue;
        }
        for (const query of Object.keys(boxes))
          for (const edge of ["x", "width", "height"] as const)
            expectSame(
              boxes[query]![edge],
              first.boxes[query]![edge],
              `${query} ${edge}, ${view} vs ${first.view} at ${label(size)}`,
            );
      }
    });
  }
});

// Tool table headers after a late web font (Phase 5a, E22): with the
// typeface 1.5s late, fontsReady in main.tsx renders after 1s with the
// fallback and the mux table (the open jobs of withOpenJobs) comes before
// the face; once it arrives the headers are measured again and get the
// widths they have with the face from the start, in four languages.
test("tool headers fit after the font arrives late", async ({ page }) => {
  test.setTimeout(240_000);
  await withOpenJobs(page);
  // Disk placement too (Task 7 review): its five fixture rows; Files &
  // permissions its four findings (Task 8).
  await withPlacement(page);
  await withFindings(page);
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
  const tables = [
    { hash: "#/tools/mux", rows: 4 },
    { hash: "#/tools/placement", rows: 5 },
    { hash: "#/tools/files", rows: 4 },
  ];
  const headers = async (rows: number) => {
    await expect(page.locator("table.v2-table--fixed tbody tr")).toHaveCount(
      rows,
    );
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
  for (const language of LANGUAGES)
    for (const { hash, rows } of tables)
      await test.step(`${language} ${hash}`, async () => {
        await inLanguage(page, language);
        await page.goto("about:blank");
        await openRoute(page, hash);
        const ready = await headers(rows);
        expect(ready.before, "the face is there before the table").toBe(false);

        await page.route(late, async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await route.continue();
        });
        await page.goto("about:blank");
        await openRoute(page, hash);
        const after = await headers(rows);
        await page.unroute(late);
        expect(after.before, "the table comes before the face").toBe(true);
        expect(after.cells.map((cell) => cell.name)).toEqual(
          ready.cells.map((cell) => cell.name),
        );
        after.cells.forEach((cell, i) => {
          expectSame(
            cell.width,
            ready.cells[i].width,
            `${language} ${hash}: the ${cell.name} header after the late face`,
          );
          expect(cell.clipped, `${language} ${hash}: ${cell.name} is cut`).toBe(
            false,
          );
        });
      });
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

// Ruling I14 (Phase 5b, Task 7): polling moves an item from startable to
// waiting (for the mover) to moving to moved, and nothing of its row
// moves: every column keeps its place and width, Details, Terminal and
// Start keep theirs (Start always there, locked while the item cannot
// start), and Remove only joins after Start once the item has moved. The
// row is measured from its own top. With all twelve columns the table
// may be wider than its card at 1440 (ruling A): it then scrolls inside
// the card as a named region, its header not sticky, and the page itself
// never scrolls sideways.
test("placement rows keep their columns and buttons while a move runs", async ({
  page,
}) => {
  const GIB = 1024 ** 3;
  const steps = [
    { jobStatus: "", progress: 0, message: "", shown: "Split" },
    {
      jobStatus: "queued",
      progress: 0,
      message: "Waiting: mover is running",
      shown: "Waiting: mover is running",
    },
    { jobStatus: "running", progress: 64, message: "", shown: "Moving" },
    { jobStatus: "succeeded", progress: 100, message: "", shown: "Moved" },
  ];
  let step = 0;
  await withPlacement(page, {
    items: () => [
      placementItem(
        1,
        "Breaking Bad",
        { disk1: 41 * GIB, disk3: 9 * GIB },
        {
          jobStatus: steps[step].jobStatus,
          progress: steps[step].progress,
          message: steps[step].message,
        },
      ),
      placementItem(5, "The Bear", { disk2: 30 * GIB, cache: 3 * GIB }),
    ],
  });
  await start(page, desktop);
  await openRoute(page, "#/tools/placement");
  const row = page
    .locator("table.v2-table--fixed tbody tr")
    .filter({ hasText: "Breaking Bad" });
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
  // Info: Details and Terminal; Actions: Start.
  expect(first.buttons).toHaveLength(3);
  for (const index of [1, 2, 3]) {
    step = index;
    const now = await shape(steps[index].shown);
    const where = `${steps[index].jobStatus} vs startable`;
    expect(now.buttons, where).toHaveLength(index === 3 ? 4 : 3);
    for (const part of ["cells", "buttons", "heads"] as const)
      first[part].forEach((base, i) => {
        const box = now[part][i] as Record<string, number>;
        for (const [edge, value] of Object.entries(base))
          expectSame(box[edge], value, `${where}, ${part} ${i} ${edge}`);
      });
    if (index === 3)
      expect(now.buttons[3].x, "Remove follows Start").toBeGreaterThan(
        now.buttons[2].x + now.buttons[2].width,
      );
  }
  await expect(
    row.getByRole("button", { name: "Start item Breaking Bad", exact: true }),
  ).toBeDisabled();
  await expect(
    row.getByRole("button", {
      name: "Remove Breaking Bad from the list",
      exact: true,
    }),
  ).toBeEnabled();
  // Ruling A: at 1440 beside the rail the twelve default columns are wider
  // than the card (a precondition, so the checks below always run): the
  // table scrolls in its named region without a sticky header, and the
  // page does not scroll sideways.
  expect(
    await pageOverflowX(page),
    "the page scrolls sideways",
  ).toBeLessThanOrEqual(0);
  const scroll = page.locator(".v2-table-scroll");
  const widths = await scroll.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
  }));
  expect(
    widths.scroll,
    `the table (${widths.scroll}px) is wider than its card (${widths.client}px) at 1440 beside the rail`,
  ).toBeGreaterThan(widths.client + 0.5);
  await expect(page.locator(".v2-shell")).toHaveAttribute("data-mode", "rail");
  await expect(scroll).toHaveAttribute("role", "region");
  await expect(scroll).toHaveAttribute("aria-label", "Items");
  await expect(scroll).toHaveAttribute("tabindex", "0");
  expect(
    await page
      .locator("table.v2-table--fixed thead th")
      .first()
      .evaluate((th) => getComputedStyle(th).position),
    "the header of an overflowing table does not stick",
  ).not.toBe("sticky");
});

// Ruling I14 (Phase 5b, Task 8): polling moves a finding from open to
// waiting to fixing to fixed, and nothing of its row moves: every column
// keeps its place and width, Details, Terminal and Fix keep theirs (Fix
// always there, locked while the finding cannot be fixed), and Remove only
// joins after Fix once the finding is fixed. The row is measured from its
// own top. Files & permissions fits its card at 1440 beside the rail in
// every language (tool-status.test.mjs), so its table region is no named
// region there; at 820 it is wider than the card (a precondition, so the
// region checks always run) and scrolls inside it as a named region, its
// header not sticky, the page never sideways.
test("finding rows keep their columns and buttons while a fix runs", async ({
  page,
}) => {
  const steps = [
    { jobStatus: "", progress: 0, shown: "Open" },
    { jobStatus: "queued", progress: 0, shown: "Queued" },
    { jobStatus: "running", progress: 64, shown: "Fixing" },
    { jobStatus: "succeeded", progress: 100, shown: "Fixed" },
  ];
  let step = 0;
  await withFindings(page, {
    items: () => [
      finding(
        2,
        steps[step].jobStatus,
        "Her",
        "movies/Her (2013)/Her.2013.nfo",
        { mode: 0o600, size: 2048, progress: steps[step].progress },
      ),
      finding(1, "", "Tenet", "movies/Tenet (2020)", {
        dir: true,
        kind: "owner",
        fix: "take_ownership",
      }),
    ],
  });
  await start(page, desktop);
  await openRoute(page, "#/tools/files");
  const row = page
    .locator("table.v2-table--fixed tbody tr")
    .filter({ hasText: "Her.2013.nfo" });
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
  // An idle page polls every 10s, a fixing one every second.
  const shape = async (shown: string) => {
    await expect(
      row.getByRole("button", { name: `Status: ${shown}. Show details` }),
    ).toBeVisible({ timeout: 15_000 });
    return measure();
  };
  const first = await shape(steps[0].shown);
  // Info: Details and Terminal; Actions: Fix.
  expect(first.buttons).toHaveLength(3);
  for (const index of [1, 2, 3]) {
    step = index;
    const now = await shape(steps[index].shown);
    const where = `${steps[index].jobStatus} vs open`;
    expect(now.buttons, where).toHaveLength(index === 3 ? 4 : 3);
    for (const part of ["cells", "buttons", "heads"] as const)
      first[part].forEach((base, i) => {
        const box = now[part][i] as Record<string, number>;
        for (const [edge, value] of Object.entries(base))
          expectSame(box[edge], value, `${where}, ${part} ${i} ${edge}`);
      });
    if (index === 3)
      expect(now.buttons[3].x, "Remove follows Fix").toBeGreaterThan(
        now.buttons[2].x + now.buttons[2].width,
      );
  }
  const path = "movies/Her (2013)/Her.2013.nfo";
  await expect(
    row.getByRole("button", { name: `Fix ${path}`, exact: true }),
  ).toBeDisabled();
  await expect(
    row.getByRole("button", {
      name: `Remove ${path} from the list`,
      exact: true,
    }),
  ).toBeEnabled();
  // At 1440 beside the rail the table fits its card: no sideways scroll
  // and no named region.
  await expect(page.locator(".v2-shell")).toHaveAttribute("data-mode", "rail");
  const scroll = page.locator(".v2-table-scroll");
  const widths = () =>
    scroll.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
  let measured = await widths();
  expect(
    measured.scroll,
    `the table (${measured.scroll}px) fits its card (${measured.client}px) at 1440`,
  ).toBeLessThanOrEqual(measured.client + 0.5);
  await expect(scroll).not.toHaveAttribute("role", "region");
  // At 820 it is wider than the card: a named region without a sticky
  // header, and the page does not scroll sideways.
  await page.setViewportSize(tablet);
  await expect(page.locator(".v2-shell")).toHaveAttribute("data-mode", "rail");
  await expect
    .poll(async () => {
      const { scroll, client } = await widths();
      return scroll - client;
    }, "the table is wider than its card at 820")
    .toBeGreaterThan(0.5);
  measured = await widths();
  expect(measured.scroll).toBeGreaterThan(measured.client + 0.5);
  await expect(scroll).toHaveAttribute("role", "region");
  await expect(scroll).toHaveAttribute("aria-label", "Findings");
  await expect(scroll).toHaveAttribute("tabindex", "0");
  expect(
    await page
      .locator("table.v2-table--fixed thead th")
      .first()
      .evaluate((th) => getComputedStyle(th).position),
    "the header of an overflowing table does not stick",
  ).not.toBe("sticky");
  expect(
    await pageOverflowX(page),
    "the page scrolls sideways",
  ).toBeLessThanOrEqual(0);
});

// Settings → Widgets and Custom tags (Phase 5c, task 7, fix round 1): the
// storage answer moves no chosen path (the error notice comes after the
// paths, the size has its own line, the service cards share a two-column
// grid from 1120, so on phones only a card's own rows are fixed), and
// typing a custom tag's display name moves no column.
test("widgets storage rows and custom tag columns stay in place", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // The storage read of the Widgets page is held until release().
  let hold = false;
  const waiting: (() => void)[] = [];
  const release = () => {
    hold = false;
    waiting.splice(0).forEach((resolve) => resolve());
  };
  await page.route(/\/api\/settings$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const settings = await response.json();
    const radarr = settings.instances.find(
      (instance: { id: string }) => instance.id === "radarr",
    );
    settings.instances = [
      { ...radarr, enabled: true, name: "Radarr HD" },
      { ...radarr, id: "radarr-4k", enabled: true, name: "Radarr 4K" },
      ...settings.instances.filter(
        (instance: { type: string }) => instance.type !== "radarr",
      ),
    ];
    settings.widgets.storage = {
      radarr: [
        { path: "/mnt/user/media/movies", sharedGroup: "", name: "Movies" },
        { path: "/mnt/user/archive", sharedGroup: "", name: "Archive" },
      ],
      "radarr-4k": [{ path: "/mnt/disk4", sharedGroup: "", name: "Four" }],
    };
    await route.fulfill({ response, json: settings });
  });
  await page.route(/\/api\/storage$/, async (route) => {
    if (hold) await new Promise<void>((resolve) => waiting.push(resolve));
    const disk = (path: string) => ({
      path,
      label: path,
      totalSpace: 4.2e13,
      freeSpace: 1.25e13,
    });
    await route.fulfill({
      json: {
        services: {
          radarr: {
            disks: [disk("/mnt/cache"), disk("/mnt/user/media/movies")],
            error: "",
          },
          "radarr-4k": { disks: [], error: "Radarr 4K did not answer in time" },
        },
        areas: {},
      },
    });
  });
  await page.route(/\/api\/custom-tags$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      json: [
        { id: 1, name: "Favorites", count: 7, manual: true },
        { id: 2, name: "Kids", count: 0, manual: true },
        { id: 3, name: "Without German audio", count: 2, sources: ["radarr"] },
      ],
    });
  });
  const rows = (card: string) =>
    page.evaluate((title) => {
      const heading = [...document.querySelectorAll("h3")].find(
        (h) => h.textContent === title,
      )!;
      const box = heading.closest("section")!;
      const top = box.getBoundingClientRect().top;
      return [...box.querySelectorAll(".v2-set-paths > li")].map((li) => {
        const r = li.getBoundingClientRect();
        return { y: r.top, inCard: r.top - top, h: r.height };
      });
    }, card);
  for (const size of [desktop, phone]) {
    await test.step(label(size), async () => {
      await start(page, size);
      await goTo(page, "settings");
      hold = true;
      await (await sectionLink(page, "Widgets")).click();
      await expect(
        page.getByRole("heading", { level: 3, name: "Radarr 4K" }),
      ).toBeVisible();
      const before = {
        hd: await rows("Radarr HD"),
        fourK: await rows("Radarr 4K"),
      };
      expect(before.hd.length, "chosen paths before the answer").toBe(2);
      release();
      await expect(
        page.getByText("Radarr 4K did not answer in time"),
      ).toBeVisible();
      await settle(page);
      const after = {
        hd: await rows("Radarr HD"),
        fourK: await rows("Radarr 4K"),
      };
      expect(after.hd.length, "the reported path follows").toBe(3);
      const where = `storage at ${label(size)}`;
      before.hd.forEach((row, at) => {
        expectSame(after.hd[at].y, row.y, `${where}, Radarr HD row ${at} y`);
        expectSame(after.hd[at].h, row.h, `${where}, Radarr HD row ${at} h`);
      });
      // A card's own rows stay; side by side from 1120, the second card
      // stays as well.
      expectSame(
        after.fourK[0].inCard,
        before.fourK[0].inCard,
        `${where}, Radarr 4K row in its card`,
      );
      if (size.width > 1119)
        expectSame(
          after.fourK[0].y,
          before.fourK[0].y,
          `${where}, Radarr 4K row`,
        );
    });
  }
  await start(page, desktop);
  await goTo(page, "settings");
  await settingsSection(page, "Custom tags");
  const count = () =>
    page
      .locator('.v2-table td[data-label="Count"]')
      .first()
      .evaluate((td) => td.getBoundingClientRect().left);
  const x = await count();
  await page
    .getByRole("textbox", { name: "Tag name: Without German audio" })
    .fill("Without German audio 0123456789");
  await settle(page);
  expectSame(await count(), x, "custom tags, Count column x after typing");
});
