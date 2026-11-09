// The dashboard (Phase 5a, docs/STYLEGUIDE.md, Part 1, 10.2, 10.10 and
// 11.3): its geometry from the first paint on, while loading, after an
// error and in every state of the storage card, its rows at the
// breakpoints, and its links, scope, storage areas, More and widgets as a
// user drives them. Measured after network idle and loaded fonts;
// tolerance 0.5 px. Nothing here keeps a saved setting: all tests share
// one demo database.
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  ALL,
  boxesOf,
  currentHash,
  expectSame,
  expectSteady,
  firstPaintChanges,
  historyLength,
  inLanguage,
  LANGUAGES,
  MORE_CODECS,
  openRoute,
  pageOverflowX,
  preferSidebar,
  recordBoxes,
  recordFirstPaint,
  rect,
  settle,
  sizeLabel as label,
  sizeOf,
  storageArea,
  WIDTHS,
  withMoreValues,
  withStorageAreas,
  type Edge,
  type StorageArea,
} from "./app";

type Size = { width: number; height: number };
const desktop = sizeOf(1440),
  phone = sizeOf(375);

const kpis = (page: Page) => page.locator(".v2-dash-kpis > a");
const storageCard = ".v2-dash-row > .v2-widget:has(.v2-ring)";
const scopeTab = (page: Page, name: string) =>
  page
    .getByRole("tablist", { name: "Statistics scope" })
    .getByRole("tab", { name, exact: true });
const distribution = (page: Page, title: string) =>
  page
    .locator(".v2-dash-grid > .v2-dist")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });

// The statistics are in: the KPIs show their numbers.
async function painted(page: Page) {
  await expect(kpis(page).first().locator(".v2-kpi-value")).toHaveText(/\d/);
}

// A fresh load (not a hash change of the same document) at `size`.
async function start(page: Page, size: Size, hash = "#/dashboard") {
  await page.setViewportSize(size);
  await page.goto("about:blank");
  await openRoute(page, hash);
  await painted(page);
  await settle(page);
}

// Back as the browser button does it, without waiting for a load like
// page.goBack(), to the dashboard with its numbers.
async function back(page: Page) {
  await page.evaluate(() => history.back());
  await expect.poll(() => currentHash(page)).toBe("#/dashboard");
  await painted(page);
}

// The answers of /api/statistics and /api/storage come `ms` late.
async function delayData(page: Page, ms: number) {
  await page.route(/\/api\/(statistics|storage)$/, async (route) => {
    await new Promise((done) => setTimeout(done, ms));
    await route.fallback();
  });
}

// The cards by place: the page header (Retry takes its action slot), the
// four KPIs, the widget row with its three cards and the storage ring's
// place, the distribution head with the scope tabs and the five cards.
const CARDS: Record<string, Edge[]> = {
  ".v2-band": ALL,
  ".v2-page-head": ALL,
  "main h1": ALL,
  ".v2-dash-kpis": ALL,
  ...Object.fromEntries(
    [1, 2, 3, 4].map((n) => [`.v2-dash-kpis > :nth-child(${n})`, ALL]),
  ),
  ".v2-dash-row": ALL,
  ...Object.fromEntries(
    [1, 2, 3].map((n) => [`.v2-dash-row > :nth-child(${n})`, ALL]),
  ),
  ".v2-ring": ALL,
  ".v2-dash-head": ALL,
  ".v2-dash-head [role=tablist]": ALL,
  ...Object.fromEntries(
    [1, 2, 3, 4, 5].map((n) => [`.v2-dash-grid > :nth-child(${n})`, ALL]),
  ),
};

// With an error, Retry takes the header's action slot: the heading keeps
// its place and height, its box (not its text) ends before the slot.
const FAILED: Record<string, Edge[]> = {
  ...CARDS,
  "main h1": ["x", "y", "height"],
};

// --- Geometry and jumps -------------------------------------------------

// E3: no sheet; the KPI row starts at 146 (≤ 739: 172) right below the
// page header and overlaps the band; no width scrolls sideways, also with
// a stored expanded sidebar from 740 to 899.
test("the dashboard cards start on the band", async ({ page }) => {
  test.setTimeout(180_000);
  const check = async (size: Size, where: string) => {
    const top = size.width <= 739 ? 172 : 146;
    const band = await rect(page, ".v2-band");
    const first = await rect(page, ".v2-dash-kpis > :first-child");
    await expect(page.locator("main.v2-main")).not.toHaveAttribute(
      "data-sheet",
    );
    expect(
      await page.evaluate(
        () => document.querySelector(".v2-view")?.firstElementChild?.className,
      ),
      `${where}: the dashboard is the view's block`,
    ).toBe("v2-dash");
    expectSame((await rect(page, ".v2-dash")).y, top, `${where}, page top`);
    expectSame(first.y, top, `${where}, first KPI top`);
    expectSame(
      (await rect(page, ".v2-page-head")).bottom,
      first.y,
      `${where}, page header bottom`,
    );
    expect(first.y, `${where}: the cards overlap the band`).toBeLessThan(
      band.bottom,
    );
    expect(
      await pageOverflowX(page),
      `${where} scrolls sideways`,
    ).toBeLessThanOrEqual(0);
  };
  for (const width of WIDTHS) {
    const size = sizeOf(width);
    await test.step(label(size), async () => {
      await start(page, size);
      await check(size, `dashboard at ${label(size)}`);
    });
  }
  await preferSidebar(page, "expanded");
  for (const width of [899, 820, 740]) {
    const size = sizeOf(width);
    await test.step(`${label(size)} with a stored expanded sidebar`, async () => {
      await start(page, size);
      await expect(page.locator("#v2-sidebar")).toHaveAttribute(
        "data-mode",
        "expanded",
      );
      await check(size, `dashboard at ${label(size)} (expanded)`);
    });
  }
});

// D2: every card has its final place and size from the first paint on,
// while the statistics and the storage readings come 300 ms late, through
// a scope switch, and through a failed load and its Retry (the cards keep
// their placeholders, Retry takes the header's action slot).
test("the dashboard keeps its places while loading", async ({ page }) => {
  test.setTimeout(240_000);
  await recordFirstPaint(page);
  await recordBoxes(page, Object.keys(CARDS));
  await delayData(page, 300);
  let failing = false;
  await page.route(/\/api\/statistics$/, (route) =>
    failing
      ? route.fulfill({ status: 500, json: { error: "unavailable" } })
      : route.fallback(),
  );
  for (const width of [1600, 1440, 1119, 820, 740, 739, 375]) {
    const size = sizeOf(width);
    await test.step(label(size), async () => {
      failing = false;
      await start(page, size);
      const frame = await firstPaintChanges(page);
      expect(frame.first, `the frame at ${label(size)}`).toEqual([]);
      expect(frame.frames, `the frame at ${label(size)}`).toEqual([]);
      const loaded = await boxesOf(page, Object.keys(CARDS));
      const frames = await expectSteady(
        page,
        CARDS,
        `dashboard at ${label(size)}`,
      );
      // The placeholders were painted: the first frames had no numbers.
      expect(
        frames[".v2-dash-kpis > :nth-child(1)"]?.length ?? 0,
        `frames recorded at ${label(size)}`,
      ).toBeGreaterThan(0);
      // Dispatched clicks: a pointer click would scroll the tabs into view
      // first, and the boxes are compared in place.
      await scopeTab(page, "TV series").dispatchEvent("click");
      await settle(page);
      await expectSteady(
        page,
        CARDS,
        `entire library → TV series at ${label(size)}`,
        loaded,
      );
      await scopeTab(page, "Entire library").dispatchEvent("click");
      await settle(page);
      await expectSteady(
        page,
        CARDS,
        `TV series → entire library at ${label(size)}`,
        loaded,
      );
      if (width !== 1440 && width !== 375) return;
      failing = true;
      await page.goto("about:blank");
      await openRoute(page, "#/dashboard");
      const retry = page
        .locator(".v2-page-head")
        .getByRole("button", { name: "Retry", exact: true });
      await expect(retry).toBeVisible();
      await expect(kpis(page).first().locator(".v2-kpi-value")).not.toHaveText(
        /\d/,
      );
      await expectSteady(
        page,
        FAILED,
        `a failed load at ${label(size)}`,
        loaded,
      );
      // The error's toast covers Retry at 1440 for its five seconds (the
      // toast placement is open for the 5a final review); a user closes it.
      await page
        .getByRole("button", { name: "Dismiss notification", exact: true })
        .click();
      failing = false;
      await retry.click();
      await painted(page);
      await settle(page);
      await expect(retry).toHaveCount(0);
      await expectSteady(page, FAILED, `Retry at ${label(size)}`, loaded);
      expect(
        (await boxesOf(page, ["main h1"]))["main h1"],
        `the heading after Retry at ${label(size)}`,
      ).toEqual(loaded["main h1"]);
    });
  }
});

// The storage card in each state (Task 10 review): before the first
// reading, without storage paths, with a ring, with a ring and the area's
// error below the legend (the longest error, two lines on a phone), an
// area's error without a reading, and stale readings. In all four
// languages and at all widths the card, its head and the ring's place keep
// one box, the ring's content stays inside its place (the phone's ring is
// 112), and no width scrolls sideways.
const LONG_ERROR = "Shared storage readings have different total capacities";
const STORAGE_STATES: {
  name: string;
  answer(route: Route): Promise<void>;
  shown(page: Page): Promise<void>;
}[] = [
  {
    name: "before the first reading",
    // Held until the page leaves.
    answer: () => new Promise(() => {}),
    async shown(page) {
      await expect(page.locator(".v2-ring-track")).toHaveCount(1);
      await expect(page.locator(".v2-ring-note")).toHaveCount(0);
    },
  },
  {
    name: "without storage paths",
    answer: (route) => route.fallback(),
    async shown(page) {
      await expect(page.locator(".v2-ring-note")).toHaveCount(1);
    },
  },
  {
    name: "with a ring",
    answer: (route) => fulfillAreas(route, [storageArea("movies", 9.3)]),
    async shown(page) {
      await expect(page.locator(".v2-ring-chart[role=img]")).toHaveCount(1);
    },
  },
  {
    name: "with a ring and an area error",
    answer: (route) =>
      fulfillAreas(route, [storageArea("movies", 9.3, { error: LONG_ERROR })]),
    async shown(page) {
      await expect(page.locator(".v2-ring-chart[role=img]")).toHaveCount(1);
      await expect(page.locator(".v2-ring-error")).toHaveCount(1);
    },
  },
  {
    name: "with an area error and no reading",
    answer: (route) =>
      fulfillAreas(route, [
        storageArea("movies", 0, {
          error: "A selected storage path is unavailable",
          total: 0,
        }),
      ]),
    async shown(page) {
      await expect(page.locator(".v2-ring-note")).toHaveCount(1);
      await expect(page.locator(".v2-ring-error")).toHaveCount(1);
    },
  },
  {
    name: "with stale readings",
    answer: (route) =>
      route.fulfill({ status: 503, json: { error: "unavailable" } }),
    async shown(page) {
      await expect(page.locator(".v2-ring-note")).toHaveCount(1);
    },
  },
];
function fulfillAreas(route: Route, areas: StorageArea[]) {
  return route.fulfill({
    json: { services: {}, areas: { all: areas, radarr: areas, sonarr: [] } },
  });
}
const STORAGE_PARTS = [
  storageCard,
  `${storageCard} .v2-widget-head`,
  ".v2-ring",
];

test("the storage card keeps its box in every state", async ({ page }) => {
  test.setTimeout(480_000);
  let state = STORAGE_STATES[0];
  await page.route(/\/api\/storage$/, (route) => state.answer(route));
  for (const language of LANGUAGES) {
    await test.step(language, async () => {
      await inLanguage(page, language);
      const reference: Record<number, Record<string, DOMRect | null>> = {};
      for (state of STORAGE_STATES) {
        await page.setViewportSize(desktop);
        await page.goto("about:blank");
        await page.goto("/#/dashboard");
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        await painted(page);
        await state.shown(page);
        for (const width of WIDTHS) {
          const size = sizeOf(width);
          const where = `${state.name} in ${language} at ${label(size)}`;
          await page.setViewportSize(size);
          await page.evaluate(async () => {
            await document.fonts.ready;
            await new Promise((done) =>
              requestAnimationFrame(() => requestAnimationFrame(done)),
            );
          });
          const boxes = await boxesOf(page, STORAGE_PARTS);
          reference[width] ??= boxes;
          for (const part of STORAGE_PARTS)
            for (const edge of ALL)
              expectSame(
                boxes[part]![edge],
                reference[width][part]![edge],
                `${where}: ${part} ${edge}`,
              );
          // The ring's place holds its content: nothing below or beside
          // it, and the card holds the place.
          const inside = await page.evaluate((card) => {
            const ring = document.querySelector(".v2-ring")!;
            const place = ring.getBoundingClientRect();
            const outer = document.querySelector(card)!.getBoundingClientRect();
            return {
              size: parseFloat(
                getComputedStyle(document.documentElement).getPropertyValue(
                  "--ring-size",
                ),
              ),
              height: place.height,
              out: [...ring.querySelectorAll("*")]
                .map((element) => [element, element.getBoundingClientRect()])
                .filter(
                  ([, box]) =>
                    (box as DOMRect).height > 0 &&
                    ((box as DOMRect).top < place.top - 0.5 ||
                      (box as DOMRect).bottom > place.bottom + 0.5 ||
                      (box as DOMRect).right > outer.right + 0.5),
                )
                .map(([element]) => (element as Element).className),
              clipped: [
                ...ring.querySelectorAll(".v2-ring-error, .v2-ring-note"),
              ].filter(
                (element) =>
                  element.scrollHeight > element.clientHeight + 0.5 &&
                  !(element as HTMLElement).title,
              ).length,
            };
          }, storageCard);
          expectSame(inside.height, inside.size, `${where}: the ring's place`);
          expect(inside.out, `${where}: outside the ring's place`).toEqual([]);
          expect(inside.clipped, `${where}: clipped without title`).toBe(0);
          expect(
            await pageOverflowX(page),
            `${where} scrolls sideways`,
          ).toBeLessThanOrEqual(0);
        }
      }
    });
  }
});

// D7: the widget row has three columns, two below 1280 (storage spans
// both), one on phones; the distribution grid three, two below 1120, one
// on phones; the KPIs four, two below 1120.
test("dashboard rows follow the breakpoints", async ({ page }) => {
  test.setTimeout(120_000);
  const columns = (selector: string) =>
    page.evaluate((query) => {
      const items = [...document.querySelectorAll(query + " > *")]
        .map((element) => element.getBoundingClientRect())
        .filter((box) => box.height > 0);
      return {
        lefts: new Set(items.map((box) => Math.round(box.left))).size,
        tops: items.map((box) => Math.round(box.top)),
        widths: items.map((box) => Math.round(box.width)),
        row: Math.round(
          document.querySelector(query)!.getBoundingClientRect().width,
        ),
      };
    }, selector);
  await start(page, sizeOf(1600));
  for (const [width, kpi, row, grid] of [
    [1600, 4, 3, 3],
    [1280, 4, 3, 3],
    [1279, 4, 2, 3],
    [1120, 4, 2, 3],
    [1119, 2, 2, 2],
    [740, 2, 2, 2],
    [739, 2, 1, 1],
    [375, 2, 1, 1],
  ]) {
    const size = sizeOf(width);
    await test.step(label(size), async () => {
      await page.setViewportSize(size);
      await settle(page);
      expect((await columns(".v2-dash-kpis")).lefts, "KPI columns").toBe(kpi);
      const widgets = await columns(".v2-dash-row");
      expect(widgets.lefts, "widget row columns").toBe(row);
      if (row === 2) {
        // Storage spans the row below the other two.
        expect(widgets.tops[0]).toBe(widgets.tops[1]);
        expect(widgets.tops[2]).toBeGreaterThan(widgets.tops[0]);
        expect(widgets.widths[2]).toBe(widgets.row);
      }
      if (row === 3) expect(new Set(widgets.tops).size).toBe(1);
      expect((await columns(".v2-dash-grid")).lefts, "grid columns").toBe(grid);
    });
  }
});

// --- Links ----------------------------------------------------------------

// D3: each KPI is a link to its list without filters. A plain click opens
// it in the app (no reload, a pushed history entry, Back returns); a click
// with Ctrl or Cmd keeps the browser's link and opens a new tab.
test("KPI cards open their lists", async ({ page, context }) => {
  test.setTimeout(120_000);
  const kept = () =>
    page.evaluate(() => (window as Window & { __keep?: number }).__keep);
  await start(page, desktop);
  await page.evaluate(() => {
    (window as Window & { __keep?: number }).__keep = 1;
  });
  // Each push after Back replaces the entry Back left.
  const length = (await historyLength(page)) + 1;
  for (const [index, name, hash, heading] of [
    [0, "Movies", "#/movies", "Movie library"],
    [1, "TV series", "#/series", "TV library"],
    [2, "Episodes", "#/series", "TV library"],
    [3, "Media files", "#/movies", "Movie library"],
  ] as const) {
    await test.step(name, async () => {
      const kpi = kpis(page).nth(index);
      await expect(kpi.locator(".v2-kpi-label")).toHaveText(name);
      await expect(kpi).toHaveAttribute("href", hash);
      const [tab] = await Promise.all([
        context.waitForEvent("page"),
        kpi.click({ modifiers: ["ControlOrMeta"] }),
      ]);
      await expect(
        tab.getByRole("heading", { level: 1, name: heading, exact: true }),
      ).toBeVisible();
      await expect.poll(() => currentHash(tab)).toBe(hash);
      await tab.close();
      expect(await currentHash(page)).toBe("#/dashboard");
      await kpi.click();
      await expect(
        page.getByRole("heading", { level: 1, name: heading, exact: true }),
      ).toBeVisible();
      await expect.poll(() => currentHash(page)).toBe(hash);
      expect(await historyLength(page)).toBe(length);
      expect(await kept(), "no reload").toBe(1);
      await back(page);
    });
  }
});

// D4: Show opens metadata=incomplete in the scope's service: the library
// shown last for the entire library, else the scope's.
test("incomplete metadata opens its filter", async ({ page }) => {
  const show = () =>
    page.getByRole("link", {
      name: "Show · Filter Metadata status: incomplete",
      exact: true,
    });
  await start(page, desktop);
  await expect(show()).toHaveAttribute("href", "#/movies?metadata=incomplete");
  await show().click();
  await expect
    .poll(() => currentHash(page))
    .toBe("#/movies?metadata=incomplete");
  await expect(
    page
      .getByRole("group", { name: "Filters", exact: true })
      .locator(".v2-chip"),
  ).toHaveText(["Metadata status: incomplete"]);
  await back(page);
  await scopeTab(page, "TV series").click();
  await expect(show()).toHaveAttribute("href", "#/series?metadata=incomplete");
  await show().click();
  await expect
    .poll(() => currentHash(page))
    .toBe("#/series?metadata=incomplete");
  await expect(
    page.getByRole("heading", { level: 1, name: "TV library", exact: true }),
  ).toBeVisible();
});

// D9: every value of every card opens the route of its href in the app
// (one guarded link, openLink); the entire library opens the library shown
// last (the movies at first), TV series the TV library; Unknown is
// __unknown__, and the list shows the value's filter.
test("a distribution value opens the filtered library", async ({ page }) => {
  test.setTimeout(180_000);
  const unknown = page.getByRole("link", {
    name: "Filter Resolution: Unknown",
    exact: true,
  });
  await start(page, desktop);
  await expect(unknown).toHaveAttribute(
    "href",
    "#/movies?resolution=__unknown__",
  );
  for (const scope of ["Entire library", "TV series"]) {
    await scopeTab(page, scope).click();
    const links = page.locator(".v2-dash-grid a");
    const count = await links.count();
    expect(count, `${scope}: value links`).toBeGreaterThan(9);
    for (let i = 0; i < count; i++) {
      const link = links.nth(i);
      const href = (await link.getAttribute("href"))!;
      const name = (await link.getAttribute("aria-label"))!;
      await test.step(`${scope}: ${name}`, async () => {
        expect(href, name).toMatch(
          scope === "TV series" ? /^#\/series\?/ : /^#\/movies\?/,
        );
        await link.click();
        await expect.poll(() => currentHash(page), name).toBe(href);
        await expect(page.locator(".v2-table-card")).toBeVisible();
        await back(page);
      });
    }
  }
  await scopeTab(page, "Entire library").click();
  await expect(unknown).toHaveAttribute(
    "href",
    "#/series?resolution=__unknown__",
  );
  await scopeTab(page, "TV series").click();
  await page
    .getByRole("link", { name: "Filter Resolution: 1080p", exact: true })
    .click();
  await expect.poll(() => currentHash(page)).toBe("#/series?resolution=1080p");
  await expect(
    page.getByRole("heading", { level: 1, name: "TV library", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "Filters", exact: true })
      .locator(".v2-chip"),
  ).toHaveText(["Resolution: 1080p"]);
});

// --- Operation ------------------------------------------------------------

// D10: a card with more than five values shows five and More; More shows
// all eight and Less five again. The card grows below its content only:
// its place and width, every card above and every card beside it stay.
test("More shows every value and Less five", async ({ page }) => {
  await withMoreValues(page);
  for (const size of [desktop, phone]) {
    await test.step(label(size), async () => {
      await start(page, size);
      const card = distribution(page, "Codec / encoder");
      const rows = card.locator(".v2-dist-row");
      const more = card.getByRole("button", { name: "More", exact: true });
      await expect(rows).toHaveCount(5);
      await expect(more).toHaveAttribute("aria-expanded", "false");
      for (const other of ["Resolution", "Source", "Audio", "Language"])
        await expect(
          distribution(page, other).getByRole("button"),
          `${other} has no More`,
        ).toHaveCount(0);
      const parts = Object.keys(CARDS);
      const before = await boxesOf(page, parts);
      const codec = (await card.boundingBox())!;
      // A click scrolls its target into view; the boxes are read at the
      // top, with the pointer off the page (a KPI lifts under it).
      const top = async () => {
        await page.mouse.move(0, 0);
        await page.evaluate(() => window.scrollTo(0, 0));
      };
      await more.click();
      await expect(rows).toHaveCount(4 + MORE_CODECS.length);
      await top();
      const less = card.getByRole("button", { name: "Less", exact: true });
      await expect(less).toHaveAttribute("aria-expanded", "true");
      await expect(less).toBeFocused();
      const open = (await card.boundingBox())!;
      for (const edge of ["x", "y", "width"] as const)
        expectSame(open[edge], codec[edge], `the Codec card's ${edge}`);
      expect(open.height, "the Codec card grows").toBeGreaterThan(
        codec.height + 2 * 40,
      );
      const after = await boxesOf(page, parts);
      const moved = parts.filter((part) => {
        const [a, b] = [before[part]!, after[part]!];
        // Below the Codec card (a later grid row) only the place moves.
        const below = a.top >= codec.y + codec.height;
        return (below ? (["x", "width", "height"] as const) : ALL).some(
          (edge) =>
            part !== ".v2-dash-grid > :nth-child(2)" &&
            part !== ".v2-dash-grid" &&
            Math.abs(a[edge] - b[edge]) > 0.5,
        );
      });
      expect(
        moved.map((part) => [part, before[part], after[part]]),
        `moved by More at ${label(size)}`,
      ).toEqual([]);
      await less.click();
      await expect(rows).toHaveCount(5);
      await top();
      await expect(more).toBeFocused();
      expect(await boxesOf(page, parts), "Less").toEqual(before);
    });
  }
});

// D6: the scope tabs choose the distributions; the choice survives a
// reload (scopearr-dashboard-scope).
test("the scope is remembered", async ({ page }) => {
  await start(page, desktop);
  const resolution = distribution(page, "Resolution").locator(".v2-dist-sub");
  await expect(scopeTab(page, "Entire library")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(resolution).toHaveText("148 files");
  await scopeTab(page, "TV series").click();
  await expect(scopeTab(page, "TV series")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(resolution).toHaveText("122 files");
  await expect(page.locator(".v2-dash-grid")).toHaveAttribute(
    "id",
    "dashboard-scope-panel-sonarr",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("scopearr-dashboard-scope")),
  ).toBe("sonarr");
  await page.reload();
  await painted(page);
  await expect(scopeTab(page, "TV series")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(resolution).toHaveText("122 files");
  await scopeTab(page, "Movies").click();
  await expect(resolution).toHaveText("26 files");
});

// D12: the areas of the scope switch with Previous and Next (around the
// ends), each scope remembers its area through a reload
// (scopearr-storage-areas), and one area leaves both buttons disabled.
test("storage areas switch and are remembered", async ({ page }) => {
  await withStorageAreas(page, {
    all: [storageArea("movies", 9.3), storageArea("series", 3)],
    radarr: [storageArea("movies", 9.3)],
  });
  await start(page, desktop);
  const card = page.locator(storageCard);
  const area = card.locator(".v2-widget-sub");
  const ring = card.getByRole("img");
  const previous = card.getByRole("button", {
    name: "Previous storage area",
    exact: true,
  });
  const next = card.getByRole("button", {
    name: "Next storage area",
    exact: true,
  });
  await expect(card.getByRole("group", { name: "Storage area" })).toBeVisible();
  await expect(area).toHaveText("movies");
  await expect(ring).toHaveAccessibleName("9.3 TB used · 2.7 TB free");
  await expect(card.locator(".v2-ring-value")).toHaveText("77.5\u202f%");
  await next.click();
  await expect(area).toHaveText("series");
  await expect(ring).toHaveAccessibleName("3 TB used · 9 TB free");
  await next.click();
  await expect(area).toHaveText("movies");
  await previous.click();
  await expect(area).toHaveText("series");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("scopearr-storage-areas")),
    )
    .toBe(JSON.stringify({ all: "series" }));
  await page.reload();
  await painted(page);
  await expect(area).toHaveText("series");
  await scopeTab(page, "Movies").click();
  await expect(area).toHaveText("movies");
  await expect(previous).toBeDisabled();
  await expect(next).toBeDisabled();
  await scopeTab(page, "TV series").click();
  await expect(card.getByRole("group", { name: "Storage area" })).toHaveCount(
    0,
  );
  await expect(card.locator(".v2-ring-note")).toHaveText(
    "Select storage paths in Settings → Widgets.",
  );
  await scopeTab(page, "Entire library").click();
  await expect(area).toHaveText("series");
});

// D7: the distributions follow the order and visibility of the settings
// (Settings → Widgets) and storage shows only when visible; without any
// widget the note says so.
test("widgets follow the settings", async ({ page }) => {
  let widgets = {
    order: ["language", "storage", "audio", "resolution", "codec", "source"],
    visible: ["language", "codec", "audio"],
  };
  await page.route(/\/api\/settings$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const settings = await response.json();
    settings.widgets = { ...settings.widgets, ...widgets };
    await route.fulfill({ response, json: settings });
  });
  await start(page, desktop);
  await expect(page.locator(".v2-dash-grid h3")).toHaveText([
    "Language",
    "Audio",
    "Codec / encoder",
  ]);
  await expect(page.locator(".v2-dash-row > *")).toHaveCount(2);
  await expect(page.locator(storageCard)).toHaveCount(0);
  await expect(page.getByText("No dashboard widgets selected.")).toHaveCount(0);
  widgets = { ...widgets, visible: ["storage"] };
  await start(page, desktop);
  await expect(page.locator(".v2-dash-grid h3")).toHaveCount(0);
  await expect(page.locator(storageCard)).toHaveCount(1);
  await expect(page.getByText("No dashboard widgets selected.")).toHaveCount(0);
  widgets = { ...widgets, visible: [] };
  await start(page, desktop);
  await expect(page.locator(storageCard)).toHaveCount(0);
  await expect(
    page.getByText("No dashboard widgets selected.", { exact: true }),
  ).toBeVisible();
});
