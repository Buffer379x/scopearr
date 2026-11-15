// The libraries (Phase 5a, docs/STYLEGUIDE.md, Part 1, 10.5, 10.10, 11.1
// and 13): their geometry from the first paint on, the sticky header (V7),
// card rows (V15), row density (V6), the columns in four languages, and
// the filter drawer, track filters, presets, page tools, menus and the
// instance segment as a user drives them. Measured after network idle and
// loaded fonts; tolerance 0.5 px. Nothing here keeps a saved preset or
// setting: all tests share one demo database.
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ALL,
  answerDiscard,
  boxesOf,
  CPLUS_COLUMNS,
  currentHash,
  expectSame,
  expectSection,
  expectSteady,
  filterDrawer,
  firstPaintChanges,
  goTo,
  historyLength,
  inLanguage,
  LANGUAGES,
  leaveIsBlocked,
  libraryCard,
  mainNavigation,
  openRoute,
  pageOverflowX,
  PLACE,
  preferSidebar,
  quickSearch,
  recordBoxes,
  recordedBoxes,
  recordFirstPaint,
  rect,
  settingsSection,
  settle,
  smallTargets,
  sizeLabel as label,
  sizeOf,
  touchPage,
  withAudioTracks,
  withColumns,
  withCustomTags,
  withListPrefs,
  withRenameAvailable,
  withSeasonMode,
  withStatus,
  WIDTHS,
  withTwoMovieInstances,
  type Edge,
} from "./app";

type Size = { width: number; height: number };

const desktop = sizeOf(1440),
  wide = sizeOf(1600),
  phone = sizeOf(375);

// A fresh load (not a hash change of the same document) at `size`.
async function start(page: Page, size: Size, hash = "#/movies") {
  await page.setViewportSize(size);
  await page.goto("about:blank");
  await openRoute(page, hash);
  await loaded(page);
}

// The results are in: no placeholder row is left and the card is idle.
async function loaded(page: Page) {
  await expect(page.locator(".v2-row--placeholder")).toHaveCount(0);
  await expect(page.locator(".v2-table-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await settle(page);
}

// A hash change in the open page, as a link or the address bar makes it:
// a library entry with other filters, without a reload. The route may
// write the query back in its own encoding.
async function follow(page: Page, hash: string) {
  await page.evaluate((target) => {
    location.hash = target;
  }, hash);
  await expect
    .poll(async () => {
      const now = await currentHash(page);
      return [now.split("?")[0], params(now)];
    })
    .toEqual([hash.split("?")[0], params(hash)]);
  await loaded(page);
}

// The list requests the page waits for (not the drawer's live count with
// limit=1 or quick search's titles with limit=6) answer `ms` late.
async function delayLists(page: Page, ms: number) {
  await page.route(/\/api\/files\?/, async (route) => {
    const limit = new URL(route.request().url()).searchParams.get("limit");
    if (limit !== "1" && limit !== "6")
      await new Promise((done) => setTimeout(done, ms));
    await route.fallback();
  });
}

// The list requests are held until the returned function releases them.
async function holdLists(page: Page) {
  const held: (() => void)[] = [];
  let holding = true;
  await page.route(/\/api\/files\?/, async (route) => {
    const limit = new URL(route.request().url()).searchParams.get("limit");
    if (holding && limit !== "1" && limit !== "6")
      await new Promise<void>((resolve) => held.push(resolve));
    await route.fallback();
  });
  return {
    waiting: () => held.length,
    release() {
      holding = false;
      for (const go of held.splice(0)) go();
    },
  };
}

const filtersButton = (page: Page) =>
  page.getByRole("button", { name: "Filters", exact: true });
const chips = (page: Page) =>
  page.getByRole("group", { name: "Filters", exact: true }).locator(".v2-chip");
const applyButton = (drawer: Locator) =>
  drawer.getByRole("button", { name: /^Apply/ });
const row = (page: Page, title: string) =>
  page
    .getByRole("row")
    .filter({ has: page.getByRole("checkbox", { name: `Select ${title}` }) });

async function openDrawer(page: Page) {
  await filtersButton(page).click();
  const drawer = filterDrawer(page);
  await expect(drawer).toBeVisible();
  return drawer;
}

// A drawer field's value button, named by its label and the values it
// shows ("Resolution All").
const valueButton = (drawer: Locator, label: string) =>
  drawer.getByRole("button", { name: new RegExp(`^${label} `) });

// A drawer field's values, opened in place.
async function fieldValues(drawer: Locator, name: string) {
  const value = valueButton(drawer, name);
  if ((await value.getAttribute("aria-expanded")) !== "true")
    await value.click();
  const list = drawer.locator(`#${await value.getAttribute("aria-controls")}`);
  await expect(list).not.toHaveAttribute("aria-busy", "true");
  return list;
}

// The query of a hash as sorted key=value pairs.
const params = (hash: string) =>
  [...new URLSearchParams(hash.split("?")[1] ?? "")]
    .map(([key, value]) => `${key}=${value}`)
    .sort();

// --- Geometry and jumps -------------------------------------------------

// E3: no sheet; the first card starts at 146 (≤ 739: 172) right below the
// page header and overlaps the band; no width scrolls sideways, also with
// a stored expanded sidebar at 820 and 740 (E21, the library part).
test("the library card starts on the band", async ({ page }) => {
  test.setTimeout(240_000);
  const check = async (size: Size, where: string) => {
    const top = size.width <= 739 ? 172 : 146;
    const band = await rect(page, ".v2-band");
    const card = (await libraryCard(page).boundingBox())!;
    await expect(page.locator("main.v2-main")).not.toHaveAttribute(
      "data-sheet",
    );
    expect(
      await page.evaluate(
        () =>
          document.querySelector(".v2-list-page")?.firstElementChild?.className,
      ),
      `${where}: the card is the page's first block`,
    ).toContain("v2-table-card");
    expectSame(card.y, top, `${where}, card top`);
    expectSame(
      (await rect(page, ".v2-page-head")).bottom,
      card.y,
      `${where}, page header bottom`,
    );
    expect(card.y, `${where}: the card overlaps the band`).toBeLessThan(
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
      await check(size, `movies at ${label(size)}`);
      await goTo(page, "series");
      await check(size, `series at ${label(size)}`);
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
      await check(size, `movies at ${label(size)} (expanded)`);
      await goTo(page, "series");
      await check(size, `series at ${label(size)} (expanded)`);
    });
  }
});

// What stays from the first paint on (the frame through recordFirstPaint):
// band, page header, card, its head, title, filter bar, chips row, tools,
// table header and the first row's place. The movie placeholders are as
// many as the files (26 < page size), so the first row, the card and its
// footer keep their height too, also as cards at 375. TV series learn
// their group rows only with the results: below the table body the card
// grows (a known limit), nothing above it moves.
const ABOVE: Record<string, Edge[]> = {
  ".v2-band": ALL,
  ".v2-page-head": ALL,
  "main h1": ALL,
  ".v2-table-card": PLACE,
  ".v2-tc-head": ALL,
  ".v2-tc-title": ALL,
  ".v2-filter-bar": ALL,
  ".v2-chips-row": ALL,
  ".v2-tc-tools": ALL,
  ".v2-table > thead": ALL,
  ".v2-table > tbody > tr:first-child": PLACE,
};
// The movies' own heights, of a card without the TV series' group rows
// (the frames before a switch from TV series still show those).
const MOVIE_CARD = ".v2-table-card:not(:has(.v2-row--series))";
const MOVIES: Record<string, Edge[]> = {
  ...ABOVE,
  [MOVIE_CARD]: ALL,
  [`${MOVIE_CARD} .v2-table > tbody > tr:first-child`]: ALL,
  [`${MOVIE_CARD} .v2-tc-foot`]: ALL,
};

test("the library does not move after its first paint", async ({ page }) => {
  test.setTimeout(300_000);
  await recordFirstPaint(page);
  await recordBoxes(page, Object.keys(MOVIES));
  await delayLists(page, 300);
  // Every frame width (final review T9-M2), then a stored expanded sidebar
  // at 820 and 740 (it stays stored for the later loads).
  const sizes: [Size, boolean][] = [
    [desktop, false],
    [sizeOf(1119), false],
    [sizeOf(820), false],
    [sizeOf(740), false],
    [phone, false],
    [sizeOf(820), true],
    [sizeOf(740), true],
  ];
  let stored = false;
  for (const [size, expanded] of sizes) {
    const where = label(size) + (expanded ? " with an expanded sidebar" : "");
    await test.step(where, async () => {
      if (expanded && !stored) {
        await preferSidebar(page, "expanded");
        stored = true;
      }
      await page.setViewportSize(size);
      await page.goto("about:blank");
      await openRoute(page, "#/movies");
      await loaded(page);
      await expect(page.locator("#v2-sidebar")).toHaveAttribute(
        "data-mode",
        expanded ? "expanded" : size.width <= 739 ? "drawer" : "rail",
      );
      const frame = await firstPaintChanges(page);
      expect(frame.first, `the frame at ${where}`).toEqual([]);
      expect(frame.frames, `the frame at ${where}`).toEqual([]);
      // Where the default columns overflow the card (820 and 740 beside
      // the rail), the table's columns follow their content, so it widens
      // once when the results replace the placeholder rows (a ruled known
      // limit); its place and everything above it stay. Only those two
      // widths may overflow (final re-review N3).
      const overflow =
        (await page
          .locator(".v2-table-scroll")
          .getAttribute("data-overflow")) !== null;
      const ruled = size.width === 820 || size.width === 740;
      if (!ruled)
        expect(overflow, `the table overflows at ${where}`).toBe(false);
      const placed = (parts: Record<string, Edge[]>) =>
        ruled && overflow
          ? Object.fromEntries(
              Object.entries(parts).map(([query, edges]) => [
                query,
                query.includes(".v2-table >")
                  ? edges.filter((edge) => edge !== "width")
                  : edges,
              ]),
            )
          : parts;
      if (overflow)
        test.info().annotations.push({
          type: "table overflows",
          description: where,
        });
      await expectSteady(page, placed(MOVIES), `movies at ${where}`);
      await goTo(page, "series");
      await loaded(page);
      await expectSteady(page, placed(ABOVE), `movies → series at ${where}`);
      await goTo(page, "movies");
      await loaded(page);
      await expectSteady(page, placed(MOVIES), `series → movies at ${where}`);
    });
  }
});

// The tools of the chips row by place, so a tool that moves inside a
// steady group is caught too.
const TOOLS = Array.from(
  { length: 10 },
  // The live region of a mux run is no tool.
  (_, i) => `.v2-tc-tools > :nth-child(${i + 1} of :not([aria-live]))`,
);
// The result count grows to its right only (its spinner place follows it,
// hidden unless busy, so nothing visible moves); the spinner never moves
// while it shows.
const BUSY = ".v2-tc-title .v2-tc-busy--on";
const HEAD: Record<string, Edge[]> = {
  ".v2-tc-title": ALL,
  ".v2-tc-title > .v2-count": ["x", "y", "height"],
  ".v2-filter-bar > .v2-btn": ALL,
  ".v2-chips-row": ALL,
  ".v2-tc-tools": ALL,
  ".v2-table > thead": ALL,
  ...Object.fromEntries(TOOLS.map((query) => [query, ALL])),
};
// Nine and ten simple filters (the Filters count goes to two digits).
const NINE =
  "resolution=2160p&codec=x265&source=UHD&processing=Remux&family=H.265%2FHEVC&bitDepth=10&hdr=HDR10&audio=DTS&channels=5.1";
const TEN = NINE + "&language=Englisch";

test("busy and counts never move the card", async ({ page }) => {
  test.setTimeout(120_000);
  await recordBoxes(page, [...Object.keys(HEAD), BUSY]);
  for (const size of [desktop, phone]) {
    await test.step(label(size), async () => {
      await start(page, size);
      await recordedBoxes(page);
      const base = await boxesOf(page, Object.keys(HEAD));
      const where = (what: string) => `${what} at ${label(size)}`;
      // Selection 0 → 12, without scrolling to the boxes.
      const boxes = page.locator("tbody .v2-table-sel input");
      for (let i = 0; i < 12; i++)
        await boxes.nth(i).evaluate((box: HTMLInputElement) => box.click());
      await expect(
        page.getByRole("button", { name: "Set tag 12", exact: true }),
      ).toBeVisible();
      await expectSteady(page, HEAD, where("selection 0 → 12"), base);
      // Filters 0 → 9 → 10 (deep links; a library entry clears the
      // selection).
      await follow(page, "#/movies?" + NINE);
      await expect(chips(page)).toHaveCount(9);
      await expect(filtersButton(page).locator(".v2-count")).toHaveText("9");
      await expectSteady(page, HEAD, where("filters 0 → 9"), base);
      await follow(page, "#/movies?" + TEN);
      await expect(chips(page)).toHaveCount(10);
      await expect(filtersButton(page).locator(".v2-count")).toHaveText("10");
      await expectSteady(page, HEAD, where("filters 9 → 10"), base);
      // Busy on and off, the count 0 → 26.
      const lists = await holdLists(page);
      await page.evaluate(() => {
        location.hash = "#/movies";
      });
      await expect.poll(lists.waiting).toBeGreaterThan(0);
      await expect(page.locator(".v2-tc-busy")).toHaveClass(/v2-tc-busy--on/);
      const spinner = (await page.locator(BUSY).boundingBox())!;
      const shown = (await expectSteady(page, HEAD, where("busy"), base))[BUSY];
      lists.release();
      await loaded(page);
      await expect(page.locator(".v2-tc-busy")).not.toHaveClass(
        /v2-tc-busy--on/,
      );
      shown.push(
        ...(await expectSteady(page, HEAD, where("busy → idle"), base))[BUSY],
      );
      expect(shown.length, where("frames with the spinner")).toBeGreaterThan(0);
      expect(
        shown.filter((box) => box.x !== spinner.x || box.y !== spinner.y),
        where("the shown spinner"),
      ).toEqual([]);
      await page.unrouteAll({ behavior: "wait" });
    });
  }
});

// 20 chips: four resolutions, codecs and sources, three HDR and audio
// values and two languages.
const TWENTY = [
  ...["2160p", "1080p", "720p", "__unknown__"].map((v) => `resolution=${v}`),
  ...["x265", "x264", "HEVC", "__unknown__"].map((v) => `codec=${v}`),
  ...["UHD", "BluRay", "DVD", "__unknown__"].map((v) => `source=${v}`),
  ...["HDR10", "Dolby%20Vision", "__unknown__"].map((v) => `hdr=${v}`),
  ...["DTS", "AC-3", "__unknown__"].map((v) => `audio=${v}`),
  ...["Deutsch", "Englisch"].map((v) => `language=${v}`),
].join("&");

test("the chips row keeps its height", async ({ page }) => {
  test.setTimeout(120_000);
  for (const size of [desktop, sizeOf(820), phone]) {
    await test.step(label(size), async () => {
      await start(page, size);
      // The table header's width follows the rows of a table that is
      // wider than its card (820); its place does not.
      const edges: Record<string, Edge[]> = {
        ".v2-chips-row": ALL,
        ".v2-table > thead": ["x", "y", "height"],
      };
      const base = await boxesOf(page, Object.keys(edges));
      for (const [count, query] of [
        [1, "resolution=2160p"],
        [20, TWENTY],
        [0, ""],
      ] as const) {
        await follow(page, "#/movies" + (query ? "?" + query : ""));
        await expect(chips(page)).toHaveCount(count);
        const now = await boxesOf(page, Object.keys(edges));
        for (const query of Object.keys(now))
          for (const edge of edges[query])
            expectSame(
              now[query]![edge],
              base[query]![edge],
              `${query} ${edge} with ${count} chips at ${label(size)}`,
            );
      }
    });
  }
});

// L19: the season hint hangs below the title (≤ 760 on a line of its own,
// always reserved), so it never moves the card head.
test("the season hint never moves the card head", async ({ page }) => {
  await withSeasonMode(page, "season");
  const parts: Record<string, Edge[]> = {
    ".v2-tc-head": ALL,
    ".v2-tc-heading": ALL,
    ".v2-tc-title": ALL,
    ".v2-filter-bar": ALL,
    ".v2-chips-row": ALL,
    ".v2-table > thead": ALL,
  };
  await recordBoxes(page, Object.keys(parts));
  const hint = page.locator(".v2-tc-hint");
  for (const size of [desktop, phone]) {
    await test.step(label(size), async () => {
      await start(page, size, "#/series");
      await expect(hint).toBeEmpty();
      await recordedBoxes(page);
      const base = await boxesOf(page, Object.keys(parts));
      const year = page.getByRole("button", {
        name: "Sort by Year",
        exact: true,
      });
      await year.click();
      await loaded(page);
      await expect(hint).toHaveText(
        "Season context is hidden while sorting by another column. Choose the default title order to show season groups again.",
      );
      await expect(hint).toBeVisible();
      await expectSteady(page, parts, `hint on at ${label(size)}`, base);
      await year.click();
      await loaded(page);
      await year.click();
      await loaded(page);
      await expect(hint).toBeEmpty();
      await expectSteady(page, parts, `hint off at ${label(size)}`, base);
    });
  }
});

// Replaces the library part of "expanded filters cover at most 60% …":
// the drawer is a modal layer, so opening and closing it (Escape, Close,
// Apply) moves nothing of the page, at its top and scrolled (no scroll
// lock). It stands at the right edge, on phones over the whole screen.
test("the filter drawer leaves the table in place", async ({ page }) => {
  const parts: Record<string, Edge[]> = {
    ".v2-band": ALL,
    ".v2-page-head": ALL,
    ".v2-table-card": ALL,
    ".v2-tc-head": ALL,
    ".v2-table > thead": ALL,
    ".v2-table > tbody > tr:first-child": ALL,
    ".v2-tc-foot": ALL,
  };
  await recordBoxes(page, Object.keys(parts));
  for (const size of [desktop, phone]) {
    await test.step(label(size), async () => {
      await start(page, size);
      // Scrolled so far that Filters is still below the topbar.
      for (const scroll of [0, 100]) {
        await page.evaluate((y) => window.scrollTo(0, y), scroll);
        await expect
          .poll(() => page.evaluate(() => window.scrollY))
          .toBe(scroll);
        await recordedBoxes(page);
        const base = await boxesOf(page, Object.keys(parts));
        for (const close of ["Escape", "Close", "Apply"] as const) {
          const where = `${close} at ${label(size)}, scrolled ${scroll}`;
          const drawer = await openDrawer(page);
          await expect(applyButton(drawer)).toHaveText(/\(26 matches\)/);
          const box = (await drawer.boundingBox())!;
          if (size.width <= 739)
            expect(box, `${where}: the drawer fills the screen`).toEqual({
              x: 0,
              y: 0,
              width: size.width,
              height: size.height,
            });
          else
            expect(
              size.width - (box.x + box.width),
              `${where}: the drawer stands at the right`,
            ).toBeLessThan(24);
          if (close === "Escape") await page.keyboard.press("Escape");
          else if (close === "Close")
            await drawer
              .getByRole("button", { name: "Close", exact: true })
              .click();
          else await applyButton(drawer).click();
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
});

// The library part of "mobile result headings share one height": the
// card heads of movies and TV series on phones.
test("mobile result headings share one height", async ({ page }) => {
  for (const size of [phone, sizeOf(320)]) {
    await test.step(label(size), async () => {
      await start(page, size);
      const movies = await boxesOf(page, [".v2-tc-head", ".v2-chips-row"]);
      await goTo(page, "series");
      await loaded(page);
      const series = await boxesOf(page, [".v2-tc-head", ".v2-chips-row"]);
      for (const query of Object.keys(movies))
        for (const edge of ALL)
          expectSame(
            series[query]![edge],
            movies[query]![edge],
            `${query} ${edge}, series vs movies at ${label(size)}`,
          );
    });
  }
});

// --- V7 sticky header, V15 card rows, V6 density ------------------------

// The header cells and where they are.
const headTops = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".v2-table > thead th")].map(
      (th) => th.getBoundingClientRect().top,
    ),
  );

// R-B: while the table fits its card, the region is no scroll container
// and the header sticks right under the topbar (60) when the page scrolls,
// also under the card's container-type; the region is then no focusable
// region (ruling P11/M1).
test("the table header sticks under the topbar while the table fits", async ({
  page,
}) => {
  for (const [size, view] of [
    [desktop, "movies"],
    [desktop, "series"],
    [wide, "movies"],
  ] as const) {
    await test.step(`${view} at ${label(size)}`, async () => {
      await start(page, size, "#/" + view);
      const region = page.locator(".v2-table-scroll");
      await expect(region).not.toHaveAttribute("data-overflow");
      await expect(region).not.toHaveAttribute("tabindex");
      await expect(region).not.toHaveAttribute("role");
      expect(
        await page.evaluate(
          () =>
            getComputedStyle(document.querySelector(".v2-table-card")!)
              .containerType,
        ),
      ).toBe("inline-size");
      await page.evaluate(() => window.scrollTo(0, 600));
      await expect(page.locator(".v2-topbar")).toHaveAttribute(
        "data-scrolled",
        "",
      );
      const topbar = await rect(page, ".v2-topbar");
      expectSame(topbar.bottom, 60, "topbar bottom");
      for (const top of await headTops(page))
        expectSame(top, 60, `header cell top, ${view} at ${label(size)}`);
      // The header is on top: the point below the topbar is a header cell.
      expect(
        await page.evaluate(() => {
          const th = document.querySelector(".v2-table > thead th")!;
          const box = th.getBoundingClientRect();
          return !!document
            .elementFromPoint(box.left + 4, box.top + box.height / 2)
            ?.closest("thead");
        }),
        "the stuck header covers the rows",
      ).toBe(true);
    });
  }
});

// R-B: with a stored expanded sidebar and all columns the table is wider
// than its card: the region scrolls sideways as a named, focusable region,
// the header scrolls away with the page, and the page itself does not
// scroll sideways. Back in the default view it fits again.
test("a wider table scrolls inside its card and its header does not stick", async ({
  page,
}) => {
  await preferSidebar(page, "expanded");
  await start(page, desktop);
  await expect(page.locator("#v2-sidebar")).toHaveAttribute(
    "data-mode",
    "expanded",
  );
  const region = page.locator(".v2-table-scroll");
  await page.getByRole("button", { name: "All columns", exact: true }).click();
  await expect(region).toHaveAttribute("data-overflow", "");
  await expect(
    page.getByRole("region", { name: "Your movies", exact: true }),
  ).toHaveAttribute("tabindex", "0");
  expect(
    await pageOverflowX(page),
    "the page scrolls sideways",
  ).toBeLessThanOrEqual(0);
  const scroll = await region.evaluate((element) => ({
    scroll: element.scrollWidth,
    client: element.clientWidth,
  }));
  expect(scroll.scroll).toBeGreaterThan(scroll.client);
  const [top] = await headTops(page);
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(page.locator(".v2-topbar")).toHaveAttribute("data-scrolled", "");
  for (const cell of await headTops(page))
    expectSame(cell, top - 600, "header cell top after a 600px scroll");
  await region.evaluate((element) => element.scrollTo({ left: 200 }));
  expect(await region.evaluate((element) => element.scrollLeft)).toBe(200);
  expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "Default view", exact: true }).click();
  await expect(region).not.toHaveAttribute("data-overflow");
  await expect(region).not.toHaveAttribute("role");
  await expect(region).not.toHaveAttribute("tabindex");
});

// V15: on a phone each row is a card under a sort bar. Every visible
// column stays in every row (rows and cells by their roles), the sort bar
// names every column and scrolls sideways inside the card, and a sort
// changes the route. The explicit roles keep the table the same for
// assistive technology as at 1440 (TV series with their group rows).
test("narrow cards keep every visible column and sorting", async ({ page }) => {
  await start(page, phone);
  const table = page.getByRole("table");
  const head = table.getByRole("rowgroup").first();
  const body = table.getByRole("rowgroup").nth(1);
  const columns = [
    "Info",
    "Title",
    "Year",
    "Resolution",
    "Codec",
    "Source",
    "Processing",
    "Custom",
  ];
  await expect(head.getByRole("columnheader")).toHaveCount(columns.length + 1);
  for (const name of columns)
    await expect(
      head.getByRole("button", { name: `Sort by ${name}`, exact: true }),
    ).toHaveCount(1);
  await expect(body.getByRole("row")).toHaveCount(26);
  for (const cells of await body
    .getByRole("row")
    .evaluateAll((rows) =>
      rows.map((row) => row.querySelectorAll(":scope > [role=cell]").length),
    ))
    expect(cells, "cells per card row").toBe(columns.length + 1);
  const bar = page.locator(".v2-table > thead");
  expect(
    await bar.evaluate((element) => element.scrollWidth > element.clientWidth),
    "the sort bar scrolls sideways",
  ).toBe(true);
  expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
  const year = head.getByRole("button", { name: "Sort by Year", exact: true });
  await year.click();
  await expect.poll(() => currentHash(page)).toBe("#/movies?sort=year&dir=asc");
  await expect(
    head.getByRole("columnheader").filter({
      has: page.getByRole("button", { name: "Sort by Year", exact: true }),
    }),
  ).toHaveAttribute("aria-sort", "ascending");
  await loaded(page);
  expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);

  await goTo(page, "series");
  await loaded(page);
  const narrow = await page.getByRole("table").ariaSnapshot();
  await page.setViewportSize(desktop);
  await expect(page.locator(".v2-table > tbody > tr").first()).toHaveCSS(
    "display",
    "table-row",
  );
  expect(
    await page.getByRole("table").ariaSnapshot(),
    "TV series at 375 and 1440 for assistive technology",
  ).toBe(narrow);
});

// V6 and M10: comfortable rows are 48, compact 40, and both 56 on a touch
// screen; the group rows of TV series keep their own heights.
test("compact rows are 40, comfortable 48 and touch rows 56", async ({
  page,
  browser,
}) => {
  const heights = (target: Page, query: string) =>
    target.evaluate(
      (q) => [
        ...new Set(
          [...document.querySelectorAll(q)].map(
            (row) => row.getBoundingClientRect().height,
          ),
        ),
      ],
      query,
    );
  const check = async (target: Page, where: string, file: number) => {
    await expect(target.locator(".v2-row").first()).toBeVisible();
    expect(await heights(target, ".v2-table > tbody > .v2-row"), where).toEqual(
      [file],
    );
    expect(await heights(target, ".v2-table > thead > tr"), where).toEqual([
      file === 56 ? 44 : 38,
    ]);
  };
  await start(page, desktop);
  await expect(libraryCard(page)).toHaveAttribute(
    "data-density",
    "comfortable",
  );
  await check(page, "comfortable", 48);
  await withListPrefs(page, { density: "compact" });
  await start(page, desktop);
  await expect(libraryCard(page)).toHaveAttribute("data-density", "compact");
  await check(page, "compact", 40);
  await start(page, desktop, "#/series");
  await check(page, "compact series", 40);
  expect(await heights(page, ".v2-row--series"), "series rows").toEqual([42]);
  expect(await heights(page, ".v2-row--season"), "season rows").toEqual([34]);

  for (const density of ["comfortable", "compact"] as const) {
    await test.step(`${density} on a touch screen`, async () => {
      const touch = await touchPage(browser, { width: 1024, height: 768 });
      if (density === "compact") await withListPrefs(touch, { density });
      await openRoute(touch, "#/movies");
      await loaded(touch);
      expect(
        await touch.evaluate(() => matchMedia("(pointer: coarse)").matches),
      ).toBe(true);
      await expect(libraryCard(touch)).toHaveAttribute("data-density", density);
      await check(touch, `${density} on touch`, 56);
      await touch.context().close();
    });
  }
});

// E13, ruling R-C: Display drafts the row density (General) and stacked
// audio tracks (Lists & columns) like the interface language: leaving asks
// once, Discard keeps the stored values, and Save stores both in this
// browser only (the settings sent to the server hold neither; its PUT
// rejects unknown fields). The settings it saves are the ones loaded, so
// the shared demo database keeps nothing new; the PUT still runs the
// server's save path (it invalidates the cached aggregates and queues media
// tags, final review T12-2), which changes no stored value. The library follows: compact
// rows are 40 and every track has a line of its own, and nothing but the
// rows moves.
test("a saved density reaches the library", async ({ page }) => {
  test.setTimeout(120_000);
  const stored = () =>
    page.evaluate(() => [
      localStorage.getItem("scopearr-density"),
      localStorage.getItem("scopearr-tracks-stacked"),
    ]);
  const rowHeights = () =>
    page.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll(".v2-table > tbody > .v2-row")].map(
          (row) => row.getBoundingClientRect().height,
        ),
      ),
    ]);
  const displayTab = (name: string) =>
    page
      .getByRole("tablist", { name: "Display sections" })
      .getByRole("tab", { name: new RegExp(`^${name}`) });
  const density = page.getByRole("combobox", {
    name: "Row density",
    exact: true,
  });
  const stacked = page.getByRole("checkbox", {
    name: "Show audio tracks stacked",
    exact: true,
  });
  const save = page.getByRole("button", { name: "Save settings", exact: true });
  const discard = page.getByRole("dialog", { name: "Really cancel?" });
  const link = (name: string) =>
    mainNavigation(page).getByRole("link", { name, exact: true });
  const openDisplay = async () => {
    await goTo(page, "settings");
    await settingsSection(page, "Display");
  };

  await withAudioTracks(page);
  await start(page, desktop);
  await expect(libraryCard(page)).toHaveAttribute(
    "data-density",
    "comfortable",
  );
  expect(await rowHeights(), "comfortable rows").toEqual([48]);
  const base = await boxesOf(page, Object.keys(ABOVE));
  expect(await stored()).toEqual([null, null]);

  // General: the density is a draft. Leaving asks once; Cancel keeps it.
  await openDisplay();
  await expect(density).toHaveValue("comfortable");
  await density.selectOption("compact");
  await expect(
    displayTab("General").locator(".v2-seg-dirty[data-on]"),
  ).toHaveCount(1);
  await expect(save).toBeEnabled();
  await expect.poll(() => leaveIsBlocked(page)).toBe(true);
  await link("Movies").click();
  await answerDiscard(page, "Cancel");
  await expect(discard).toHaveCount(0);
  await expectSection(page, "Display");
  await expect(density).toHaveValue("compact");
  expect(await stored(), "a draft stores nothing").toEqual([null, null]);

  // Lists & columns: stacked tracks, a draft as well.
  await displayTab("Lists & columns").click();
  await expect(stacked).not.toBeChecked();
  await stacked.check();
  await expect(
    displayTab("Lists & columns").locator(".v2-seg-dirty[data-on]"),
  ).toHaveCount(1);
  expect(await stored(), "a draft stores nothing").toEqual([null, null]);

  const put = page.waitForRequest(
    (request) =>
      request.method() === "PUT" &&
      new URL(request.url()).pathname === "/api/settings",
  );
  await save.click();
  const request = await put;
  expect((await request.response())?.status(), "settings saved").toBe(200);
  const body = request.postData() ?? "";
  for (const word of [
    "density",
    "stacked",
    "scopearr-density",
    "scopearr-tracks-stacked",
  ])
    expect(body, `the settings sent hold "${word}"`).not.toContain(word);
  await expect.poll(stored).toEqual(["compact", "true"]);
  await expect(save).toBeDisabled();
  await expect(page.locator(".v2-seg-dirty[data-on]")).toHaveCount(0);
  await expect.poll(() => leaveIsBlocked(page)).toBe(false);

  await goTo(page, "movies");
  await loaded(page);
  await expect(libraryCard(page)).toHaveAttribute("data-density", "compact");
  expect(await rowHeights(), "compact rows").toEqual([40]);
  const now = await boxesOf(page, Object.keys(ABOVE));
  for (const [query, edges] of Object.entries(ABOVE)) {
    expect(now[query], query).toBeTruthy();
    for (const edge of edges)
      expectSame(now[query]![edge], base[query]![edge], `${query} ${edge}`);
  }

  await follow(page, "#/movies?q=Arrival");
  await page.getByRole("button", { name: "All columns", exact: true }).click();
  const arrival = row(page, "Arrival");
  await expect(arrival.locator(".v2-trk-stack > button.v2-trk")).toHaveCount(4);
  await expect(arrival.locator(".v2-trk--more")).toHaveCount(0);

  // A discarded draft leaves the stored values. Display opens on the tab
  // chosen last (Lists & columns).
  await openDisplay();
  await expect(stacked).toBeChecked();
  await displayTab("General").click();
  await expect(density).toHaveValue("compact");
  await density.selectOption("comfortable");
  await link("Dashboard").click();
  await answerDiscard(page, "Discard changes");
  await expect(
    page.getByRole("heading", { level: 1, name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(discard).toHaveCount(0);
  expect(await stored(), "discarded").toEqual(["compact", "true"]);
  await openDisplay();
  await expect(density).toHaveValue("compact");
  await expect(save).toBeDisabled();
});

// --- Languages ----------------------------------------------------------

const fits = (page: Page) =>
  page.evaluate(() => {
    const region = document.querySelector(".v2-table-scroll")!;
    return {
      overflow: region.hasAttribute("data-overflow"),
      scroll: region.scrollWidth,
      client: region.clientWidth,
    };
  });

// The default columns of 1.7.0 fit the card at 1440 with the rail in all
// four languages: the header sticks there (V7).
test("default columns fit at 1440 in four languages", async ({ page }) => {
  test.setTimeout(120_000);
  for (const language of LANGUAGES) {
    await test.step(language, async () => {
      await inLanguage(page, language);
      for (const view of ["movies", "series"]) {
        await start(page, desktop, "#/" + view);
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        const fit = await fits(page);
        expect(fit.overflow, `${view} in ${language}`).toBe(false);
        expect(fit.scroll, `${view} in ${language}`).toBeLessThanOrEqual(
          fit.client,
        );
      }
    });
  }
});

// The C+ column set (STYLEGUIDE 3, CPLUS_COLUMNS), through the settings
// the app loads, fits at 1440 with the rail in all four languages.
test("the C+ column set fits at 1440", async ({ page }) => {
  test.setTimeout(120_000);
  await withColumns(page, CPLUS_COLUMNS);
  for (const language of LANGUAGES) {
    await test.step(language, async () => {
      await inLanguage(page, language);
      for (const view of ["movies", "series"]) {
        await start(page, desktop, "#/" + view);
        await expect(page.locator(".v2-table > thead th")).toHaveCount(11);
        const fit = await fits(page);
        expect(fit.overflow, `${view} in ${language}`).toBe(false);
        expect(fit.scroll, `${view} in ${language}`).toBeLessThanOrEqual(
          fit.client,
        );
      }
    });
  }
});

// Task 8: the count slots hold the page size, so selecting a whole page
// (26 movies, 100 episodes) moves no tool at card widths 1061 to 1300 in
// any language, below 1080 without their labels; nothing sticks out.
test("the page tools keep their place in four languages", async ({ page }) => {
  test.setTimeout(240_000);
  const tools = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".v2-tc-tools > *")].map((element) =>
        element.getBoundingClientRect().toJSON(),
      ),
    );
  for (const language of LANGUAGES) {
    await test.step(language, async () => {
      await inLanguage(page, language);
      for (const view of ["movies", "series"]) {
        await start(page, sizeOf(1420), "#/" + view);
        for (const width of [1181, 1200, 1300, 1420]) {
          await page.setViewportSize({ width, height: 900 });
          const card = await rect(page, ".v2-table-card");
          const where = `${view} in ${language}, card ${card.width}`;
          // Below 1060 the labels are visually hidden (1 × 1, clipped) and
          // stay in the tools' names.
          await expect
            .poll(
              () =>
                page
                  .locator(".v2-tc-label")
                  .first()
                  .evaluate((label) => label.getBoundingClientRect().width > 1),
              { message: `${where}: labels shown` },
            )
            .toBe(card.width >= 1080);
          const before = await tools();
          // "Select this page", "Set tag" in the language shown.
          const all = page.locator(".v2-table > thead .v2-table-sel input");
          await all.check();
          await expect(
            page.locator(".v2-tc-tools > :nth-child(3) .v2-count-num"),
          ).toHaveText(view === "movies" ? "26" : "100");
          expect(await tools(), `${where}: selected`).toEqual(before);
          await all.uncheck();
          const last = before[before.length - 1];
          expect(last.right, `${where}: the last tool`).toBeLessThanOrEqual(
            card.right,
          );
          expect(await pageOverflowX(page), where).toBeLessThanOrEqual(0);
        }
      }
    });
  }
});

// L21 and Task 8: a mux run counts in the running tool's slot; no tool
// moves in any animation frame of it, in each of the four languages (final
// review T9-M3; the tools and the confirmation are found by their place).
// The mux requests are answered here.
test("a mux run moves no page tool", async ({ page }) => {
  test.setTimeout(180_000);
  const parts = Object.fromEntries(
    [".v2-tc-tools", ...TOOLS].map((query) => [query, ALL]),
  );
  await recordBoxes(page, Object.keys(parts));
  await withStatus(page, (status) => {
    const shown = status as { mux?: Record<string, unknown> };
    shown.mux = { ...shown.mux, enabled: true, installed: true };
  });
  const held: { fulfill(options: { json: unknown }): Promise<void> }[] = [];
  await page.route(/\/api\/mux\/jobs$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    held.push(route);
  });
  for (const language of LANGUAGES) {
    await test.step(language, async () => {
      await inLanguage(page, language);
      held.length = 0;
      await start(page, desktop);
      const boxes = page.locator(".v2-table > tbody .v2-table-sel input");
      for (let i = 0; i < 3; i++) await boxes.nth(i).check();
      const mark = page.locator(TOOLS[0]);
      await expect(mark.locator(".v2-count-num")).toHaveText("3");
      await recordedBoxes(page);
      const base = await boxesOf(page, Object.keys(parts));
      await mark.click();
      await page
        .getByRole("dialog")
        .locator(".v2-modal-foot > button")
        .last()
        .click();
      for (let done = 1; done <= 3; done++) {
        await expect.poll(() => held.length).toBe(done);
        await expect(mark.locator(".v2-count-num")).toHaveText(
          String(done - 1),
        );
        if (language === "en")
          await expect(mark).toHaveAttribute(
            "title",
            new RegExp(`^Marking … ${done - 1}/3 · `),
          );
        await expectSteady(
          page,
          parts,
          `marking ${done - 1}/3 in ${language}`,
          base,
        );
        await held[done - 1].fulfill({ json: {} });
      }
      await expect(page.locator(".v2-toast").first()).toBeVisible();
      if (language === "en")
        await expect(
          page.getByText("3 items marked for muxing."),
        ).toBeVisible();
      await expectSteady(page, parts, `after the run in ${language}`, base);
    });
  }
});

// V14 (Task 11): the toast of a marking offers Open Muxing, an in-app link
// to the Muxing page (no reload; Back returns to the library) that closes
// the toast. Nothing is written: the marking request is answered here.
test("marking for muxing offers a link to Muxing", async ({ page }) => {
  await withStatus(page, (status) => {
    const shown = status as { mux?: Record<string, unknown> };
    shown.mux = { ...shown.mux, enabled: true, installed: true };
  });
  const marked: unknown[] = [];
  await page.route(/\/api\/mux\/jobs$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    marked.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });
  await start(page, desktop);
  await page.evaluate(() => {
    (window as { e2eSameDocument?: boolean }).e2eSameDocument = true;
  });
  await page.locator(".v2-table > tbody .v2-table-sel input").first().check();
  await page.locator(TOOLS[0]).click();
  const toast = page
    .locator(".v2-toast")
    .filter({ hasText: "Marked for muxing." });
  await expect(toast).toBeVisible();
  expect(marked).toHaveLength(1);
  const open = toast.getByRole("button", { name: "Open Muxing", exact: true });
  await expect(open).toHaveClass("v2-text-btn");
  await open.click();
  await expect.poll(() => currentHash(page)).toBe("#/tools/mux");
  await expect(
    page.getByRole("heading", { level: 1, name: "Muxing", exact: true }),
  ).toBeVisible();
  await expect(toast).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as { e2eSameDocument?: boolean }).e2eSameDocument,
    ),
  ).toBe(true);
  await page.goBack();
  await expect.poll(() => currentHash(page)).toBe("#/movies");
  await loaded(page);
  expect(
    await page.evaluate(
      () => (window as { e2eSameDocument?: boolean }).e2eSameDocument,
    ),
  ).toBe(true);
});

// Task 11 review (fix wave): at 320 in four languages the toast's Open
// Muxing stays inside its toast (one line, or wrapped inside it, never
// cut or overflowing), and from the keyboard it shows the v2 focus ring.
test("the Open Muxing link fits its toast at 320 and shows the focus ring", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await withStatus(page, (status) => {
    const shown = status as { mux?: Record<string, unknown> };
    shown.mux = { ...shown.mux, enabled: true, installed: true };
  });
  await page.route(/\/api\/mux\/jobs$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ json: {} });
  });
  for (const language of LANGUAGES) {
    await test.step(language, async () => {
      await inLanguage(page, language);
      await start(page, sizeOf(320));
      await page
        .locator(".v2-table > tbody .v2-table-sel input")
        .first()
        .check();
      await page.locator(TOOLS[0]).click();
      const toast = page
        .locator(".v2-toast")
        .filter({ has: page.locator(".v2-text-btn") });
      await expect(toast).toBeVisible();
      const link = toast.locator(".v2-text-btn");
      const fit = await link.evaluate((button) => {
        const box = button.getBoundingClientRect();
        const toast = button.closest(".v2-toast")!.getBoundingClientRect();
        return {
          left: box.left - toast.left,
          right: toast.right - box.right,
          scroll: button.scrollWidth,
          client: button.clientWidth,
          viewport: document.documentElement.clientWidth - toast.right,
        };
      });
      const where = `Open Muxing in ${language} at 320`;
      expect(fit.left, where).toBeGreaterThanOrEqual(0);
      expect(fit.right, where).toBeGreaterThanOrEqual(0);
      expect(fit.scroll, where).toBeLessThanOrEqual(fit.client);
      expect(fit.viewport, where).toBeGreaterThanOrEqual(0);
      expect(await pageOverflowX(page), where).toBeLessThanOrEqual(0);
      // From the keyboard: the v2 ring (base.css), not the browser's.
      await page.keyboard.press("Shift");
      await link.focus();
      const ring = await link.evaluate((button) => {
        const style = getComputedStyle(button);
        return {
          visible: button.matches(":focus-visible"),
          style: style.outlineStyle,
          width: style.outlineWidth,
          offset: style.outlineOffset,
        };
      });
      expect(ring, where).toEqual({
        visible: true,
        style: "solid",
        width: "2px",
        offset: "2px",
      });
    });
  }
});

// --- Operation ----------------------------------------------------------

// E5: the drawer edits a draft. Its Apply count is the `total` of the live
// count request; Escape discards the draft; Apply replaces the route once
// (no history entry) and the chips follow.
test("the drawer applies only on Apply", async ({ page }) => {
  const totals: { query: string; total: number }[] = [];
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.pathname === "/api/files" && url.searchParams.get("limit") === "1")
      totals.push({
        query: url.search,
        total: (await response.json()).total,
      });
  });
  await start(page, desktop);
  const length = await historyLength(page);
  let drawer = await openDrawer(page);
  await expect(applyButton(drawer)).toHaveText("Apply (26 matches)");
  expect(totals.at(-1)?.total).toBe(26);
  let values = await fieldValues(drawer, "Resolution");
  await values.getByRole("checkbox", { name: "2160p", exact: true }).check();
  await expect
    .poll(() => totals.find((t) => t.query.includes("resolution=2160p")))
    .toBeTruthy();
  const total = totals.find((t) => t.query.includes("resolution=2160p"))!.total;
  expect(total).toBeGreaterThan(0);
  expect(total).toBeLessThan(26);
  await expect(applyButton(drawer)).toHaveText(
    `Apply (${total} match${total === 1 ? "" : "es"})`,
  );
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(filtersButton(page)).toBeFocused();
  expect(await currentHash(page)).toBe("#/movies");
  await expect(
    page.getByText("No active filters", { exact: true }),
  ).toBeVisible();
  drawer = await openDrawer(page);
  await expect(valueButton(drawer, "Resolution")).toHaveAccessibleName(
    "Resolution All",
  );
  values = await fieldValues(drawer, "Resolution");
  await values.getByRole("checkbox", { name: "2160p", exact: true }).check();
  await expect(applyButton(drawer)).toHaveText(
    `Apply (${total} match${total === 1 ? "" : "es"})`,
  );
  await applyButton(drawer).click();
  await expect(drawer).toHaveCount(0);
  await expect.poll(() => currentHash(page)).toBe("#/movies?resolution=2160p");
  await loaded(page);
  await expect(chips(page)).toHaveText(["Resolution: 2160p"]);
  await expect(filtersButton(page).locator(".v2-count")).toHaveText("1");
  await expect(page.locator(".v2-table > tbody > .v2-row")).toHaveCount(total);
  expect(await historyLength(page), "no history entry").toBe(length);
});

// The drawer keeps Tab inside, closes on Escape and returns focus to
// Filters; an operator menu in it closes first (E27). On a phone it fills
// the screen.
test("the drawer traps focus and returns it", async ({ page }) => {
  const inside = () =>
    page.evaluate(
      () => !!document.activeElement?.closest("dialog.v2-drawer[open]"),
    );
  for (const size of [desktop, phone]) {
    await test.step(label(size), async () => {
      await start(page, size);
      let drawer = await openDrawer(page);
      await expect(
        drawer.getByRole("button", { name: "Close", exact: true }),
      ).toBeFocused();
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press("Tab");
        expect(await inside(), `Tab ${i + 1} at ${label(size)}`).toBe(true);
      }
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press("Shift+Tab");
        expect(await inside(), `Shift+Tab ${i + 1} at ${label(size)}`).toBe(
          true,
        );
      }
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await expect(filtersButton(page)).toBeFocused();

      drawer = await openDrawer(page);
      const operator = drawer.getByRole("button", {
        name: "HDR: contains at least one",
        exact: true,
      });
      await operator.click();
      const menu = page.getByRole("menu", { name: "HDR: operator" });
      await expect(menu).toBeVisible();
      expect(
        await menu.evaluate((element) =>
          element.contains(document.activeElement),
        ),
        "focus in the operator menu",
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(drawer).toBeVisible();
      await expect(operator).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await expect(filtersButton(page)).toBeFocused();
    });
  }
});

// Task 8 M2: Back inside the library while the drawer is open keeps it
// open with the filters of the step, so Apply never writes back the
// filters the step left.
test("the drawer takes the filters of a history step", async ({ page }) => {
  await start(page, desktop, "#/movies?resolution=2160p");
  await follow(page, "#/movies?resolution=1080p");
  const drawer = await openDrawer(page);
  const resolution = valueButton(drawer, "Resolution");
  await expect(resolution).toHaveAccessibleName("Resolution 1080p");
  await page.evaluate(() => history.back());
  await expect.poll(() => currentHash(page)).toBe("#/movies?resolution=2160p");
  await expect(drawer).toBeVisible();
  await expect(resolution).toHaveAccessibleName("Resolution 2160p");
  // Forward takes the filters of its step too (final review T9-M1), and
  // Back again.
  await page.evaluate(() => history.forward());
  await expect.poll(() => currentHash(page)).toBe("#/movies?resolution=1080p");
  await expect(drawer).toBeVisible();
  await expect(resolution).toHaveAccessibleName("Resolution 1080p");
  await page.evaluate(() => history.back());
  await expect.poll(() => currentHash(page)).toBe("#/movies?resolution=2160p");
  await expect(resolution).toHaveAccessibleName("Resolution 2160p");
  await applyButton(drawer).click();
  await expect(drawer).toHaveCount(0);
  await loaded(page);
  expect(await currentHash(page)).toBe("#/movies?resolution=2160p");
  await expect(chips(page)).toHaveText(["Resolution: 2160p"]);
});

// Ruling P10: a failed preload of the drawer's chunk is ignored; opening
// tries once more. When that fails too, the drawer closes with the error
// notice, without a reload, and focus is back on Filters.
test("the drawer chunk loads once more after a failed preload", async ({
  page,
}) => {
  for (const failures of [1, 2]) {
    await test.step(`${failures} failed import(s)`, async () => {
      let requests = 0;
      await page.route(
        /\/assets\/LibraryFilterDrawer-[^/]+\.js$/,
        async (route) => {
          requests++;
          if (requests <= failures) return route.abort();
          return route.continue();
        },
      );
      await start(page, desktop);
      await expect.poll(() => requests, "the idle preload").toBe(1);
      await page.evaluate(() => {
        (window as unknown as { __stayed: boolean }).__stayed = true;
      });
      await filtersButton(page).click();
      if (failures === 1) {
        await expect(filterDrawer(page)).toBeVisible();
        await page.keyboard.press("Escape");
      } else {
        await expect(
          page
            .locator(".v2-toast")
            .filter({ hasText: "Scopearr is not reachable" }),
        ).toBeVisible();
        await expect(filterDrawer(page)).toHaveCount(0);
        await expect(filtersButton(page)).toBeFocused();
      }
      expect(requests, "one retry").toBe(2);
      expect(
        await page.evaluate(
          () => (window as unknown as { __stayed?: boolean }).__stayed,
        ),
        "no reload",
      ).toBe(true);
      await page.unrouteAll({ behavior: "wait" });
    });
  }
});

// F2b: the drawer's track combination asks for language, codec and
// channels of the same track; Apply sets `track`, a chip names it.
test("a track combination filters by the same track", async ({ page }) => {
  await start(page, desktop);
  const drawer = await openDrawer(page);
  const section = drawer.getByRole("region", {
    name: "Audio track combination",
  });
  await expect(section).toHaveAccessibleDescription(
    "Language, codec and channels must match within the same track. Files without measured tracks never match.",
  );
  await section
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption({ label: "German" });
  await section
    .getByRole("combobox", { name: "Audio codec", exact: true })
    .selectOption({ label: "DTS" });
  await section
    .getByRole("combobox", { name: "Channels", exact: true })
    .selectOption({ label: "5.1" });
  await expect(applyButton(drawer)).toHaveText("Apply (2 matches)");
  await applyButton(drawer).click();
  await expect
    .poll(() => currentHash(page))
    .toBe("#/movies?track=Deutsch%7CDTS%7C5.1");
  await loaded(page);
  await expect(chips(page)).toHaveText([
    "Audio track combination: German · DTS · 5.1",
  ]);
  await expect(page.locator(".v2-table > tbody > .v2-row")).toHaveCount(2);
  await expect(row(page, "Arrival")).toHaveCount(1);
  await expect(row(page, "Blade Runner 2049")).toHaveCount(1);
  // The drawer starts from the applied combination.
  const again = await openDrawer(page);
  await expect(
    again.getByRole("combobox", { name: "Language", exact: true }),
  ).toHaveValue("Deutsch");
  await page.keyboard.press("Escape");
});

// E7: a track chip's menu filters by its language, its codec, its
// channels (as the combination ||channels) or language with codec in the
// same track. A choice replaces only its own field (operator back to is),
// keeps the search and goes to page 1. A chip of values without track
// attribution offers no same-track entry.
test("a track chip filters by language, codec, channels or the same track", async ({
  page,
}) => {
  const start0 = "#/movies?q=Arrival&language=Japanisch&languageOp=not";
  const choices: [string, string[]][] = [
    ["Only German", ["language=Deutsch", "q=Arrival"]],
    [
      "Only DTS",
      ["audio=DTS", "language=Japanisch", "languageOp=not", "q=Arrival"],
    ],
    [
      "Only 5.1",
      ["language=Japanisch", "languageOp=not", "q=Arrival", "track=||5.1"],
    ],
    [
      "German with DTS (same track)",
      [
        "language=Japanisch",
        "languageOp=not",
        "q=Arrival",
        "track=Deutsch|DTS|",
      ],
    ],
  ];
  await start(page, desktop, start0);
  await page.getByRole("button", { name: "All columns", exact: true }).click();
  for (const [choice, expected] of choices) {
    await test.step(choice, async () => {
      await follow(page, start0);
      const chip = page.getByRole("button", {
        name: "Track 1 · German · DTS · 5.1 · Default track",
        exact: true,
      });
      await chip.click();
      const menu = page.getByRole("menu", { name: "Filter by this track" });
      await expect(menu.getByRole("menuitem")).toHaveText([
        "Only German",
        "Only DTS",
        "Only 5.1",
        "German with DTS (same track)",
      ]);
      await menu.getByRole("menuitem", { name: choice, exact: true }).click();
      await expect(menu).toHaveCount(0);
      await expect
        .poll(async () => params(await currentHash(page)))
        .toEqual(expected);
      await loaded(page);
    });
  }
  await test.step("values without track attribution", async () => {
    await follow(page, "#/movies?q=Alien");
    const loose = row(page, "Alien").getByRole("button", {
      name: "English · DTS · 5.1",
      exact: true,
    });
    await loose.click();
    await expect(
      page
        .getByRole("menu", { name: "Filter by this track" })
        .getByRole("menuitem"),
    ).toHaveText(["Only English", "Only DTS", "Only 5.1"]);
    await page.keyboard.press("Escape");
    await expect(loose).toBeFocused();
  });
});

// E7: "+n" opens every track of the file in a popover table; Escape
// returns focus to it.
test("the more popover lists every track", async ({ page }) => {
  await withAudioTracks(page);
  await start(page, desktop, "#/movies?q=Arrival");
  await page.getByRole("button", { name: "All columns", exact: true }).click();
  const cell = row(page, "Arrival")
    .locator("td")
    .filter({
      has: page.locator(".v2-trk"),
    });
  await expect(cell.locator("button.v2-trk:not(.v2-trk--more)")).toHaveCount(2);
  const more = cell.getByRole("button", {
    name: "+2 · Show all 4 audio tracks",
    exact: true,
  });
  await expect(more).toHaveText("+2");
  await more.click();
  const popover = page.getByRole("dialog", { name: "Audio tracks of Arrival" });
  await expect(popover).toBeVisible();
  const rows = popover.getByRole("row");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0).getByRole("columnheader")).toHaveText([
    "Track",
    "Language",
    "Title",
    "Default",
  ]);
  const texts = await rows.evaluateAll((all) =>
    all
      .slice(1)
      .map((tr) =>
        [...tr.querySelectorAll("td")].map((td, i) =>
          i
            ? td.textContent
            : td.querySelector("[title]")?.getAttribute("title"),
        ),
      ),
  );
  expect(texts).toEqual([
    ["Track 1 · German · DTS · 5.1 · Default track", "German", "—", "Yes"],
    ["Track 2 · English · AC-3 · 5.1", "English", "—", "No"],
    ["Track 3 · English · E-AC-3 · 7.1", "English", "—", "No"],
    [
      "Track 4 · English · AAC · 2.0 · Commentary",
      "English",
      "Commentary",
      "No",
    ],
  ]);
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(more).toBeFocused();
});

// E13: stacked, every track is a chip on a line of its own and no "+n".
test("stacked tracks show every track", async ({ page }) => {
  await withAudioTracks(page);
  await withListPrefs(page, { stacked: true });
  await start(page, desktop, "#/movies?q=Arrival");
  await page.getByRole("button", { name: "All columns", exact: true }).click();
  const arrival = row(page, "Arrival");
  const tracks = arrival.locator(".v2-trk-stack > button.v2-trk");
  await expect(tracks).toHaveCount(4);
  await expect(arrival.locator(".v2-trk--more")).toHaveCount(0);
  const tops = await tracks.evaluateAll((all) =>
    all.map((chip) => chip.getBoundingClientRect().top),
  );
  expect(new Set(tops).size, "one line per track").toBe(4);
});

// L15: a chip removes its value (an eq field per value, all/not all the
// whole field; the field's other values move to the end, as 1.7.0 wrote
// them); focus moves to the chip now in its place. Reset filters clears
// all; focus goes to the group.
test("a chip removes its filter", async ({ page }) => {
  await start(
    page,
    desktop,
    "#/movies?resolution=2160p&resolution=1080p&hdr=HDR10&hdr=Dolby%20Vision&hdrOp=all",
  );
  await expect(chips(page)).toHaveText([
    "Resolution: 2160p",
    "Resolution: 1080p",
    "HDR contains all: HDR10 + Dolby Vision",
  ]);
  await chips(page).nth(1).click();
  await expect
    .poll(async () => params(await currentHash(page)))
    .toEqual([
      "hdr=Dolby Vision",
      "hdr=HDR10",
      "hdrOp=all",
      "resolution=2160p",
    ]);
  // The field's other values move to the end, as in 1.7.0.
  await expect(chips(page)).toHaveText([
    "HDR contains all: HDR10 + Dolby Vision",
    "Resolution: 2160p",
  ]);
  await expect(chips(page).nth(1)).toBeFocused();
  // The whole field goes; its operator stays, as in 1.7.0.
  await chips(page).first().click();
  await expect
    .poll(async () => params(await currentHash(page)))
    .toEqual(["hdrOp=all", "resolution=2160p"]);
  await expect(chips(page)).toHaveText(["Resolution: 2160p"]);
  await expect(chips(page).first()).toBeFocused();
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await expect.poll(() => currentHash(page)).toBe("#/movies");
  await expect(
    page.getByText("No active filters", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Filters", exact: true }),
  ).toBeFocused();
});

// L4–L6, R-I: a preset is saved from the filters (a duplicate is named),
// chosen in the select (All files resets), and deleted after a
// confirmation; filters without a preset show "Custom selection".
test("presets are saved, chosen and deleted", async ({ page }) => {
  const NAME = "E2E 2160p";
  await start(page, desktop, "#/movies?resolution=2160p");
  const select = page.getByRole("combobox", { name: "Filter preset" });
  await expect(select.locator("option:checked")).toHaveText("Custom selection");
  const save = async () => {
    await page
      .getByRole("button", { name: "Save preset", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Save filter view" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "Name" }).fill(NAME);
    await dialog
      .getByRole("button", { name: "Save view", exact: true })
      .click();
    return dialog;
  };
  const dialog = await save();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator(".v2-toast").filter({ hasText: "Filter view saved." }),
  ).toBeVisible();
  await expect(select.locator("option:checked")).toHaveText(NAME);
  const remove = page.getByRole("button", {
    name: "Delete selected preset",
    exact: true,
  });
  await expect(remove).toBeEnabled();
  // A duplicate is named, not saved.
  const twice = await save();
  await expect(twice.getByRole("alert")).toHaveText(
    `These filters are already saved as ${NAME}.`,
  );
  await page.keyboard.press("Escape");
  await expect(twice).toHaveCount(0);
  // All files resets, the preset brings its filters back.
  await select.selectOption({ label: "All files" });
  await expect.poll(() => currentHash(page)).toBe("#/movies");
  await expect(remove).toBeDisabled();
  await select.selectOption({ label: NAME });
  await expect.poll(() => currentHash(page)).toBe("#/movies?resolution=2160p");
  await expect(chips(page)).toHaveText(["Resolution: 2160p"]);
  // Deleted after a confirmation.
  await remove.click();
  const confirm = page.getByRole("dialog", { name: "Confirm deletion" });
  await expect(confirm).toContainText(`Delete preset ${NAME}?`);
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.locator(".v2-toast").filter({ hasText: "Preset deleted." }),
  ).toBeVisible();
  await expect(select.locator("option", { hasText: NAME })).toHaveCount(0);
  await expect(select.locator("option:checked")).toHaveText("Custom selection");
});

// L20: All columns shows the hidden columns in the saved order; pressed,
// it is "Default view" and returns to the saved ones.
test("all columns show the hidden columns", async ({ page }) => {
  await start(page, desktop);
  const headers = page.locator(".v2-table > thead th:not(.v2-table-sel)");
  const shown = [
    "Info",
    "Title",
    "Year",
    "Resolution",
    "Codec",
    "Source",
    "Processing",
    "Custom",
  ];
  await expect(headers).toHaveText(shown);
  const all = page.getByRole("button", { name: "All columns", exact: true });
  await expect(all).toHaveAttribute("aria-pressed", "false");
  await all.click();
  const back = page.getByRole("button", { name: "Default view", exact: true });
  await expect(back).toHaveAttribute("aria-pressed", "true");
  await expect(headers).toHaveText([
    "Info",
    "Title",
    "Year",
    "Resolution",
    "Codec",
    "Source",
    "Processing",
    "Size",
    "HDR",
    "Bit depth",
    "Audio tracks",
    "Channels",
    "Custom",
  ]);
  await back.click();
  await expect(headers).toHaveText(shown);
  await expect(all).toHaveAttribute("aria-pressed", "false");
});

// L22: Set tag, named by what it shows ("Set tag 2"), opens the custom
// tags dialog for the selection;
// without one it is locked.
test("set tag opens the custom tags dialog", async ({ page }) => {
  await start(page, desktop);
  await expect(
    page.getByRole("button", { name: "Set tag 0", exact: true }),
  ).toBeDisabled();
  for (const title of ["Alien", "Arrival"])
    await page
      .getByRole("checkbox", { name: `Select ${title}`, exact: true })
      .check();
  await page.getByRole("button", { name: "Set tag 2", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Custom tags" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Set tag 2", exact: true }),
  ).toBeVisible();
});

// L28: with two media servers a file's media button opens a menu of their
// links (a new tab each); a server without the file's entry is a disabled
// entry with the hint.
test("the media server menu opens its links", async ({ page, context }) => {
  await page.route(/\/api\/settings$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const settings = await response.json();
    for (const instance of settings.instances)
      if (instance.type === "emby" || instance.type === "jellyfin") {
        instance.enabled = true;
        instance.url = `http://${instance.type}.test:8096`;
      }
    await route.fulfill({ response, json: settings });
  });
  await page.route(/\/api\/files\?/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const file of body.files ?? []) {
      if (file.title === "Arrival")
        file.mediaServers = {
          emby: { status: "matched", link: { itemId: "a1", serverId: "e1" } },
          jellyfin: {
            status: "matched",
            link: { itemId: "b2", serverId: "j2" },
          },
        };
      if (file.title === "Alien")
        file.mediaServers = {
          emby: { status: "matched", link: { itemId: "a3", serverId: "e1" } },
        };
    }
    await route.fulfill({ response, json: body });
  });
  await context.route(/^http:\/\/(emby|jellyfin)\.test:8096\//, (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>server</title>" }),
  );
  await start(page, desktop);
  const button = row(page, "Arrival").getByRole("button", {
    name: "Choose media server",
    exact: true,
  });
  await button.click();
  const menu = page.getByRole("menu", { name: "Choose media server" });
  const emby = menu.getByRole("menuitem", { name: "Emby", exact: true });
  await expect(emby).toHaveAttribute(
    "href",
    "http://emby.test:8096/web/index.html#!/item?id=a1&serverId=e1",
  );
  await expect(
    menu.getByRole("menuitem", { name: "Jellyfin", exact: true }),
  ).toHaveAttribute(
    "href",
    "http://jellyfin.test:8096/web/#/details?id=b2&serverId=j2",
  );
  await expect(emby).toHaveAttribute("target", "_blank");
  await expect(emby).toHaveAttribute("rel", "noopener noreferrer");
  const opened = context.waitForEvent("page");
  await emby.click();
  const tab = await opened;
  await expect
    .poll(() => tab.url())
    .toBe("http://emby.test:8096/web/index.html#!/item?id=a1&serverId=e1");
  await tab.close();
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
  await row(page, "Alien")
    .getByRole("button", { name: "Choose media server", exact: true })
    .click();
  await expect(
    menu.getByRole("menuitem", { name: "Jellyfin", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
});

// L13: only TV series offer the season outliers in the drawer.
test("series offer the season outlier filters", async ({ page }) => {
  await start(page, desktop);
  let drawer = await openDrawer(page);
  await expect(
    drawer.getByRole("checkbox", { name: "Technical outliers", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await goTo(page, "series");
  await loaded(page);
  drawer = await openDrawer(page);
  for (const name of ["Technical outliers", "Language outliers"])
    await expect(
      drawer.getByRole("checkbox", { name, exact: true }),
    ).toHaveCount(1);
  await drawer
    .getByRole("checkbox", { name: "Technical outliers", exact: true })
    .check();
  await applyButton(drawer).click();
  await expect
    .poll(() => currentHash(page))
    .toBe("#/series?seasonOutlier=true");
  await loaded(page);
  await expect(chips(page)).toHaveText(["Technical outliers: is"]);
  expect(
    await page.locator(".v2-table > tbody > .v2-row").count(),
  ).toBeGreaterThan(0);
});

// E14, L38: the instance segment in the page header (a navigation named
// "Instances") filters by instance through a link, marks it current,
// names it in the card title and its chip (1.7.0 "Service: …"), and
// stays in place, as the card does. It is navigation, not a filter (final
// review I3): the preset select keeps "All files" and Filters counts 0.
test("the instance segment filters and stays in place", async ({ page }) => {
  await withTwoMovieInstances(page);
  for (const size of [desktop, phone]) {
    await test.step(label(size), async () => {
      await start(page, size);
      const segment = page.getByRole("navigation", { name: "Instances" });
      const links = segment.getByRole("link");
      await expect(links).toHaveText(["All", "Radarr HD", "Radarr 4K"]);
      await expect(links.first()).toHaveAttribute("aria-current", "page");
      const parts = [".v2-page-head", ".v2-table-card", ".v2-tc-head"];
      const place = (await segment.boundingBox())!;
      const base = await boxesOf(page, parts);
      for (const [name, id] of [
        ["Radarr 4K", "radarr-4k"],
        ["All", ""],
      ]) {
        await segment.getByRole("link", { name, exact: true }).click();
        await expect
          .poll(() => currentHash(page))
          .toBe("#/movies" + (id ? "?instance=" + id : ""));
        await loaded(page);
        await expect(
          segment.getByRole("link", { name, exact: true }),
        ).toHaveAttribute("aria-current", "page");
        await expect(page.locator(".v2-tc-text")).toHaveText(
          "Your movies" + (id ? " · " + name : ""),
        );
        await expect(chips(page)).toHaveText(id ? [`Service: ${name}`] : []);
        await expect(
          page
            .getByRole("combobox", { name: "Filter preset" })
            .locator("option:checked"),
        ).toHaveText("All files");
        await expect(filtersButton(page).locator(".v2-count")).toHaveText("0");
        await expect(filtersButton(page).locator(".v2-count")).not.toHaveClass(
          /v2-count--on/,
        );
        expect(await segment.boundingBox(), `segment after ${name}`).toEqual(
          place,
        );
        const now = await boxesOf(page, parts);
        for (const query of parts)
          for (const edge of ["x", "y", "width"] as Edge[])
            expectSame(
              now[query]![edge],
              base[query]![edge],
              `${query} ${edge} after ${name} at ${label(size)}`,
            );
      }
    });
  }
});

// E27, M12: a toast raised by a real action stays clear of the list's
// menus: with the toast up, the track menu and the drawer's operator menu
// open, and a press on the toast leaves each open.
test("menus in the list survive a toast press", async ({ page }) => {
  const NAME = "E2E toast";
  await start(page, desktop, "#/movies?resolution=2160p");
  await page.getByRole("button", { name: "All columns", exact: true }).click();
  const toast = page.locator(".v2-toast");
  // A toast from saving a preset.
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save filter view" });
  await dialog.getByRole("textbox", { name: "Name" }).fill(NAME);
  await dialog.getByRole("button", { name: "Save view", exact: true }).click();
  await expect(toast.filter({ hasText: "Filter view saved." })).toBeVisible();
  // The track menu opens and survives a press on the toast.
  await row(page, "Blade Runner 2049")
    .getByRole("button", {
      name: "Track 1 · German · DTS · 5.1 · Default track",
      exact: true,
    })
    .click();
  const trackMenu = page.getByRole("menu", { name: "Filter by this track" });
  await expect(trackMenu).toBeVisible();
  await toast
    .filter({ hasText: "Filter view saved." })
    .locator(".v2-toast-text")
    .click();
  await expect(trackMenu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trackMenu).toHaveCount(0);
  // A toast from deleting it; then the drawer's operator menu.
  await page
    .getByRole("button", { name: "Delete selected preset", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Confirm deletion" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(toast.filter({ hasText: "Preset deleted." })).toBeVisible();
  // The toasts start below the card's head (top right, placeToasts), so
  // Filters stays free; the keyboard opens it.
  await filtersButton(page).focus();
  await page.keyboard.press("Enter");
  const drawer = filterDrawer(page);
  await expect(drawer).toBeVisible();
  await drawer
    .getByRole("button", { name: "Audio codec: contains at least one" })
    .click();
  const operatorMenu = page.getByRole("menu", {
    name: "Audio codec: operator",
  });
  await expect(operatorMenu).toBeVisible();
  await toast
    .filter({ hasText: "Preset deleted." })
    .locator(".v2-toast-text")
    .click();
  await expect(operatorMenu).toBeVisible();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
});

// Phase 5d, Task 6 (ruling Q2): a toast with a link stays 8 s; in File &
// metadata at 1440 it starts below the dialog's head, so the paging
// buttons and Close stay free: the point at each one's center hits it.
test("an 8 s toast covers neither paging nor Close in the file dialog", async ({
  page,
}) => {
  await withStatus(page, (status) => {
    (status as { mux?: { enabled: boolean; installed: boolean } }).mux = {
      enabled: true,
      installed: true,
    };
  });
  // The demo creates no mux job: the marking is answered here.
  await page.route(/\/api\/mux\/jobs$/, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          json: { id: 1, service: "radarr", fileId: 1, status: "draft" },
        })
      : route.continue(),
  );
  await start(page, desktop);
  await page
    .getByRole("button", { name: "Filename and metadata: Arrival" })
    .click();
  const dialog = page.getByRole("dialog", { name: "File & metadata" });
  await dialog
    .getByRole("button", { name: "Mark for muxing", exact: true })
    .click();
  const toast = page
    .locator(".v2-toast")
    .filter({ hasText: "Marked for muxing." });
  await expect(toast).toBeVisible();
  await expect(
    toast.getByRole("button", { name: "Open Muxing" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Open Muxing tab", exact: true }),
  ).toBeVisible();
  const head = await dialog.locator(".v2-modal-head").boundingBox();
  const own = await toast.boundingBox();
  expect(own!.y, "the toast starts below the head").toBeGreaterThan(
    head!.y + head!.height,
  );
  for (const name of ["Previous file", "Next file", "Close"]) {
    const button = dialog
      .locator(".v2-modal-head")
      .getByRole("button", { name, exact: true });
    expect(
      await button.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return !!hit && el.contains(hit);
      }),
      name + " is free",
    ).toBe(true);
  }
});

// Phase 5d, task 7 (E16, R-G, F2): ↑/↓ and the head's buttons page
// through the filtered list; the count follows, and the head, the tabs
// row, the foot and its buttons keep their boxes. ↑ in the rename field
// moves its caret, not the dialog; a changed filename asks first.
test("paging moves through the filtered list without moving the dialog", async ({
  page,
}) => {
  await withRenameAvailable(page);
  await start(page, desktop);
  const rows = page.getByRole("button", { name: /^Filename and metadata: / });
  const names = await rows.evaluateAll((all) =>
    all.map((el) => el.getAttribute("aria-label")!.slice(23)),
  );
  const total = names.length;
  await rows.first().click();
  const dialog = page.getByRole("dialog", { name: "File & metadata" });
  await expect(dialog).toBeVisible();
  const count = dialog.locator(".v2-modal-foot [aria-live=polite]");
  const title = dialog.locator(".v2-file-name");
  await expect(count).toHaveText(`1 of ${total}`);
  await expect(title).toContainText(names[0]);
  const previous = dialog.getByRole("button", { name: "Previous file" }),
    next = dialog.getByRole("button", { name: "Next file" });
  await expect(previous).toBeDisabled();
  const parts = {
    dialog: dialog,
    head: dialog.locator(".v2-modal-head"),
    tabs: dialog.locator(".v2-tabs"),
    foot: dialog.locator(".v2-modal-foot"),
    close: dialog
      .locator(".v2-modal-foot")
      .getByRole("button", { name: "Close", exact: true }),
    previous,
    next,
  };
  const boxes = async () => {
    const out: Record<string, { x: number; y: number; w: number; h: number }> =
      {};
    for (const [key, part] of Object.entries(parts)) {
      const box = (await part.boundingBox())!;
      out[key] = { x: box.x, y: box.y, w: box.width, h: box.height };
    }
    return out;
  };
  const before = await boxes();
  const length = await historyLength(page);
  const same = async (label: string) => {
    const now = await boxes();
    for (const key of Object.keys(before))
      for (const side of ["x", "y", "w", "h"] as const)
        expectSame(
          now[key][side],
          before[key][side],
          `${label}: ${key} ${side}`,
        );
  };
  // ↓ from the title, the button and ↑ again.
  await page.keyboard.press("ArrowDown");
  await expect(count).toHaveText(`2 of ${total}`);
  await expect(title).toContainText(names[1]);
  await same("after ArrowDown");
  await next.click();
  await expect(count).toHaveText(`3 of ${total}`);
  await expect(title).toContainText(names[2]);
  await same("after Next file");
  await page.keyboard.press("ArrowUp");
  await expect(count).toHaveText(`2 of ${total}`);
  await same("after ArrowUp");
  await previous.click();
  await expect(count).toHaveText(`1 of ${total}`);
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(count).toHaveText(`2 of ${total}`);
  // With a modifier, ↓ is not paging.
  await page.keyboard.press("Shift+ArrowDown");
  await expect(count).toHaveText(`2 of ${total}`);
  expect(await historyLength(page), "paging adds no entry").toBe(length);

  // ↑ in the rename field stays in the field; a changed name asks.
  await dialog
    .getByRole("button", { name: "Rename file", exact: true })
    .click();
  const field = dialog.getByRole("textbox", { name: "Filename" });
  await expect(field).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(count).toHaveText(`2 of ${total}`);
  await expect(field).toBeFocused();
  await field.fill("Renamed file");
  await next.click();
  await answerDiscard(page, "Cancel");
  await expect(count).toHaveText(`2 of ${total}`);
  await expect(field).toHaveValue("Renamed file");
  await next.click();
  await answerDiscard(page, "Discard changes");
  await expect(count).toHaveText(`3 of ${total}`);
  await expect(title).toContainText(names[2]);
  await expect(field).toHaveCount(0);
  await same("after the rename field closed");
});

// Phase 5d, task 7 (E17, R-H): the open file is in the route as file=, a
// replace, never a new entry; closing takes it out. A reload with it opens
// the dialog again; a key the list does not have goes quietly.
test("a file dialog mirrors itself in the route", async ({ page }) => {
  await start(page, desktop, "#/movies?q=Arrival");
  const length = await historyLength(page);
  await page
    .getByRole("button", { name: "Filename and metadata: Arrival" })
    .click();
  const dialog = page.getByRole("dialog", { name: "File & metadata" });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => currentHash(page))
    .toMatch(/^#\/movies\?q=Arrival&file=radarr%3A\d+$/);
  const hash = await currentHash(page);
  expect(await historyLength(page)).toBe(length);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => currentHash(page)).toBe("#/movies?q=Arrival");
  expect(await historyLength(page)).toBe(length);

  // A reload with the key opens the dialog on that file.
  await page.evaluate((next) => (location.hash = next), hash);
  await page.reload();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".v2-file-name")).toContainText("Arrival");
  expect(await currentHash(page)).toBe(hash);
  await dialog
    .locator(".v2-modal-foot")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect.poll(() => currentHash(page)).toBe("#/movies?q=Arrival");
  // An unknown file leaves the list alone and drops the key.
  await start(page, desktop, "#/movies?q=Arrival&file=radarr%3A999999");
  await expect.poll(() => currentHash(page)).toBe("#/movies?q=Arrival");
  await expect(dialog).toHaveCount(0);
});

// Phase 5d fix wave (T7 m3): a key for a file the loaded page does not
// list, with the same filters (no new answer follows), goes too.
test("a file key without a new answer goes", async ({ page }) => {
  await start(page, desktop, "#/movies?q=Arrival");
  await expect(
    page.getByRole("button", { name: "Filename and metadata: Arrival" }),
  ).toBeVisible();
  await page.evaluate(
    () => (location.hash = "#/movies?q=Arrival&file=radarr%3A999999"),
  );
  await expect.poll(() => currentHash(page)).toBe("#/movies?q=Arrival");
  await expect(
    page.getByRole("dialog", { name: "File & metadata" }),
  ).toHaveCount(0);
});

// Phase 5d fix wave (T6 M7): the stem and the extension are two flex
// items, so a selection over both would copy with a break between them.
// The name copies whole.
test("a file's name copies whole", async ({ page }) => {
  await start(page, desktop, "#/movies?q=Arrival");
  await page
    .getByRole("button", { name: "Filename and metadata: Arrival" })
    .click();
  const dialog = page.getByRole("dialog", { name: "File & metadata" });
  await expect(dialog).toBeVisible();
  const path = dialog.locator(".v2-file-path");
  const filename = await path.locator("code").getAttribute("title");
  expect(filename).toMatch(/\.mkv$/);
  const copied = await path.evaluate((box) => {
    const range = document.createRange();
    range.setStartBefore(box.querySelector("code")!);
    range.setEndAfter(box.querySelector(".v2-file-ext")!);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const event = new ClipboardEvent("copy", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer(),
    });
    box.querySelector("code")!.dispatchEvent(event);
    return {
      data: event.defaultPrevented
        ? event.clipboardData!.getData("text/plain")
        : selection.toString(),
    };
  });
  expect(copied.data).toBe(filename);
});

// Final review T7-3: a press on the backdrop closes the drawer, a drag
// that begins inside it (selecting a field's text) and ends on the
// backdrop does not, though its click lands on the dialog too.
test("a drag out of the drawer leaves it open", async ({ page }) => {
  await start(page, desktop);
  const drawer = await openDrawer(page);
  const box = (await drawer.boundingBox())!;
  const title = (await drawer.locator(".v2-drawer-title").boundingBox())!;
  await page.mouse.move(title.x + 4, title.y + title.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect(drawer).toBeVisible();
  await page.mouse.click(box.x - 120, box.y + 200);
  await expect(drawer).toHaveCount(0);
  await expect(filtersButton(page)).toBeFocused();
});

// The drawer is a dialog on the dialog stack: ⌘K / Ctrl+K wait until it
// has closed.
test("quick search is closed while the drawer is open", async ({ page }) => {
  await start(page, desktop);
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

// L36, ruling P11/M14: the pager pages forward and back, and a page past
// the end (a deep link) returns to the last page.
test("a page past the end returns to the last page", async ({ page }) => {
  await start(page, desktop, "#/series?page=5");
  await expect.poll(() => currentHash(page)).toBe("#/series?page=2");
  await loaded(page);
  const pager = page.getByRole("navigation", { name: "Page 2 / 2" });
  await expect(pager).toBeVisible();
  await expect(pager).toContainText(
    "101–122 of 122 files · by series and season",
  );
  await pager.getByRole("button", { name: "Previous page" }).click();
  await expect.poll(() => currentHash(page)).toBe("#/series");
  await loaded(page);
  await expect(
    page.getByRole("navigation", { name: "Page 1 / 2" }),
  ).toContainText("1–100 of 122 files · by series and season");
});

// --- Touch --------------------------------------------------------------

// The targets of a region a touch reaches (shared with frame.spec.ts and
// dashboard.spec.ts, app.ts).
const listTargets = (page: Page, region: string) =>
  smallTargets(
    page,
    `${region} :is(a, button, select, label, input, [role=link])`,
    { fields: true },
  );

// Every target of the card and the drawer reaches 44 × 44 on a touch
// screen (phone and tablet): the selection boxes, Info and edit buttons,
// the auto mark (its area runs right, clear of the edit button's), sort
// buttons, chips, tools, pager, and in the drawer the operators, values
// and state labels. TV series' group rows keep their boxes' areas within
// the row.
test("library targets reach 44 px on a coarse pointer", async ({ browser }) => {
  for (const [size, isMobile] of [
    [phone, true],
    [{ width: 1024, height: 768 }, false],
  ] as const) {
    await test.step(label(size), async () => {
      const page = await touchPage(browser, size, { isMobile });
      await withCustomTags(page);
      await openRoute(page, "#/movies?resolution=1080p&resolution=2160p");
      await loaded(page);
      expect(
        await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      ).toBe(true);
      const card = await listTargets(page, ".v2-table-card");
      expect(card.checked).toBeGreaterThan(20);
      expect(card.small, `card at ${label(size)}`).toEqual([]);
      // The auto mark's area starts at the mark; the edit button's ends
      // before it.
      const areas = await row(page, "Arrival").evaluate((tr) => {
        const area = (element: Element, centered: boolean) => {
          const box = element.getBoundingClientRect();
          const after = getComputedStyle(element, "::after");
          const width = Math.max(box.width, parseFloat(after.width) || 0);
          const left = centered
            ? box.left + box.width / 2 - width / 2
            : box.left;
          return { left, right: left + width };
        };
        return {
          edit: area(tr.querySelector(".v2-row-btn--sm")!, true),
          auto: area(tr.querySelector(".v2-ctag-auto")!, false),
        };
      });
      expect(
        areas.edit.right,
        `the edit button's area ends before the auto mark's at ${label(size)}`,
      ).toBeLessThanOrEqual(areas.auto.left + 0.5);
      await filtersButton(page).tap();
      const drawer = filterDrawer(page);
      await expect(drawer).toBeVisible();
      await (await fieldValues(drawer, "Resolution")).waitFor();
      const inDrawer = await listTargets(page, "dialog.v2-drawer[open]");
      expect(inDrawer.checked).toBeGreaterThan(30);
      expect(inDrawer.small, `drawer at ${label(size)}`).toEqual([]);
      // TV series (final review T9-a): a group row's box area is as high
      // as its row (series 42, season 34; at least 24, WCAG 2.5.8), so no
      // box area covers another row's; an episode's stays 44.
      await page.keyboard.press("Escape");
      await openRoute(page, "#/series");
      await loaded(page);
      const boxes = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            ".v2-table > tbody > tr > .v2-table-sel .v2-table-hit",
          ),
        ].map((hit) => {
          const row = hit.closest("tr")!;
          const box = hit.getBoundingClientRect();
          const height = Math.max(
            box.height,
            parseFloat(getComputedStyle(hit, "::after").height) || 0,
          );
          const middle = box.top + box.height / 2;
          return {
            kind: row.classList.contains("v2-row--season")
              ? "season"
              : row.classList.contains("v2-row--series")
                ? "series"
                : "episode",
            row: row.getBoundingClientRect().height,
            height,
            top: middle - height / 2,
            bottom: middle + height / 2,
          };
        }),
      );
      expect(
        new Set(boxes.map((box) => box.kind)),
        `group rows at ${label(size)}`,
      ).toEqual(new Set(["series", "season", "episode"]));
      for (const box of boxes)
        if (box.kind === "episode") expectSame(box.height, 44, "episode box");
        else {
          expect(box.height, `${box.kind} box`).toBeGreaterThanOrEqual(24);
          expect(box.height, `${box.kind} box`).toBeLessThanOrEqual(
            box.row + 0.5,
          );
        }
      const overlaps = boxes
        .slice(1)
        .filter((box, i) => boxes[i].bottom - box.top > 0.5)
        .map((box) => `${box.kind} at ${box.top}`);
      expect(overlaps, `box areas over another row at ${label(size)}`).toEqual(
        [],
      );
      await page.context().close();
    });
  }
});
