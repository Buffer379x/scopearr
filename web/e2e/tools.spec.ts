// The tool pages (Phase 5b, Task 10; docs/STYLEGUIDE.md, Part 1, 10.2,
// 10.5, 10.10, 11.1 and 13): Muxing, Disk placement and Files &
// permissions with the rows of the tool fixtures (the demo has none).
// Their geometry from the first paint on and while jobs run, the sticky
// header, card rows, the columns in four languages, and the drawer, KPI
// cards, disk cards, rows and overlays as a user drives them. Measured
// after network idle and loaded fonts; tolerance 0.5 px. Every action that
// would change the shared demo database is answered here.
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ALL,
  boxesOf,
  currentHash,
  diskRow,
  expectSame,
  expectSteady,
  filterDrawer,
  firstPaintChanges,
  goTo,
  historyLength,
  inLanguage,
  LANGUAGES,
  openRoute,
  pageOverflowX,
  PLACE,
  preferSidebar,
  quickSearch,
  recordBoxes,
  recordedBoxes,
  recordFirstPaint,
  rect,
  settle,
  sizeLabel as label,
  sizeOf,
  toolCard,
  toolKpis,
  touchPage,
  withListPrefs,
  withStatus,
  type Edge,
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

type Size = { width: number; height: number };
type Tool = "mux" | "placement" | "files";

const desktop = sizeOf(1440),
  phone = sizeOf(375);
const GIB = 1024 ** 3;
// The card ids (TableCard: #<id>-title), hashes and fixture rows of the
// three tools.
const TOOLS: { tool: Tool; hash: string; id: string; rows: number }[] = [
  { tool: "mux", hash: "#/tools/mux", id: "mux", rows: 6 },
  { tool: "placement", hash: "#/tools/placement", id: "placement", rows: 5 },
  { tool: "files", hash: "#/tools/files", id: "filecheck", rows: 4 },
];

// Every tool with its fixture rows.
async function withTools(page: Page, delay = 0) {
  await withMuxJobs(page, () => muxJobs(), { delay });
  await withPlacement(page, { standby: true, delay });
  await withFindings(page, { delay });
}

const rowsOf = (page: Page) =>
  page.locator("table.v2-table--fixed > tbody > tr");

// The rows are in and the fonts loaded.
async function loaded(page: Page) {
  await expect(rowsOf(page).first()).toBeVisible({ timeout: 15_000 });
  await settle(page);
}

// A fresh load (not a hash change of the same document) at `size`.
async function start(page: Page, size: Size, hash: string) {
  await page.setViewportSize(size);
  await page.goto("about:blank");
  await openRoute(page, hash);
  await loaded(page);
}

const filtersButton = (page: Page) =>
  toolCard(page).getByRole("button", { name: "Filters", exact: true });
const chips = (page: Page) =>
  page.getByRole("group", { name: "Filters", exact: true }).locator(".v2-chip");
const applyButton = (drawer: Locator) =>
  drawer.getByRole("button", { name: /^Apply/ });
const statusButton = (row: Locator, name: string) =>
  row.getByRole("button", { name, exact: true });
const rowWith = (page: Page, text: string) =>
  rowsOf(page).filter({ hasText: text });

async function openDrawer(page: Page) {
  await filtersButton(page).click();
  const drawer = filterDrawer(page);
  await expect(drawer).toBeVisible();
  return drawer;
}

// The tools of the chips row by place, so a tool that moves inside a
// steady group is caught too (the live region of a mux run is no tool).
const TOOL_PARTS = Array.from(
  { length: 12 },
  (_, i) => `.v2-tc-tools > :nth-child(${i + 1} of :not([aria-live]))`,
);

// --- Geometry and jumps -------------------------------------------------

// E4, E5, E6: no sheet; the KPI row (Muxing, Files & permissions) or the
// disk row (Disk placement) is the page's first block at 146 (≤ 739:
// 172), right below the page header, over the band; from 1440 the first
// table row is at one height on all three pages (401, Design §9), below
// it each page has its own (the KPI rows wrap into 2 × 2, the disk row
// stays one line, a known limit). No width scrolls sideways.
test("tool cards start on the band and their first rows line up", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await withTools(page);
  for (const width of [1600, 1440, 1119, 820, 740, 375, 320]) {
    const size = sizeOf(width);
    await test.step(label(size), async () => {
      const top = width <= 739 ? 172 : 146;
      const firstRows: Record<string, number> = {};
      for (const { tool, hash } of TOOLS) {
        await start(page, size, hash);
        const where = `${tool} at ${label(size)}`;
        await expect(page.locator("main.v2-main")).not.toHaveAttribute(
          "data-sheet",
        );
        const first = await page
          .locator(".v2-list-page > :first-child")
          .evaluate((element) => ({
            name: element.className,
            top: element.getBoundingClientRect().top,
          }));
        expect(first.name, `${where}: the first block`).toContain(
          tool === "placement" ? "v2-disks" : "v2-dash-kpis",
        );
        expectSame(first.top, top, `${where}, first block top`);
        expectSame(
          (await rect(page, ".v2-page-head")).bottom,
          top,
          `${where}, page header bottom`,
        );
        expect(first.top, `${where}: the row overlaps the band`).toBeLessThan(
          (await rect(page, ".v2-band")).bottom,
        );
        expect(
          await pageOverflowX(page),
          `${where} scrolls sideways`,
        ).toBeLessThanOrEqual(0);
        firstRows[tool] = (await rect(page, ".v2-table > tbody > tr")).top;
      }
      if (width >= 1440)
        for (const tool of ["placement", "files"])
          expectSame(
            firstRows[tool],
            firstRows.mux,
            `${tool} vs mux at ${label(size)}, first table row top`,
          );
      test.info().annotations.push({
        type: "first table row",
        description: `${label(size)}: ${JSON.stringify(firstRows)}`,
      });
    });
  }
});

// What stays from the first paint on, with every tool answer 300 ms late:
// the frame (recordFirstPaint), the band, the page header and its
// actions, the KPI or disk row, the card, its head, title, filter bar,
// chips row and tools, the table header and the first row's place. The
// card body is the pending empty state until the first answer (ruling
// M22, a known limit: the card's foot moves down when the rows arrive;
// nothing above them moves). Each tool's card parts are found through its
// own card, so the frames of the page before a switch do not count.
const card = (id: string) => `.v2-table-card:has(#${id}-title)`;
const firstBlock = (tool: Tool) =>
  `.v2-list-page > ${tool === "placement" ? ".v2-disks" : ".v2-dash-kpis"}`;
function paintParts(tool: Tool, id: string): Record<string, Edge[]> {
  const c = card(id);
  return {
    ".v2-band": ALL,
    ".v2-page-head": ALL,
    // The title's width follows the page's own header actions.
    "main h1": ["x", "y", "height"],
    [firstBlock(tool)]: ALL,
    [c]: PLACE,
    [`${c} .v2-tc-head`]: ALL,
    [`${c} .v2-tc-title`]: ALL,
    [`${c} .v2-filter-bar`]: ALL,
    [`${c} .v2-chips-row`]: ALL,
    [`${c} .v2-tc-tools`]: ALL,
    [`${c} .v2-table > thead`]: ALL,
    [`${c} .v2-table > tbody > tr:first-child`]: PLACE,
  };
}

test("tool pages do not move after their first paint", async ({ page }) => {
  test.setTimeout(300_000);
  await recordFirstPaint(page);
  await recordBoxes(page, [
    ...new Set(
      TOOLS.flatMap(({ tool, id }) => Object.keys(paintParts(tool, id))),
    ),
  ]);
  await withTools(page, 300);
  for (const width of [1600, 1440, 1119, 820, 740, 375, 320]) {
    const size = sizeOf(width);
    await test.step(label(size), async () => {
      await start(page, size, "#/tools/mux");
      const frame = await firstPaintChanges(page);
      expect(frame.first, `the frame at ${label(size)}`).toEqual([]);
      expect(frame.frames, `the frame at ${label(size)}`).toEqual([]);
      let from = "load";
      for (const { tool, id } of TOOLS) {
        if (tool !== "mux") {
          await goTo(page, tool);
          await loaded(page);
        }
        await expectSteady(
          page,
          paintParts(tool, id),
          `${tool} (${from}) at ${label(size)}`,
        );
        from = `from ${tool}`;
      }
    });
  }
});

// Task 10 review M-7: the same first paint beside a stored expanded
// sidebar at 899, 820 and 740 (the widths where it stands beside the
// page), and on a loaded page a density switch (comfortable ↔ compact,
// as Settings → Display writes it) moves nothing above the rows: the
// rows only change their height.
test("tool pages do not move beside an expanded sidebar or with a density switch", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await recordFirstPaint(page);
  await recordBoxes(page, [
    ...new Set(
      TOOLS.flatMap(({ tool, id }) => Object.keys(paintParts(tool, id))),
    ),
  ]);
  await withTools(page, 300);
  await preferSidebar(page, "expanded");
  for (const width of [899, 820, 740]) {
    const size = sizeOf(width);
    await test.step(`expanded at ${label(size)}`, async () => {
      await start(page, size, "#/tools/mux");
      await expect(page.locator(".v2-shell")).toHaveAttribute(
        "data-mode",
        "expanded",
      );
      const frame = await firstPaintChanges(page);
      expect(frame.first, `the frame at ${label(size)}`).toEqual([]);
      expect(frame.frames, `the frame at ${label(size)}`).toEqual([]);
      let from = "load";
      for (const { tool, id } of TOOLS) {
        if (tool !== "mux") {
          await goTo(page, tool);
          await loaded(page);
        }
        await expectSteady(
          page,
          paintParts(tool, id),
          `${tool} (${from}) beside the expanded sidebar at ${label(size)}`,
        );
        expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
        from = `from ${tool}`;
      }
    });
  }
  const density = (value: "comfortable" | "compact") =>
    page.evaluate((next) => {
      localStorage.setItem("scopearr-density", next);
      window.dispatchEvent(new Event("scopearr-list-prefs"));
    }, value);
  for (const size of [desktop, phone])
    for (const { tool, hash, id } of TOOLS)
      await test.step(`${tool}: density at ${label(size)}`, async () => {
        await start(page, size, hash);
        const parts = paintParts(tool, id);
        await recordedBoxes(page);
        const base = await boxesOf(page, Object.keys(parts));
        const row = `${card(id)} .v2-table > tbody > tr:first-child`;
        const before = (await rect(page, row)).height;
        for (const [value, rows] of [
          ["compact", size === phone ? undefined : 40],
          ["comfortable", size === phone ? undefined : 48],
        ] as const) {
          await density(value);
          await expect(page.locator(card(id))).toHaveAttribute(
            "data-density",
            value,
          );
          await settle(page);
          await expectSteady(
            page,
            parts,
            `${tool}: ${value} on a loaded page at ${label(size)}`,
            base,
          );
          if (rows !== undefined)
            expectSame((await rect(page, row)).height, rows, `${tool} rows`);
        }
        expectSame((await rect(page, row)).height, before, `${tool} back`);
      });
});

// Head parts that no count, activity, scan or KPI change may move: the
// page actions (Scan report with its dot, Scan ↔ Cancel scan), the first
// block, the card title, its hint line (the activity), the Filters
// button, the chips row and each of its tools, the table header and the
// first row (the I14 vertical check: nothing above the rows moves while
// the hint line or Cancel toggles).
const HEAD: Record<string, Edge[]> = {
  ".v2-page-actions": ALL,
  ".v2-page-actions > :nth-child(1)": ALL,
  ".v2-list-page > :first-child": ALL,
  ".v2-tc-title": ALL,
  // The hint line starts at one place; on wide cards it hangs below the
  // title (absolutely placed, its box as high as its text), from 760 down
  // it keeps its line reserved.
  ".v2-tc-hint": ["x", "y"],
  ".v2-filter-bar > .v2-btn": ALL,
  ".v2-chips-row": ALL,
  ".v2-tc-tools": ALL,
  ".v2-table > thead": ALL,
  ...Object.fromEntries(TOOL_PARTS.map((query) => [query, ALL])),
};
const WITH_ROW: Record<string, Edge[]> = {
  ...HEAD,
  ".v2-table > tbody > tr:first-child": ALL,
};
// The parts of HEAD a tool page has (Muxing has one page action). Every
// part but the chips row's numbered tools (TOOL_PARTS, as many as the
// tool has) is always there and asserted first, so a renamed core part
// fails instead of dropping out (Task 10 review M-2).
async function present(page: Page, parts: Record<string, Edge[]>) {
  const boxes = await boxesOf(page, Object.keys(parts));
  const always = Object.keys(parts).filter(
    (query) => !TOOL_PARTS.includes(query),
  );
  expect(
    always.filter((query) => !boxes[query]),
    "the tool card's parts",
  ).toEqual([]);
  expect(
    TOOL_PARTS.filter((query) => query in parts && boxes[query]).length,
    "the chips row's tools",
  ).toBeGreaterThan(1);
  return Object.fromEntries(
    Object.entries(parts).filter(([query]) => boxes[query]),
  );
}

// Selects the first `n` selectable rows by their boxes, without scrolling.
async function selectRows(page: Page, n: number) {
  const boxes = page.locator(
    "table.v2-table--fixed > tbody .v2-table-sel input:not(:disabled)",
  );
  for (let i = 0; i < n; i++)
    await boxes.nth(i).evaluate((box: HTMLInputElement) => box.click());
}

test("counts, activity and the scan label never move the tool card", async ({
  page,
}) => {
  test.setTimeout(300_000);
  // Disk placement and Files & permissions: busy (a scan runs, a job
  // waits, the report has a notice) or idle, switched between polls.
  let busy = false;
  await withMuxJobs(page, () => muxJobs(25));
  await withPlacement(page, {
    scanning: () => busy,
    notices: () => busy,
    items: () =>
      placementItems(30).map((item) =>
        item.id === 3 ? { ...item, jobStatus: busy ? "queued" : "" } : item,
      ),
  });
  await withFindings(page, {
    scanning: () => busy,
    items: () =>
      findings(30).map((item) =>
        item.id === 2 ? { ...item, jobStatus: busy ? "queued" : "" } : item,
      ),
  });
  await recordBoxes(page, Object.keys(WITH_ROW));
  const main = page.getByRole("main");
  const button = (name: string) =>
    main.getByRole("button", { name, exact: true });
  for (const size of [desktop, phone]) {
    await test.step(`Muxing at ${label(size)}`, async () => {
      busy = false;
      await start(page, size, "#/tools/mux");
      const parts = await present(page, WITH_ROW);
      await recordedBoxes(page);
      const base = await boxesOf(page, Object.keys(parts));
      const where = (what: string) => `Muxing, ${what} at ${label(size)}`;
      await selectRows(page, 12);
      await expect(
        page.locator(
          "table.v2-table--fixed > tbody .v2-table-sel input:checked",
        ),
      ).toHaveCount(12);
      // Start selected counts the startable jobs of the selection.
      await expect(
        main.getByRole("button", { name: /^Start selected [1-9]\d*$/ }),
      ).toBeVisible();
      await expectSteady(page, parts, where("selection 0 → 12"), base);
      // A KPI press filters the list: the rows change, nothing above.
      const head = await present(page, HEAD);
      const failed = toolKpis(page).getByRole("button", { name: /^Failed / });
      await failed.click();
      await expect(failed).toHaveAttribute("aria-pressed", "true");
      await expect(rowsOf(page)).toHaveCount(1);
      await expectSteady(page, head, where("Failed pressed"), base);
      await failed.click();
      await expect(failed).toHaveAttribute("aria-pressed", "false");
      await expect(rowsOf(page)).toHaveCount(25);
      await expectSteady(page, head, where("Failed released"), base);
    });
    for (const tool of ["placement", "files"] as const) {
      await test.step(`${tool} at ${label(size)}`, async () => {
        busy = false;
        await start(page, size, "#/tools/" + tool);
        const parts = await present(page, WITH_ROW);
        await recordedBoxes(page);
        const base = await boxesOf(page, Object.keys(parts));
        const where = (what: string) => `${tool}, ${what} at ${label(size)}`;
        const cancel = button("Cancel");
        const hint = toolCard(page).locator(".v2-tc-hint");
        await expect(button("Scan")).toBeVisible();
        await expect(cancel).toBeDisabled();
        await expect(hint).toHaveText("");
        await selectRows(page, 12);
        await expect(
          page.locator(
            "table.v2-table--fixed > tbody .v2-table-sel input:checked",
          ),
        ).toHaveCount(12);
        // Fix selected counts the fixable findings (no manual one).
        await expect(
          button(
            tool === "placement" ? "Start selected 12" : "Fix selected 11",
          ),
        ).toBeVisible();
        await expectSteady(page, parts, where("selection 0 → 12"), base);
        // Busy from the next poll on (idle pages poll every 10 s).
        busy = true;
        await expect(button("Cancel scan")).toBeVisible({ timeout: 15_000 });
        await expect(cancel).toBeEnabled();
        await expect(hint).not.toHaveText("");
        if (tool === "placement")
          await expect(button("Scan report · contains notices")).toBeVisible();
        await expectSteady(
          page,
          parts,
          where("scan, activity, Cancel and the report dot on"),
          base,
        );
        busy = false;
        await expect(button("Scan")).toBeVisible({ timeout: 15_000 });
        await expect(cancel).toBeDisabled();
        await expect(hint).toHaveText("");
        if (tool === "placement")
          await expect(button("Scan report")).toBeVisible();
        await expectSteady(page, parts, where("all of them off"), base);
        // The finished scan opens its report (1.7.0, E20).
        const report = page.locator("dialog.modal[open]");
        await expect(report).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(report).toHaveCount(0);
        if (tool === "files") {
          const head = await present(page, HEAD);
          const open = toolKpis(page).getByRole("button", { name: /^Open / });
          await open.click();
          await expect(open).toHaveAttribute("aria-pressed", "true");
          await expectSteady(page, head, where("Open pressed"), base);
          await open.click();
          await expect(open).toHaveAttribute("aria-pressed", "false");
          await expectSteady(page, head, where("Open released"), base);
        }
      });
    }
  }
});

// Ruling I14 and E11: a job's status runs from waiting (Disk placement:
// waiting for the mover) to running at 64 % to successful, and no column
// header moves or changes its width; rows are 48 (comfortable), 40
// (compact) and 56 on a touch screen (V6).
const SEQUENCE = ["queued", "running", "succeeded"] as const;
const SHOWN: Record<Tool, string[]> = {
  mux: ["Waiting", "Running", "Successful"],
  placement: ["Waiting: mover is running", "Moving", "Moved"],
  files: ["Queued", "Fixing", "Fixed"],
};
async function withSequence(page: Page, step: () => number) {
  const status = () => SEQUENCE[step()];
  const progress = () => [0, 64, 100][step()];
  await withMuxJobs(page, () => [
    muxJob(1, status(), "Arrival", "Arrival (2016).mkv", {
      progress: progress(),
    }),
    ...muxJobs().slice(1),
  ]);
  await withPlacement(page, {
    items: () => [
      placementItem(
        1,
        "Breaking Bad",
        { disk1: 41 * GIB, disk3: 9 * GIB },
        {
          jobStatus: status(),
          progress: progress(),
          message: step() === 0 ? "Waiting: mover is running" : "",
        },
      ),
      ...placementItems().slice(1),
    ],
  });
  await withFindings(page, {
    items: () => [
      finding(2, status(), "Her", "movies/Her (2013)/Her.2013.nfo", {
        mode: 0o600,
        size: 2048,
        progress: progress(),
      }),
      ...findings().filter((item) => item.id !== 2),
    ],
  });
}

test("running jobs keep every column in place", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const heads = (target: Page) =>
    target.evaluate(() =>
      [...document.querySelectorAll("table.v2-table--fixed > thead th")].map(
        (th) => {
          const { x, width } = th.getBoundingClientRect();
          return { x, width };
        },
      ),
    );
  const heights = (target: Page) =>
    target.evaluate(() => [
      ...new Set(
        [
          ...document.querySelectorAll("table.v2-table--fixed > tbody > tr"),
        ].map((tr) => tr.getBoundingClientRect().height),
      ),
    ]);
  const run = async (target: Page, height: number, where: string) => {
    let step = 0;
    await withSequence(target, () => step);
    for (const { tool, hash } of TOOLS) {
      const row = rowsOf(target).filter({
        hasText: {
          mux: "Arrival (2016)",
          placement: "Breaking Bad",
          files: "Her.2013.nfo",
        }[tool],
      });
      const open = tool === "files" ? "Show details" : "Show checks";
      let first: { x: number; width: number }[] = [];
      for (step = 0; step < SEQUENCE.length; step++) {
        if (step === 0) {
          await target.goto("about:blank");
          await openRoute(target, hash);
        }
        await expect(
          statusButton(row, `Status: ${SHOWN[tool][step]}. ${open}`),
        ).toBeVisible({ timeout: 15_000 });
        if (step === 0) await settle(target);
        const now = await heads(target);
        expect(await heights(target), `${tool} rows, ${where}`).toEqual([
          height,
        ]);
        if (step === 0) {
          first = now;
          continue;
        }
        expect(now.length).toBe(first.length);
        now.forEach((box, i) => {
          expectSame(
            box.x,
            first[i].x,
            `${tool} ${SEQUENCE[step]}, th ${i} x, ${where}`,
          );
          expectSame(
            box.width,
            first[i].width,
            `${tool} ${SEQUENCE[step]}, th ${i} width, ${where}`,
          );
        });
      }
    }
  };
  await test.step("comfortable", async () => {
    await page.setViewportSize(desktop);
    await run(page, 48, "comfortable");
  });
  await test.step("compact", async () => {
    await withListPrefs(page, { density: "compact" });
    await run(page, 40, "compact");
  });
  await test.step("touch", async () => {
    const touch = await touchPage(browser, { width: 1024, height: 768 });
    expect(
      await touch.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    await run(touch, 56, "touch");
    await touch.context().close();
  });
});

// V7 and ruling A: at 1440 beside the rail Muxing and Files & permissions
// fit their cards with 30 rows (ruling I13: at least 25), so the header
// sticks right under the topbar (60) after a 600 px scroll and covers the
// rows. Disk placement's twelve default columns are wider than the card
// (asserted first, so no check below passes without it): its table
// scrolls inside the card as the focusable region "Items", the keyboard
// scrolls it, its header scrolls away with the page, and the page itself
// never scrolls sideways.
test("the tool header sticks under the topbar", async ({ page }) => {
  await withMuxJobs(page, () => muxJobs(30));
  await withPlacement(page, { items: () => placementItems(30) });
  await withFindings(page, { items: () => findings(30) });
  const tops = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("table.v2-table--fixed > thead th")].map(
        (th) => th.getBoundingClientRect().top,
      ),
    );
  for (const { tool, hash } of TOOLS) {
    await test.step(tool, async () => {
      await start(page, desktop, hash);
      await expect(rowsOf(page)).toHaveCount(30);
      await expect(page.locator(".v2-shell")).toHaveAttribute(
        "data-mode",
        "rail",
      );
      const region = page.locator(".v2-table-scroll");
      const widths = await region.evaluate((element) => ({
        scroll: element.scrollWidth,
        client: element.clientWidth,
      }));
      const [top] = await tops();
      if (tool !== "placement") {
        expect(
          widths.scroll,
          `${tool}: the table (${widths.scroll}px) fits its card (${widths.client}px)`,
        ).toBeLessThanOrEqual(widths.client + 0.5);
        await expect(region).not.toHaveAttribute("data-overflow");
        await expect(region).not.toHaveAttribute("role");
        await page.evaluate(() => window.scrollTo(0, 600));
        await expect(page.locator(".v2-topbar")).toHaveAttribute(
          "data-scrolled",
          "",
        );
        expectSame((await rect(page, ".v2-topbar")).bottom, 60, "topbar");
        for (const cell of await tops())
          expectSame(cell, 60, `${tool}: header cell top after 600px`);
        expect(
          await page.evaluate(() => {
            const th = document.querySelector(
              "table.v2-table--fixed > thead th",
            )!;
            const box = th.getBoundingClientRect();
            return !!document
              .elementFromPoint(box.left + 4, box.top + box.height / 2)
              ?.closest("thead");
          }),
          `${tool}: the stuck header covers the rows`,
        ).toBe(true);
        return;
      }
      expect(
        widths.scroll,
        `the placement table (${widths.scroll}px) is wider than its card (${widths.client}px)`,
      ).toBeGreaterThan(widths.client + 0.5);
      await expect(region).toHaveAttribute("data-overflow", "");
      const items = page.getByRole("region", { name: "Items", exact: true });
      await expect(items).toHaveAttribute("tabindex", "0");
      await items.focus();
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => region.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
      await page.evaluate(() => window.scrollTo(0, 600));
      await expect(page.locator(".v2-topbar")).toHaveAttribute(
        "data-scrolled",
        "",
      );
      for (const cell of await tops())
        expectSame(cell, top - 600, "placement header cell after 600px");
      expect(
        await pageOverflowX(page),
        "the page scrolls sideways",
      ).toBeLessThanOrEqual(0);
    });
  }
});

// --- Operation ----------------------------------------------------------

// E8: the drawer edits a draft. Disk placement counts it with a limit=1
// request (the button shows its total), Escape discards it, Apply writes
// it to the route once (no history entry) and the chips follow. Muxing
// counts locally, without a request.
test("the tool drawer applies only on Apply", async ({ page }) => {
  const totals: { query: string; total: number }[] = [];
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (
      url.pathname === "/api/placement/items" &&
      url.searchParams.get("limit") === "1"
    )
      totals.push({ query: url.search, total: (await response.json()).total });
  });
  await withTools(page);
  await start(page, desktop, "#/tools/placement");
  const length = await historyLength(page);
  let drawer = await openDrawer(page);
  await expect(drawer).toHaveAccessibleDescription(/Items/);
  await expect(applyButton(drawer)).toHaveText("Apply (5 matches)");
  expect(totals.at(-1)?.total).toBe(5);
  const several = () =>
    drawer.getByRole("checkbox", { name: /^Several disks/ });
  await several().check();
  await expect
    .poll(() => totals.find((t) => t.query.includes("status=several")))
    .toBeTruthy();
  const total = totals.find((t) => t.query.includes("status=several"))!.total;
  expect(total).toBe(3);
  await expect(applyButton(drawer)).toHaveText(`Apply (${total} matches)`);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(filtersButton(page)).toBeFocused();
  expect(await currentHash(page)).toBe("#/tools/placement");
  await expect(
    page.getByText("No active filters", { exact: true }),
  ).toBeVisible();
  drawer = await openDrawer(page);
  await expect(several()).not.toBeChecked();
  await several().check();
  await expect(applyButton(drawer)).toHaveText(`Apply (${total} matches)`);
  await applyButton(drawer).click();
  await expect(drawer).toHaveCount(0);
  await expect
    .poll(() => currentHash(page))
    .toBe("#/tools/placement?status=several");
  await expect(chips(page)).toHaveText(["Status: Several disks"]);
  await expect(rowsOf(page)).toHaveCount(total);
  expect(await historyLength(page), "no history entry").toBe(length);

  await test.step("Muxing counts locally", async () => {
    await start(page, desktop, "#/tools/mux");
    const asked: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/mux/"))
        asked.push(request.url());
    });
    drawer = await openDrawer(page);
    await expect(applyButton(drawer)).toHaveText("Apply (6 matches)");
    await drawer.getByRole("checkbox", { name: /^Failed/ }).check();
    await expect(applyButton(drawer)).toHaveText("Apply (1 match)");
    expect(
      asked.filter((url) => url.includes("limit=")),
      "a count request",
    ).toEqual([]);
    await applyButton(drawer).click();
    await expect
      .poll(() => currentHash(page))
      .toBe("#/tools/mux?status=failed");
    await expect(chips(page)).toHaveText(["Status: Failed"]);
  });
});

// E5: a KPI card filters by its statuses (the route, page 1), shows its
// state and resets on a second press.
test("KPI cards filter the list and show their state", async ({ page }) => {
  await withTools(page);
  await start(page, desktop, "#/tools/mux");
  const failed = toolKpis(page).getByRole("button", {
    name: "Failed 1",
    exact: true,
  });
  await expect(failed).toHaveAttribute("aria-pressed", "false");
  await expect(failed).toHaveAttribute("title", "Show only Failed");
  await failed.click();
  await expect.poll(() => currentHash(page)).toBe("#/tools/mux?status=failed");
  await expect(failed).toHaveAttribute("aria-pressed", "true");
  await expect(failed).toHaveAttribute("title", "Reset filters");
  await expect(rowsOf(page)).toHaveCount(1);
  await expect(chips(page)).toHaveText(["Status: Failed"]);
  await failed.click();
  await expect.poll(() => currentHash(page)).toBe("#/tools/mux");
  await expect(failed).toHaveAttribute("aria-pressed", "false");
  await expect(rowsOf(page)).toHaveCount(6);
  // The hero without statuses of its own is no button (Files & permissions).
  await start(page, desktop, "#/tools/files");
  const kpis = toolKpis(page);
  await expect(kpis).toHaveAccessibleName("Overview");
  await expect(kpis.locator(".v2-kpi--hero")).toHaveText(
    /Items checked\s*1,284/,
  );
  await expect(kpis.locator("div.v2-kpi--hero")).toHaveCount(1);
  const open = kpis.getByRole("button", { name: "Open 2", exact: true });
  await open.click();
  await expect.poll(() => currentHash(page)).toBe("#/tools/files?status=open");
  await expect(open).toHaveAttribute("aria-pressed", "true");
});

// E6, rulings R-B and I9: each disk card names its usage, free space and
// standby; the target of a waiting move carries the Target mark, a pool
// says it is no target, the bar warns from 85 %. The row is a focusable
// region only while it overflows (820 and 375, not 1440).
test("disk cards show usage, target and standby", async ({ page }) => {
  await withPlacement(page, { standby: true });
  await start(page, desktop, "#/tools/placement");
  const row = diskRow(page);
  const cards = row.locator("article.v2-disk");
  await expect(cards).toHaveCount(5);
  const names = await cards.evaluateAll((list) =>
    list.map((card) =>
      // The number formats part value and unit with a no-break space.
      card.getAttribute("aria-label")!.replace(/[\u00a0\u202f]/g, " "),
    ),
  );
  expect(names).toEqual([
    "disk1 · 89 % used · 989.6 GB free",
    "disk2 · 68 % used · 2.9 TB free · Standby",
    "disk3 · 78 % used · 2 TB free",
    "disk4 · 29 % used · 6.3 TB free · Standby",
    "cache · 31 % used · 758.7 GB free",
  ]);
  const card = (name: string) => cards.filter({ hasText: name });
  await expect(card("disk1").locator(".v2-tag--disk")).toHaveText("Target");
  await expect(row.locator(".v2-tag--disk")).toHaveCount(1);
  await expect(card("disk1").locator(".v2-disk-bar")).toHaveAttribute(
    "data-warn",
    "",
  );
  await expect(card("disk3").locator(".v2-disk-bar")).not.toHaveAttribute(
    "data-warn",
  );
  await expect(card("disk2").locator(".v2-disk-state")).toHaveText("Standby");
  await expect(card("disk2").locator(".v2-tile")).not.toHaveClass(
    /v2-tile--grad/,
  );
  await expect(card("disk1").locator(".v2-disk-state")).toHaveText("");
  await expect(card("cache").locator(".v2-disk-state")).toHaveText(
    "Pool (not a target)",
  );
  // I9: at 1440 the five cards fit; no region, no tab stop.
  await expect(row).not.toHaveAttribute("data-overflow");
  await expect(row).not.toHaveAttribute("role");
  await expect(row).not.toHaveAttribute("tabindex");
  for (const size of [sizeOf(820), phone]) {
    await page.setViewportSize(size);
    await expect(row).toHaveAttribute("data-overflow", "");
    await expect(
      page.getByRole("region", { name: "Disks and pools", exact: true }),
    ).toHaveAttribute("tabindex", "0");
    const height = (await row.boundingBox())!.height;
    expectSame(height, 84, `the disk row at ${label(size)}`);
    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
  }
});

// E12, E17 and the 1.7.0 dialogs (5d): every row action reaches its
// dialog or request (answered here), a removal asks first where 1.7.0
// did, and focus returns to the trigger.
test("tool rows reach their dialogs and actions", async ({ page }) => {
  await withTools(page);
  const sent: string[] = [];
  await page.route(/\/api\/(mux|placement|filecheck)\//, async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fallback();
    const url = new URL(request.url());
    sent.push(
      `${request.method()} ${url.pathname}${url.search} ${request.postData() ?? ""}`.trim(),
    );
    // The commands of a finding (its Terminal button).
    await route.fulfill({
      json: url.pathname.endsWith("/filecheck/commands")
        ? {
            text: "chmod 644 '/mnt/user/movies/Her (2013)/Her.2013.nfo'",
            hostPaths: false,
          }
        : {},
    });
  });
  const dialog = async (trigger: Locator, name: string) => {
    await trigger.click();
    const shown = page.getByRole("dialog", { name, exact: true });
    await expect(shown).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(shown).toHaveCount(0);
    await expect(trigger).toBeFocused();
  };
  const request = async (trigger: Locator, expected: string) => {
    const before = sent.length;
    await trigger.click();
    await expect.poll(() => sent.slice(before)).toContain(expected);
  };
  // The question first closes without an answer: nothing is sent and
  // focus is back on the trigger (Task 10 review M-6); then it is
  // answered. A job that stays in the list (Cancel) keeps the focus on
  // its trigger after the answer too; a deleted row fades out.
  const confirm = async (
    trigger: Locator,
    expected: string,
    { stays = false } = {},
  ) => {
    const ask = page.getByRole("dialog", { name: "Confirm deletion" });
    const before = sent.length;
    await trigger.click();
    await expect(ask).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(ask).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(sent.slice(before), "no answer, no request").toEqual([]);
    await trigger.click();
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "Delete", exact: true }).click();
    await expect.poll(() => sent.slice(before)).toContain(expected);
    await expect(ask).toHaveCount(0);
    if (stays) await expect(trigger).toBeFocused();
  };
  await test.step("Muxing", async () => {
    await start(page, desktop, "#/tools/mux");
    const dune = rowWith(page, "Dune (2021).mkv");
    const button = (name: string) =>
      dune.getByRole("button", { name, exact: true });
    await dialog(button("Mux options for Dune"), "Mux options");
    await dialog(button("Terminal for Dune"), "MKVToolNix log");
    await dialog(button("Status: Ready. Show checks"), "Status");
    await request(button("Start item Dune"), 'POST /api/mux/run {"ids":[3]}');
    await confirm(
      button("Delete mux job: Dune (2021).mkv"),
      "DELETE /api/mux/jobs?id=3",
    );
    // A running job's Cancel asks too, and its row stays (M-6).
    await confirm(
      rowWith(page, "Arrival (2016).mkv").getByRole("button", {
        name: "Cancel mux job: Arrival (2016).mkv",
        exact: true,
      }),
      "POST /api/mux/cancel?id=1",
      { stays: true },
    );
  });
  await test.step("Disk placement", async () => {
    await start(page, desktop, "#/tools/placement");
    const bad = rowWith(page, "Breaking Bad");
    const button = (name: string) =>
      bad.getByRole("button", { name, exact: true });
    await dialog(button("Details for Breaking Bad"), "Breaking Bad");
    await dialog(button("Terminal for Breaking Bad"), "Disk placement log");
    await dialog(button("Status: Split. Show checks"), "Status");
    await request(
      button("Start item Breaking Bad"),
      'POST /api/placement/start {"ids":[1]}',
    );
    await request(
      rowWith(page, "Dune: Part Two").getByRole("button", {
        name: "Remove Dune: Part Two from the list",
        exact: true,
      }),
      "DELETE /api/placement/items/4",
    );
    await dialog(
      rowWith(page, "Severance").getByRole("button", {
        name: "+1 · Show all disks for Severance",
        exact: true,
      }),
      "Severance",
    );
  });
  await test.step("Files & permissions", async () => {
    await start(page, desktop, "#/tools/files");
    const path = "movies/Her (2013)/Her.2013.nfo";
    const her = rowWith(page, "Her.2013.nfo");
    const button = (name: string) =>
      her.getByRole("button", { name, exact: true });
    await dialog(button(`Details for ${path}`), "Her");
    await dialog(button(`Terminal for ${path}`), "Terminal commands");
    await dialog(button("Status: Open. Show details"), "Her");
    await request(button(`Fix ${path}`), 'POST /api/filecheck/fix {"ids":[2]}');
    await request(
      rowWith(page, "Season 2").getByRole("button", {
        name: "Remove shows/Dark/Season 2 from the list",
        exact: true,
      }),
      "DELETE /api/filecheck/items/3",
    );
  });
});

// R-C, E13: on a phone each row is a card under a sort bar; every visible
// column stays in every row, Details is offered and the desk buttons
// (Start, Terminal, Mux options, Fix) are hidden, the sort bar scrolls
// sideways inside the card, and a sort changes the route.
test("narrow tool cards keep every column and offer details", async ({
  page,
}) => {
  await withTools(page);
  for (const { tool, hash, rows } of TOOLS) {
    await test.step(tool, async () => {
      await start(page, phone, hash);
      const table = page.getByRole("table");
      const head = table.getByRole("rowgroup").first();
      const body = table.getByRole("rowgroup").nth(1);
      const columns = await head.getByRole("columnheader").count();
      await expect(body.getByRole("row")).toHaveCount(rows);
      for (const cells of await body
        .getByRole("row")
        .evaluateAll((list) =>
          list.map(
            (row) => row.querySelectorAll(":scope > [role=cell]").length,
          ),
        ))
        expect(cells, `${tool}: cells per card row`).toBe(columns);
      await expect(body.getByRole("row").first()).toHaveCSS("display", "grid");
      const desk = page.locator("tbody .v2-row-btn--desk");
      expect(await desk.count()).toBeGreaterThan(0);
      for (const shown of await desk.evaluateAll((list) =>
        list.map((button) => getComputedStyle(button).display),
      ))
        expect(shown, `${tool}: a desk button shows`).toBe("none");
      const first = body.getByRole("row").first();
      await expect(
        first.getByRole("button", { name: /^Details for / }),
      ).toBeVisible();
      for (const name of [/^Start item /, /^Terminal for /, /^Mux options /])
        await expect(first.getByRole("button", { name })).toBeHidden();
      const bar = page.locator(".v2-table > thead");
      expect(
        await bar.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        ),
        `${tool}: the sort bar scrolls sideways`,
      ).toBe(true);
      expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
      // Files & permissions has no size column: it sorts by its title
      // (Task 10 review M-3).
      const [field, key] =
        tool === "files" ? ["Title", "title"] : ["Size", "size"];
      await head
        .getByRole("button", { name: `Sort by ${field}`, exact: true })
        .click();
      await expect.poll(() => currentHash(page)).toContain(`sort=${key}`);
    });
  }
});

// Ruling A with the real typeface: the default columns of Muxing fit
// their card at 1440 beside the rail in all four languages, those of
// Files & permissions in English (the header sticks); Disk placement's
// twelve are wider by ruling, and so are Files & permissions' wherever
// its kinds and fixes (measured whole, F-I2) need more than the card
// (German, Spanish and Italian): they scroll inside the card as its
// focusable named region (asserted first), the header does not stick and
// the page never scrolls sideways. Which way a table goes follows its
// measured minimum (--tt-min), so both ways are asserted.
test("tool tables fit at 1440 in four languages", async ({ page }) => {
  test.setTimeout(180_000);
  await withTools(page);
  const regionName: Record<string, Record<string, string>> = {
    placement: { en: "Items", de: "Einträge", es: "Elementos", it: "Elementi" },
    files: { en: "Findings", de: "Funde", es: "Hallazgos", it: "Risultati" },
  };
  for (const language of LANGUAGES) {
    await test.step(language, async () => {
      await inLanguage(page, language);
      for (const { tool, hash } of TOOLS) {
        await start(page, desktop, hash);
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        await expect(page.locator(".v2-shell")).toHaveAttribute(
          "data-mode",
          "rail",
        );
        const where = `${tool} in ${language}`;
        const region = page.locator(".v2-table-scroll");
        const fit = await region.evaluate((element) => ({
          scroll: element.scrollWidth,
          client: element.clientWidth,
          min: Number.parseFloat(
            element
              .querySelector<HTMLElement>("table.v2-table--fixed")!
              .style.getPropertyValue("--tt-min"),
          ),
        }));
        test.info().annotations.push({
          type: "table width at 1440",
          description: `${where}: ${fit.scroll} in ${fit.client} (minimum ${fit.min})`,
        });
        const sticky = await page
          .locator("table.v2-table--fixed > thead th")
          .first()
          .evaluate((th) => getComputedStyle(th).position);
        const wide =
          tool === "placement" ||
          (tool === "files" && fit.min > fit.client + 0.5);
        if (tool === "files" && language === "en")
          expect(wide, `${where} fits`).toBe(false);
        if (wide) {
          expect(fit.scroll, `${where} overflows by ruling`).toBeGreaterThan(
            fit.client + 0.5,
          );
          await expect(
            page.getByRole("region", {
              name: regionName[tool][language],
              exact: true,
            }),
          ).toHaveAttribute("tabindex", "0");
          expect(sticky, `${where}: the header sticks`).not.toBe("sticky");
        } else {
          expect(fit.scroll, where).toBeLessThanOrEqual(fit.client + 0.5);
          await expect(region).not.toHaveAttribute("data-overflow");
          expect(sticky, `${where}: the header sticks`).toBe("sticky");
        }
        expect(await pageOverflowX(page), where).toBeLessThanOrEqual(0);
      }
    });
  }
});

// F-I2 (Phase 5b fix wave): every tool cell keeps its content inside its
// column, at 1440 and 1119 in all four languages, with the longest texts
// of each finite set (the kinds, Take ownership, Delete) and user data
// wider than a column (an instance name, a pool name). A cell or a clip
// box inside it (overflow other than visible) is never wider than it
// shows, unless it ends in an ellipsis and a title (on it or around it in
// the cell) holds its whole text, as 1.7.0 clipped its cells.
const LONG_NAME = "Radarr Anime Collection 4K";
async function withLongNames(page: Page) {
  await withMuxJobs(page, () => muxJobs());
  // Muxing names a job's service from the status (serviceNames); this
  // answer replaces withMuxJobs' one, so it says MKVToolNix is there too.
  await withStatus(page, (status) => {
    const shown = status as {
      mux?: Record<string, unknown>;
      serviceNames?: Record<string, string>;
    };
    shown.mux = { ...shown.mux, enabled: true, installed: true };
    shown.serviceNames = { ...shown.serviceNames, radarr: LONG_NAME };
  });
  await withPlacement(page, {
    items: () => [
      ...placementItems(),
      placementItem(
        6,
        "Show 6",
        { cache_nvme_pool: 30 * GIB, disk12: 9 * GIB, disk3: GIB },
        { instance: LONG_NAME, target: "disk12", kind: "small_files" },
      ),
    ],
  });
  await withFindings(page, {
    items: () => [
      ...findings(),
      finding(5, "", "Film 5", "movies/Film 5/Film 5 extra.mkv", {
        kind: "untracked_media",
        fix: "delete",
        instance: LONG_NAME,
        size: 4096,
      }),
      finding(6, "", "Film 6", "movies/Film 6", {
        dir: true,
        kind: "empty_dir",
        fix: "take_ownership",
        mode: 0o755,
      }),
    ],
  });
}

test("tool cells keep their content inside in four languages", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await withLongNames(page);
  for (const language of LANGUAGES) {
    await test.step(language, async () => {
      await inLanguage(page, language);
      for (const size of [desktop, sizeOf(1119)])
        for (const { tool, hash } of TOOLS) {
          await start(page, size, hash);
          await expect(page.locator("html")).toHaveAttribute("lang", language);
          const where = `${tool} in ${language} at ${label(size)}`;
          const report = await page.evaluate(() => {
            const cells = [
              ...document.querySelectorAll<HTMLElement>(
                "table.v2-table--fixed > tbody > tr > td:not(.v2-table-sel)",
              ),
            ];
            const out: string[] = [];
            let clipped = 0;
            // What a box shows: its text without the visually hidden
            // descriptions (v2-sr-only, clipped by design).
            const shown = (box: HTMLElement) => {
              const copy = box.cloneNode(true) as HTMLElement;
              copy.querySelectorAll(".v2-sr-only").forEach((n) => n.remove());
              return (copy.textContent || "").trim();
            };
            for (const cell of cells) {
              const boxes = [
                cell,
                ...cell.querySelectorAll<HTMLElement>("*"),
              ].filter(
                (box) =>
                  !box.closest(".v2-sr-only") &&
                  (box === cell ||
                    getComputedStyle(box).overflowX !== "visible"),
              );
              for (const box of boxes) {
                if (box.scrollWidth <= box.clientWidth) continue;
                const full = shown(box);
                let titled = false;
                for (
                  let at: HTMLElement | null = box;
                  at && cell.contains(at);
                  at = at.parentElement
                )
                  if (at.title && at.title.includes(full)) titled = true;
                for (const inner of box.querySelectorAll<HTMLElement>(
                  "[title]",
                ))
                  if (inner.title.includes(full)) titled = true;
                const style = getComputedStyle(box);
                if (
                  style.overflowX !== "visible" &&
                  style.textOverflow === "ellipsis" &&
                  titled
                ) {
                  clipped++;
                  continue;
                }
                out.push(
                  `${cell.dataset.label} "${full}": ${box.scrollWidth} in ${box.clientWidth}` +
                    ` (${box === cell ? "the cell" : box.className})`,
                );
              }
            }
            return { count: cells.length, out, clipped };
          });
          expect(report.count, `${where}: cells`).toBeGreaterThan(0);
          test.info().annotations.push({
            type: "clipped cells",
            description: `${where}: ${report.clipped}`,
          });
          expect.soft(report.out, where).toEqual([]);
        }
    });
  }
});

// E10: from a card of 760 on, the chips row is one line of --chips-h with
// every tool on it, in all four languages (at 1440 and 1119); its last
// tool ends inside the card. Below 560 the tools take lines of their own
// (5a, the card rows' rule).
test("tool chips rows keep one line in four languages", async ({ page }) => {
  test.setTimeout(180_000);
  await withTools(page);
  for (const language of LANGUAGES) {
    await test.step(language, async () => {
      await inLanguage(page, language);
      for (const size of [desktop, sizeOf(1119)])
        for (const { tool, hash } of TOOLS) {
          await start(page, size, hash);
          const where = `${tool} in ${language} at ${label(size)}`;
          const line = await page.evaluate(() => {
            const row = document.querySelector(".v2-chips-row")!;
            const tools = [
              ...document.querySelectorAll(".v2-tc-tools > :not([aria-live])"),
            ].map((element) => element.getBoundingClientRect());
            const box = row.getBoundingClientRect();
            const card = document
              .querySelector(".v2-table-card")!
              .getBoundingClientRect();
            return {
              height: box.height,
              chips: parseFloat(
                getComputedStyle(document.documentElement).getPropertyValue(
                  "--chips-h",
                ),
              ),
              // One line: every tool (and separator) is centered on it.
              tops: [
                ...new Set(
                  tools.map((tool) => Math.round(tool.top + tool.height / 2)),
                ),
              ],
              right: Math.max(...tools.map((tool) => tool.right)),
              cardRight: card.right,
            };
          });
          expectSame(line.height, line.chips, `${where}, chips row height`);
          expect(line.tops.length, `${where}: tool lines`).toBe(1);
          expect(line.right, `${where}: the last tool`).toBeLessThanOrEqual(
            line.cardRight,
          );
        }
    });
  }
});

// 5a M12 on the tool pages: a press on a toast closes no open popover, so
// the HelpTip stays open (the toast came first).
test("a press on a toast leaves the tool help open", async ({ page }) => {
  await withTools(page);
  for (const { tool, hash } of TOOLS) {
    await test.step(tool, async () => {
      await start(page, desktop, hash);
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent("scopearr-notification", {
            detail: { message: "Settings saved", kind: "success" },
          }),
        ),
      );
      const toast = page
        .locator(".toast")
        .filter({ hasText: "Settings saved" });
      await expect(toast).toBeVisible();
      await toolCard(page)
        .getByRole("button", { name: "Help", exact: true })
        .click();
      const help = page.getByRole("dialog", { name: "Help", exact: true });
      await expect(help).toBeVisible();
      await toast.locator("span").first().click();
      await expect(help).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(help).toHaveCount(0);
    });
  }
});

// E28: the drawer is a dialog on the dialog stack, so ⌘K / Ctrl+K wait
// until it has closed.
test("quick search is closed while the tool drawer is open", async ({
  page,
}) => {
  await withTools(page);
  for (const { tool, hash } of TOOLS) {
    await test.step(tool, async () => {
      await start(page, desktop, hash);
      const drawer = await openDrawer(page);
      for (const keys of ["Control+k", "Meta+k"]) {
        await page.keyboard.press(keys);
        await expect(quickSearch(page)).toHaveCount(0);
        await expect(drawer).toBeVisible();
      }
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await expect(filtersButton(page)).toBeFocused();
      await page.keyboard.press("Control+k");
      await expect(quickSearch(page)).toBeVisible();
      await page.keyboard.press("Escape");
    });
  }
});
