// Frame invariants (docs/STYLEGUIDE.md, Part 1, 13): the frame keeps its
// geometry per breakpoint, between pages and states and after its first
// paint, and its rail, flyout, drawer and tab bar follow keyboard, pointer
// and touch. Measured after network idle and loaded fonts; tolerance 0.5 px.
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  currentHash,
  goTo,
  historyLength,
  mainNavigation,
  networkQuiet,
  openApp,
  openRoute,
  pageOverflowX,
  rect,
  settingsSection,
  settingsSections,
  settle,
  withTwoMovieInstances,
  type View,
} from "./app";

const TOLERANCE = 0.5;
type Size = { width: number; height: number };
type Box = { x: number; y: number; width: number; height: number };

// The widths around every threshold of the frame (1600, 1120, 740) and the
// smallest phone.
const WIDTHS = [1600, 1440, 1120, 1119, 820, 740, 739, 375, 320];
const sizeOf = (width: number): Size => ({
  width,
  height: width === 820 ? 1180 : width <= 739 ? 812 : 900,
});
const desktop = sizeOf(1440),
  wide = sizeOf(1600),
  phone = sizeOf(375);
const label = ({ width, height }: Size) => `${width}x${height}`;

function expectSame(actual: number, expected: number, what: string) {
  expect(
    Math.abs(actual - expected),
    `${what}: got ${actual}px, expected ${expected}px (±${TOLERANCE}px)`,
  ).toBeLessThanOrEqual(TOLERANCE);
}

// A fresh load (not a hash change of the same document) at `size`.
async function start(page: Page, size: Size, hash = "") {
  await page.setViewportSize(size);
  await page.goto("about:blank");
  await openRoute(page, hash, { theme: "dark" });
}

// A stored sidebar choice (E8) for every load of this page.
async function preferSidebar(page: Page, mode: "expanded" | "rail") {
  await page.addInitScript((value) => {
    try {
      localStorage.setItem("scopearr-sidebar", value);
    } catch {
      // Storage can be blocked; the default mode is then used.
    }
  }, mode);
}

// The frame's pages: the views, Settings → Services and System → Log.
type FramePage = View | "system-log";
const PAGES: FramePage[] = [
  "dashboard",
  "movies",
  "series",
  "mux",
  "placement",
  "files",
  "settings",
  "system-log",
];

async function visit(page: Page, name: FramePage) {
  if (name !== "system-log") return goTo(page, name);
  await goTo(page, "settings");
  await settingsSection(page, "System");
  const tab = page
    .getByRole("tablist", { name: "System sections" })
    .getByRole("tab", { name: "Log", exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await settle(page);
}

// The fixed frame of a breakpoint (E2, E8, E11, Design 8.1).
function frameOf(size: Size) {
  const small = size.width <= 739;
  return {
    mode: small ? "drawer" : size.width >= 1600 ? "expanded" : "rail",
    sidebar: size.width >= 1600 ? 260 : 72,
    band: small ? { top: 0, height: 220 } : { top: 16, height: 194 },
    topbar: small ? { top: 6, height: 52 } : { top: 24, height: 52 },
    head: small ? { top: 58, height: 114 } : { top: 76, height: 70 },
    sheet: small ? 172 : 146,
  };
}

async function frameGeometry(page: Page) {
  return page.evaluate(() => {
    const box = (query: string) =>
      document
        .querySelector(query)!
        .getBoundingClientRect()
        .toJSON() as DOMRect;
    const sidebar = document.querySelector("#v2-sidebar")!;
    const main = document.querySelector("main.v2-main")!;
    return {
      mode: sidebar.getAttribute("data-mode"),
      sidebar: sidebar.getBoundingClientRect().width,
      sidebarShown: getComputedStyle(sidebar).visibility === "visible",
      band: box(".v2-band"),
      topbar: box(".v2-topbar"),
      head: box(".v2-page-head"),
      sheet:
        main.getBoundingClientRect().top +
        parseFloat(getComputedStyle(main, "::before").top),
      view: box(".v2-view").top,
    };
  });
}

test("frame geometry is fixed per breakpoint", async ({ page }) => {
  test.setTimeout(360_000);
  for (const width of WIDTHS) {
    const size = sizeOf(width);
    await test.step(label(size), async () => {
      await start(page, size);
      const want = frameOf(size);
      for (const name of PAGES) {
        await visit(page, name);
        const got = await frameGeometry(page);
        const where = `${name} at ${label(size)}`;
        expect(got.mode, `${where}, sidebar mode`).toBe(want.mode);
        if (want.mode === "drawer")
          expect(got.sidebarShown, `${where}, the closed drawer shows`).toBe(
            false,
          );
        else expectSame(got.sidebar, want.sidebar, `${where}, sidebar width`);
        expectSame(got.band.top, want.band.top, `${where}, band top`);
        expectSame(got.band.height, want.band.height, `${where}, band height`);
        expectSame(got.topbar.top, want.topbar.top, `${where}, topbar top`);
        expectSame(
          got.topbar.height,
          want.topbar.height,
          `${where}, topbar height`,
        );
        expectSame(got.head.top, want.head.top, `${where}, page header top`);
        expectSame(
          got.head.height,
          want.head.height,
          `${where}, page header height`,
        );
        expectSame(got.sheet, want.sheet, `${where}, sheet top`);
        expectSame(got.view, want.sheet, `${where}, content top`);
      }
    });
  }
});

// The frame's targets by region and name: every shown link and button of
// the sidebar (outside closed groups), the topbar's links, buttons and the
// demo pill, and the tabs. The theme button is one target in both themes.
const TARGETS: [string, string][] = [
  ["sidebar", "#v2-sidebar :is(a, button)"],
  ["topbar", ".v2-topbar :is(a, button, .v2-pill)"],
  ["tabbar", ".v2-tabbar .v2-tab"],
];
async function frameBoxes(page: Page): Promise<Record<string, Box>> {
  return page.evaluate((targets) => {
    const boxes: Record<string, Box> = {};
    const name = (element: Element) =>
      (
        element.getAttribute("aria-label") ??
        element.querySelector(".v2-nav-text, .v2-tab-label")?.textContent ??
        element.textContent ??
        ""
      )
        .trim()
        .replace(/^(Light|Dark) theme$/, "theme")
        .replace(/^Tools, \d+ open jobs$/, "jobs");
    for (const [region, query] of targets)
      for (const element of document.querySelectorAll(query)) {
        if (
          element.closest("[inert]") ||
          !element.checkVisibility({ visibilityProperty: true })
        )
          continue;
        const { x, y, width, height } = element.getBoundingClientRect();
        if (!width || !height) continue;
        boxes[`${region} ${element.tagName.toLowerCase()} "${name(element)}"`] =
          { x, y, width, height };
      }
    return boxes;
  }, TARGETS);
}

// Every target of `base` is still there, in the same box. With `topbar`
// the topbar's targets are compared relative to the topbar (it is sticky).
function boxChanges(
  base: Record<string, Box>,
  now: Record<string, Box>,
  topbar?: { base: Box; now: Box },
): string[] {
  const changes: string[] = [];
  for (const [key, box] of Object.entries(base)) {
    const other = now[key];
    if (!other) {
      changes.push(`${key} is gone`);
      continue;
    }
    const shift =
      topbar && key.startsWith("topbar ")
        ? { x: topbar.now.x - topbar.base.x, y: topbar.now.y - topbar.base.y }
        : { x: 0, y: 0 };
    for (const side of ["x", "y", "width", "height"] as const) {
      const moved =
        other[side] - (side === "x" || side === "y" ? shift[side] : 0);
      if (Math.abs(moved - box[side]) > TOLERANCE)
        changes.push(`${key} ${side}: ${box[side]} → ${moved}`);
    }
  }
  return changes;
}

test("nothing in the frame moves between pages or states", async ({ page }) => {
  test.setTimeout(240_000);
  const views: View[] = [
    "dashboard",
    "movies",
    "series",
    "mux",
    "placement",
    "files",
    "settings",
    "dashboard",
  ];
  for (const size of [wide, desktop, phone]) {
    await test.step(label(size), async () => {
      await start(page, size);
      const base = await frameBoxes(page);
      expect(Object.keys(base).length).toBeGreaterThan(5);
      const same = async (what: string) =>
        expect(
          boxChanges(base, await frameBoxes(page)),
          `${what} at ${label(size)}`,
        ).toEqual([]);

      for (const view of views) {
        await goTo(page, view);
        await same(`the ${view} page`);
      }

      // Theme and band change colors only.
      const theme = page
        .getByRole("banner")
        .getByRole("button", { name: /^(Light|Dark) theme$/ });
      await theme.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await same("the light theme");
      await theme.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      for (const band of ["strong", "muted"]) {
        await page.evaluate((value) => {
          document.documentElement.dataset.band = value;
        }, band);
        await same(`the ${band} band`);
      }

      // A flyout (rail) and a popover open and close over the frame.
      if (size === desktop) {
        const settings = mainNavigation(page).getByRole("button", {
          name: "Settings",
          exact: true,
        });
        await settings.hover();
        await expect(page.locator("#v2-fly")).toHaveAttribute("data-open", "");
        await same("an open flyout");
        await page.mouse.move(0, 0);
        await expect(page.locator("#v2-fly")).not.toHaveAttribute(
          "data-open",
          "",
        );
        await same("a closed flyout");
      }
      const trigger =
        size === phone
          ? mainNavigation(page).getByRole("button", {
              name: "Tools",
              exact: true,
            })
          : page.getByRole("banner").getByRole("button", { name: /open jobs/ });
      await trigger.click();
      await expect(page.locator(".v2-pop")).toBeVisible();
      await same("an open popover");
      await page.keyboard.press("Escape");
      await expect(page.locator(".v2-pop")).toHaveCount(0);
      await same("a closed popover");

      // Scrolling: the sidebar and the tab bar stay; the sticky topbar
      // keeps its size and its targets their place in it.
      await goTo(page, "movies");
      const topbar = await rect(page, ".v2-topbar");
      await page.evaluate(() => window.scrollTo(0, 600));
      await expect(page.locator(".v2-topbar")).toHaveAttribute(
        "data-scrolled",
        "",
      );
      const scrolled = await rect(page, ".v2-topbar");
      expectSame(scrolled.width, topbar.width, "scrolled topbar width");
      expectSame(scrolled.height, topbar.height, "scrolled topbar height");
      expect(
        boxChanges(base, await frameBoxes(page), {
          base: topbar,
          now: scrolled,
        }),
        `600px scroll at ${label(size)}`,
      ).toEqual([]);
    });
  }
});

// Recorded from the first script on: the frame's targets when .v2-nav first
// appears (a MutationObserver), and in every animation frame from then on
// whether the page header is there and where the frame stands.
async function recordFirstPaint(page: Page) {
  await page.addInitScript(() => {
    type Record = { [key: string]: [number, number, number, number] };
    const w = window as unknown as {
      __firstNav?: Record;
      __frames?: { at: number; head: boolean; boxes: Record }[];
    };
    const read = (): Record => {
      const boxes: Record = {};
      const add = (key: string, element: Element | null) => {
        if (!element) return;
        const { x, y, width, height } = element.getBoundingClientRect();
        boxes[key] = [x, y, width, height];
      };
      document
        .querySelectorAll(
          "#v2-sidebar :is(a, button), .v2-topbar :is(a, button), .v2-tabbar .v2-tab",
        )
        .forEach((element, index) => add(`target ${index}`, element));
      add("page slot", document.querySelector(".v2-page-slot"));
      add("view", document.querySelector(".v2-view"));
      add("page header", document.querySelector(".v2-page-head"));
      add("h1", document.querySelector("main h1"));
      return boxes;
    };
    w.__frames = [];
    const observer = new MutationObserver(() => {
      if (w.__firstNav || !document.querySelector(".v2-nav")) return;
      w.__firstNav = read();
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
    const frame = () => {
      if (document.querySelector(".v2-nav"))
        w.__frames!.push({
          at: performance.now(),
          head: !!document.querySelector(".v2-page-head"),
          boxes: read(),
        });
      if (w.__frames!.length < 90) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

// Loads `hash` fresh at `size` and compares what recordFirstPaint saw with
// the settled frame: no target, slot, view (top, width), page header or
// h1 moves, and no target appears or leaves after the first paint. Returns
// the index of the first frame with the page header.
async function checkFirstPaint(
  page: Page,
  size: Size,
  hash: string,
  heading: string,
) {
  await start(page, size, hash);
  await expect(
    page.getByRole("heading", { level: 1, name: heading }),
  ).toBeVisible();
  const { first, frames, final } = await page.evaluate(() => {
    const w = window as unknown as {
      __firstNav: Record<string, number[]>;
      __frames: {
        at: number;
        head: boolean;
        boxes: Record<string, number[]>;
      }[];
    };
    const final: Record<string, number[]> = {};
    const add = (key: string, element: Element | null) => {
      if (!element) return;
      const { x, y, width, height } = element.getBoundingClientRect();
      final[key] = [x, y, width, height];
    };
    document
      .querySelectorAll(
        "#v2-sidebar :is(a, button), .v2-topbar :is(a, button), .v2-tabbar .v2-tab",
      )
      .forEach((element, index) => add(`target ${index}`, element));
    add("page slot", document.querySelector(".v2-page-slot"));
    add("view", document.querySelector(".v2-view"));
    add("page header", document.querySelector(".v2-page-head"));
    add("h1", document.querySelector("main h1"));
    return { first: w.__firstNav, frames: w.__frames, final };
  });
  const where = `${hash || "#/"} at ${label(size)}`;
  expect(first, `${where}: the navigation never appeared`).toBeTruthy();
  const targets = (boxes: Record<string, number[]>) =>
    Object.keys(boxes).filter((key) => key.startsWith("target ")).length;
  const moved = (boxes: Record<string, number[]>, when: string) => [
    ...(targets(boxes) === targets(final)
      ? []
      : [`${when}: ${targets(boxes)} targets, settled ${targets(final)}`]),
    ...Object.entries(boxes)
      .filter(([key, box]) =>
        final[key]
          ? // The view grows with its content; its top and width stay.
            box.some(
              (value, i) =>
                (key !== "view" || i !== 3) &&
                Math.abs(value - final[key][i]) > 0.5,
            )
          : key !== "page header" && key !== "h1",
      )
      .map(([key, box]) => `${when}: ${key} ${box} → ${final[key]}`),
  ];
  expect(moved(first, "first navigation"), where).toEqual([]);
  expect(frames.length, `${where}: no frame was recorded`).toBeGreaterThan(0);
  expect(
    frames.flatMap((frame, index) => moved(frame.boxes, `frame ${index}`)),
    where,
  ).toEqual([]);
  const late = frames.findIndex((frame) => frame.head);
  expect(
    late,
    `${where}: the page header never painted`,
  ).toBeGreaterThanOrEqual(0);
  return { late, ms: Math.round(frames[late].at - frames[0].at), where };
}

test("the frame does not move after its first paint", async ({ page }) => {
  // Eager pages paint their header with the frame; lazy pages (tools,
  // settings) may show the band without a title until their chunk arrives.
  const entries = [
    { hash: "", heading: "Dashboard", lazy: false },
    { hash: "#/movies", heading: "Movie library", lazy: false },
    { hash: "#/tools/mux", heading: "Muxing", lazy: true },
    { hash: "#/settings/connections", heading: "Settings", lazy: true },
  ];
  await recordFirstPaint(page);
  for (const size of [desktop, phone]) {
    for (const entry of entries) {
      await test.step(`${entry.hash || "#/"} at ${label(size)}`, async () => {
        const { late, ms, where } = await checkFirstPaint(
          page,
          size,
          entry.hash,
          entry.heading,
        );
        if (!entry.lazy)
          expect(late, `${where}: the page header painted late`).toBe(0);
        else
          test.info().annotations.push({
            type: "late page header",
            description: `${where}: the band showed no title for ${late} frame(s), ${ms} ms`,
          });
      });
    }
  }
  // E12: instance sub-entries come with the settings. With two enabled
  // movie instances and the settings answer 300 ms late, the frame still
  // paints once, with the Movies group, its arrow and sub-entries.
  await test.step("late settings with two movie instances", async () => {
    await withTwoMovieInstances(page);
    await page.route(/\/api\/settings$/, async (route) => {
      await new Promise((done) => setTimeout(done, 300));
      await route.fallback();
    });
    for (const size of [wide, desktop, phone]) {
      const { late, where } = await checkFirstPaint(
        page,
        size,
        "#/movies",
        "Movie library",
      );
      expect(late, `${where}: the page header painted late`).toBe(0);
      // In the DOM in every mode (the rail and the closed drawer hide it).
      await expect(
        page.locator("#v2-sidebar .v2-nav-sub", { hasText: "Radarr 4K" }),
      ).toHaveCount(1);
    }
  });
});

test("scrolling turns the topbar into glass in place", async ({ page }) => {
  for (const size of [desktop, phone]) {
    await test.step(label(size), async () => {
      await start(page, size, "#/movies");
      const topbar = page.locator(".v2-topbar");
      const parts = () =>
        topbar.evaluate((bar) => {
          const outer = bar.getBoundingClientRect();
          return {
            width: outer.width,
            height: outer.height,
            top: outer.top,
            inner: [...bar.querySelectorAll("a, button, .v2-pill, .v2-crumbs")]
              .filter((element) => element.checkVisibility())
              .map((element) => {
                const box = element.getBoundingClientRect();
                return [
                  box.x - outer.x,
                  box.y - outer.y,
                  box.width,
                  box.height,
                ];
              }),
          };
        });
      const flat = await parts();
      const scrollTo = async (y: number) => {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y);
      };
      await scrollTo(4);
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => done(0))),
      );
      await expect(topbar).not.toHaveAttribute("data-scrolled", "");
      for (const y of [5, 16, 600]) {
        await scrollTo(y);
        await expect(topbar).toHaveAttribute("data-scrolled", "");
        const glass = await parts();
        const where = `topbar at scroll ${y}, ${label(size)}`;
        expectSame(glass.width, flat.width, `${where}, width`);
        expectSame(glass.height, flat.height, `${where}, height`);
        expect(glass.inner.length, `${where}, parts`).toBe(flat.inner.length);
        glass.inner.forEach((box, index) =>
          box.forEach((value, side) =>
            expectSame(
              value,
              flat.inner[index][side],
              `${where}, part ${index}`,
            ),
          ),
        );
      }
      // Sticky at the bar gap: 8 (phones 6), after 16px (phones 0) of
      // scrolling with the page.
      expectSame(
        (await parts()).top,
        size === phone ? 6 : 8,
        `stuck topbar top at ${label(size)}`,
      );
    });
  }
});

test("a page change scrolls to the top", async ({ page }) => {
  await start(page, desktop);
  await goTo(page, "movies");
  // The document stays taller than the scroll position while the page
  // changes, so only the frame's own scroll can bring it back to 0 (not a
  // shorter page that clamps it).
  await page.evaluate(() => {
    document.documentElement.style.minHeight = "6000px";
  });
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);
  await mainNavigation(page)
    .getByRole("link", { name: "TV series", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "TV library" }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await settle(page);

  // A filter or a sort replaces the route of the same page: the position
  // stays. Both change the page by script, so nothing scrolls an element
  // into view.
  const main = page.getByRole("main");
  const changes: [string, () => Promise<unknown>][] = [
    [
      "filter",
      () =>
        main
          .getByPlaceholder("Series, episode or file …", { exact: true })
          .evaluate((field: HTMLInputElement) => {
            field.value = "Dark";
            field.dispatchEvent(new Event("input", { bubbles: true }));
          }),
    ],
    [
      "sort",
      () =>
        main
          .getByRole("button", { name: /^Sort by Year/ })
          .first()
          .evaluate((button: HTMLElement) => button.click()),
    ],
  ];
  for (const [what, change] of changes) {
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);
    const hash = await currentHash(page);
    await change();
    await expect
      .poll(() => currentHash(page), {
        message: `the ${what} reached the route`,
      })
      .not.toBe(hash);
    // The list request starts and ends; settle() would scroll to the top.
    await networkQuiet(page);
    expect(
      await page.evaluate(() => window.scrollY),
      `scroll position after the ${what}`,
    ).toBe(300);
  }
});

// Sideways overflow of every page at `widths` with the stored sidebar
// choice `mode` (the drawer below 740 whatever was stored).
async function checkOverflow(
  page: Page,
  mode: "expanded" | "rail",
  widths: number[],
  views: View[],
  sections: readonly (typeof settingsSections)[number][],
) {
  await preferSidebar(page, mode);
  await start(page, desktop);
  const check = async (where: string) => {
    for (const width of widths) {
      const size = sizeOf(width);
      await page.setViewportSize(size);
      await expect
        .poll(() => pageOverflowX(page), {
          message: `${where} at ${label(size)} (${mode}) scrolls sideways`,
          timeout: 3000,
        })
        .toBeLessThanOrEqual(0);
    }
    await page.setViewportSize(desktop);
    await expect(page.locator("#v2-sidebar")).toHaveAttribute(
      "data-mode",
      mode,
    );
  };
  for (const view of views) {
    await goTo(page, view);
    await check(view);
  }
  if (!sections.length) return;
  await goTo(page, "settings");
  for (const section of sections) {
    await settingsSection(page, section);
    await check(`Settings → ${section}`);
  }
}
const LIST_VIEWS: View[] = ["movies", "series", "mux", "placement", "files"];

// Both stored choices at every width; a stored expanded sidebar below 900
// is the target below.
test("no horizontal page overflow from 320 to 1600", async ({ page }) => {
  test.setTimeout(360_000);
  for (const mode of ["rail", "expanded"] as const)
    await test.step(`sidebar ${mode}`, () =>
      checkOverflow(
        page,
        mode,
        WIDTHS.filter(
          (width) => mode === "rail" || width < 740 || width >= 900,
        ),
        ["dashboard", ...LIST_VIEWS],
        settingsSections,
      ));
});

// Owner: Phase 5a (FilterBar), which turns this on. With a stored expanded
// sidebar at 740 to 899 the 1.7.0 filter panel gets 432 to 591px, and its
// icon tools stick out of the page (820: 39px, 740: 119px on all five list
// and tool pages; 900 and up and the rail at every width are clean). E8
// keeps the stored choice from 740 (Task 10 ruling).
test.fixme("no horizontal page overflow with a stored expanded sidebar below 900", async ({
  page,
}) => {
  await checkOverflow(page, "expanded", [820, 740], LIST_VIEWS, []);
});

test("legacy content starts on the transition sheet", async ({ page }) => {
  test.setTimeout(240_000);
  for (const size of [desktop, sizeOf(820), phone]) {
    await test.step(label(size), async () => {
      await start(page, size);
      const check = async (where: string) => {
        const problems = await page.evaluate(() => {
          const main = document.querySelector("main.v2-main")!;
          const view = main.querySelector(".v2-view")!;
          const sheet =
            main.getBoundingClientRect().top +
            parseFloat(getComputedStyle(main, "::before").top);
          const found: string[] = [];
          const first = view.firstElementChild;
          if (!first) found.push("the page has no content");
          else if (first.getBoundingClientRect().top < sheet - 0.5)
            found.push(
              `the content starts at ${first.getBoundingClientRect().top}, above the sheet at ${sheet}`,
            );
          // No text of the page stands above the sheet, on the band.
          // Visually hidden text (a 1px clipped box, such as .sr-only) is
          // not drawn.
          const hidden = (element: Element | null) => {
            for (let at = element; at && at !== view; at = at.parentElement) {
              const box = at.getBoundingClientRect();
              const style = getComputedStyle(at);
              if (
                (box.width <= 1 || box.height <= 1) &&
                (style.overflow !== "visible" || style.clipPath !== "none")
              )
                return true;
            }
            return false;
          };
          const walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = (node as Text).data.trim();
            if (!text || hidden(node.parentElement)) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const box of range.getClientRects())
              if (box.width && box.height && box.top < sheet - 0.5)
                found.push(`"${text.slice(0, 30)}" at ${box.top}`);
          }
          // The band between the topbar and the sheet (behind the page
          // header) shows no part of the page.
          const band = document
            .querySelector(".v2-band")!
            .getBoundingClientRect();
          const topbar = document
            .querySelector(".v2-topbar")!
            .getBoundingClientRect();
          for (let y = topbar.bottom + 2; y < sheet - 1; y += 8)
            for (let x = band.left + 4; x < band.right - 4; x += 24) {
              const hit = document.elementFromPoint(x, y);
              if (hit && view.contains(hit))
                found.push(
                  `band point ${x},${y} shows ${hit.tagName} ${hit.getAttribute("class")}`,
                );
            }
          return found;
        });
        expect(problems, `${where} at ${label(size)}`).toEqual([]);
      };
      for (const view of [
        "dashboard",
        "movies",
        "series",
        "mux",
        "placement",
        "files",
      ] as View[]) {
        await goTo(page, view);
        await check(view);
      }
      await goTo(page, "settings");
      for (const section of settingsSections) {
        await settingsSection(page, section);
        await check(`Settings → ${section}`);
      }
    });
  }
});

test("toasts stay clear of the tab bar", async ({ page }) => {
  for (const size of [phone, sizeOf(320)]) {
    await test.step(label(size), async () => {
      await start(page, size);
      await page.evaluate(() => {
        for (const [message, kind] of [
          ["Sync completed · Radarr", "success"],
          ["Sync failed · The service did not answer in time", "error"],
          ["Settings saved", "success"],
          ["Could not add the new default tag rules: disk full", "error"],
        ])
          window.dispatchEvent(
            new CustomEvent("scopearr-notification", {
              detail: { message, kind },
            }),
          );
      });
      const toasts = page.locator(".toast");
      await expect(toasts).toHaveCount(4);
      const bar = await rect(page, ".v2-tabbar");
      for (const box of await toasts.evaluateAll((list) =>
        list.map((toast) => toast.getBoundingClientRect().toJSON() as DOMRect),
      ))
        expect(
          box.bottom <= bar.top || box.top >= bar.bottom,
          `a toast (${box.top}–${box.bottom}) covers the tab bar (${bar.top}–${bar.bottom})`,
        ).toBe(true);
    });
  }
});

// The rail's tiles: the five icons of a fast click run, their centers.
async function railCenters(page: Page) {
  const nav = mainNavigation(page);
  const icons = [
    nav.getByRole("link", { name: "Dashboard", exact: true }),
    nav.getByRole("link", { name: "Movies", exact: true }),
    nav.getByRole("link", { name: "TV series", exact: true }),
    nav.getByRole("link", { name: "Muxing", exact: true }),
    nav.getByRole("button", { name: "Settings", exact: true }),
  ];
  const centers = [];
  for (const icon of icons) {
    const box = (await icon.boundingBox())!;
    centers.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  return centers;
}

async function sidebarColumn(page: Page) {
  return page.evaluate(() => {
    const sidebar = document.querySelector("#v2-sidebar")!;
    const inner = sidebar.querySelector(".v2-sidebar-inner")!;
    const toggle = sidebar.querySelector(".v2-nav-toggle")!;
    return {
      width: sidebar.getBoundingClientRect().width,
      scroll: [sidebar.scrollLeft, inner.scrollLeft],
      tiles: [...sidebar.querySelectorAll(".v2-nav-item .v2-tile")].map(
        (tile) => tile.getBoundingClientRect().x,
      ),
      toggle: toggle.getBoundingClientRect().toJSON() as DOMRect,
    };
  });
}

test("the rail never scrolls sideways", async ({ page }) => {
  await page.setViewportSize(desktop);
  for (const motion of ["reduce", "no-preference"] as const) {
    await test.step(`reduced motion: ${motion}`, async () => {
      await page.emulateMedia({ reducedMotion: motion });
      await openApp(page);
      const centers = await railCenters(page);
      for (let click = 0; click < 10; click++) {
        const { x, y } = centers[click % centers.length];
        await page.mouse.click(x, y);
      }
      await page.mouse.move(0, 0);
      await settle(page);
      const column = await sidebarColumn(page);
      expectSame(column.width, 72, `rail width (${motion})`);
      expect(column.scroll, `rail scrollLeft (${motion})`).toEqual([0, 0]);
      for (const x of column.tiles) expectSame(x, 36, `tile x (${motion})`);
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });

  // The tiles stay in one column and the toggle in its place in both modes.
  const rail = await sidebarColumn(page);
  await page
    .locator("#v2-sidebar")
    .getByRole("button", { name: "Expand navigation", exact: true })
    .click();
  await expect(page.locator("#v2-sidebar")).toHaveAttribute(
    "data-mode",
    "expanded",
  );
  await page.mouse.move(0, 0);
  const expanded = await sidebarColumn(page);
  for (const x of expanded.tiles) expectSame(x, 36, "tile x (expanded)");
  expectSame(expanded.toggle.x, rail.toggle.x, "toggle x");
  expectSame(expanded.toggle.y, rail.toggle.y, "toggle y");
  expectSame(expanded.toggle.height, rail.toggle.height, "toggle height");
});

// Longer than the flyout's open (150) and close (220) delays together.
const FLYOUT_WAIT = 400;
const fly = (page: Page) => page.locator("#v2-fly");
const isOpen = (page: Page) =>
  expect(fly(page)).toHaveAttribute("data-open", "");
const isClosed = (page: Page) =>
  expect(fly(page)).not.toHaveAttribute("data-open", "");
const active = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return "body";
    return (
      element.getAttribute("aria-label") ||
      element.textContent?.trim() ||
      element.tagName
    );
  });

// Presses Tab until `target` has focus, at most `limit` times. A target in
// the sidebar is reached from the skip control, the element before it.
async function tabTo(page: Page, target: Locator, limit = 40) {
  if (
    await target.evaluate(
      (element) =>
        !!element.closest("#v2-sidebar") &&
        !document
          .querySelector("#v2-sidebar")!
          .contains(document.activeElement),
    )
  )
    await page.locator(".v2-skip").focus();
  for (let step = 0; step < limit; step++) {
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${target}`);
}

// A fresh context with a touch screen and the project's sign-in.
async function touchPage(
  browser: Browser,
  size: Size,
  { isMobile = false } = {},
): Promise<Page> {
  const { baseURL, storageState, locale } = test.info().project.use;
  const context = await browser.newContext({
    baseURL,
    storageState,
    locale,
    viewport: size,
    hasTouch: true,
    isMobile,
    reducedMotion: "reduce",
  });
  return context.newPage();
}

test("the rail flyout follows keyboard, pointer and touch", async ({
  page,
  browser,
}) => {
  await page.clock.install();
  await start(page, desktop);
  const nav = mainNavigation(page);
  const settings = nav.getByRole("button", { name: "Settings", exact: true });
  const movies = nav.getByRole("link", { name: "Movies", exact: true });
  const center = async (target: Locator) => {
    const box = (await target.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  await test.step("pointer: 150 ms peek, switch at once, 220 ms bridge", async () => {
    await page.clock.pauseAt(Date.now() + 2000);
    // The page's first flyout closes on a press right after it opened.
    await settings.click();
    await isOpen(page);
    await page.mouse.click(700, 600);
    await isClosed(page);
    const tile = await center(settings);
    await page.mouse.move(tile.x, tile.y);
    await page.clock.runFor(149);
    await isClosed(page);
    await page.clock.runFor(1);
    await isOpen(page);
    await expect(fly(page)).toHaveAttribute("role", "group");
    // Another entry switches without a delay.
    const film = await center(movies);
    await page.mouse.move(film.x, film.y);
    await expect(fly(page)).toHaveText("Movies");
    await isOpen(page);
    // Leaving closes after 220 ms.
    await page.mouse.move(600, 500);
    await page.clock.runFor(219);
    await isOpen(page);
    await page.clock.runFor(1);
    await isClosed(page);
    // The bridge: from the entry across the gap into the flyout, it stays.
    await page.mouse.move(tile.x, tile.y);
    await page.clock.runFor(150);
    await isOpen(page);
    const panel = (await fly(page).boundingBox())!;
    for (const x of [tile.x + 20, tile.x + 32, panel.x + 2, panel.x + 40])
      await page.mouse.move(x, tile.y);
    await page.clock.runFor(1000);
    await isOpen(page);
    // A press outside closes at once.
    await page.mouse.click(700, 600);
    await isClosed(page);
  });

  await test.step("pointer: a resize closes; mouse focus does not open", async () => {
    await settings.click();
    await isOpen(page);
    await page.setViewportSize({ width: 1439, height: 900 });
    await isClosed(page);
    await page.setViewportSize(desktop);
    // Mouse focus is no keyboard focus: a press on Settings focuses it
    // without :focus-visible, and nothing opens, before any time passes
    // (the clock stands) and after the open delay. The press ends away
    // from the entry, so there is no click and no hover to open it.
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    expect(await active(page)).toBe("body");
    const at = await center(settings);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    expect(await active(page)).toBe("Settings");
    await isClosed(page);
    await page.mouse.move(700, 600);
    await page.mouse.up();
    await isClosed(page);
    await page.clock.runFor(FLYOUT_WAIT);
    expect(await active(page)).toBe("Settings");
    await isClosed(page);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  });
  await page.clock.resume();

  await test.step("keyboard: →, Enter and Space open, keys move, ← and Escape return", async () => {
    await openRoute(page, "#/settings/appearance");
    await page.mouse.move(700, 600);
    await tabTo(page, settings);
    await isOpen(page);
    const current = fly(page).locator('a[aria-current="page"]');
    const items = fly(page).locator(".v2-fly-item");
    const name = (index: number) => items.nth(index);
    for (const key of ["ArrowRight", "Enter", "Space"]) {
      await page.keyboard.press(key);
      await expect(current).toBeFocused();
      await expect(current).toHaveText("Display");
      // ↓, ↑, End, Home and the wrap at both ends.
      await page.keyboard.press("ArrowDown");
      await expect(name(2)).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(current).toBeFocused();
      await page.keyboard.press("End");
      await expect(name(5)).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(name(0)).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(name(5)).toBeFocused();
      await page.keyboard.press("Home");
      await expect(name(0)).toBeFocused();
      // ← for →, Escape for Enter and Space: back to the entry, closed.
      await page.keyboard.press(key === "ArrowRight" ? "ArrowLeft" : "Escape");
      await expect(settings).toBeFocused();
      await isClosed(page);
      await page.waitForTimeout(400);
      await isClosed(page);
    }
  });

  await test.step("touch: the first tap opens a group, the second navigates", async () => {
    const touch = await touchPage(browser, desktop);
    await withTwoMovieInstances(touch);
    await openApp(touch);
    const group = mainNavigation(touch).getByRole("link", {
      name: "Movies",
      exact: true,
    });
    await group.tap();
    await expect(fly(touch)).toHaveAttribute("data-open", "");
    await expect(fly(touch)).toHaveAttribute("aria-label", "Movies");
    expect(await currentHash(touch)).toBe("#/dashboard");
    await group.tap();
    await expect(
      touch.getByRole("heading", { level: 1, name: "Movie library" }),
    ).toBeVisible();
    await expect(fly(touch)).not.toHaveAttribute("data-open", "");
    await touch.context().close();
  });
});

test("a rail flyout sits at its entry inside the sidebar card", async ({
  page,
}) => {
  await start(page, desktop);
  const nav = mainNavigation(page);
  const settings = nav.getByRole("button", { name: "Settings", exact: true });
  // A group starts at its entry's top − 4.
  await settings.click();
  await isOpen(page);
  let entry = (await settings.boundingBox())!;
  let panel = (await fly(page).boundingBox())!;
  expectSame(panel.y, entry.y - 4, "Settings flyout top");
  await page.keyboard.press("Escape");
  await isClosed(page);

  // A label is centered on its entry.
  const dashboard = nav.getByRole("link", { name: "Dashboard", exact: true });
  await dashboard.hover();
  await isOpen(page);
  await expect(fly(page)).toHaveText("Dashboard");
  entry = (await dashboard.boundingBox())!;
  panel = (await fly(page).boundingBox())!;
  expectSame(
    panel.y + panel.height / 2,
    entry.y + entry.height / 2,
    "label flyout center",
  );
  await page.mouse.move(700, 600);
  await isClosed(page);

  // In a short viewport the group moves up and ends inside the card.
  await page.setViewportSize({ width: 1440, height: 560 });
  await settings.scrollIntoViewIfNeeded();
  await settings.click();
  await isOpen(page);
  entry = (await settings.boundingBox())!;
  panel = (await fly(page).boundingBox())!;
  const card = await rect(page, "#v2-sidebar");
  expect(panel.y, "the flyout moved up").toBeLessThan(entry.y - 4);
  expect(panel.y, "flyout top inside the card").toBeGreaterThanOrEqual(
    card.top - TOLERANCE,
  );
  expect(
    panel.y + panel.height,
    "flyout bottom inside the card",
  ).toBeLessThanOrEqual(card.bottom + TOLERANCE);
  expectSame(panel.y + panel.height, card.bottom - 4, "flyout bottom");
});

test("Tab leaves every rail flyout in the rail's order", async ({ page }) => {
  await withTwoMovieInstances(page);
  await start(page, desktop);
  const nav = mainNavigation(page);
  const link = (name: string) => nav.getByRole("link", { name, exact: true });
  const settings = nav.getByRole("button", { name: "Settings", exact: true });
  const toggle = page.locator("#v2-sidebar").getByRole("button", {
    name: "Expand navigation",
    exact: true,
  });
  await page.mouse.move(700, 600);
  // The groups: Movies (two instances, its arrow is not rendered in the
  // rail) and Settings, the last entry before the toggle.
  for (const [entry, next] of [
    [link("Movies"), link("TV series")],
    [settings, toggle],
  ] as const) {
    for (const backward of [false, true]) {
      await tabTo(page, entry);
      await isOpen(page);
      await page.keyboard.press("ArrowRight");
      await expect(fly(page).locator("a").first()).toBeVisible();
      expect(
        await fly(page).evaluate((panel) =>
          panel.contains(document.activeElement),
        ),
        "focus is in the flyout",
      ).toBe(true);
      await page.keyboard.press(backward ? "Shift+Tab" : "Tab");
      await expect(backward ? entry : next).toBeFocused();
      // The group closed; the next entry may show its own label.
      if (!backward)
        await expect(fly(page)).not.toHaveAttribute("role", "group");
      await page.keyboard.press("Escape");
      await page.locator("main").focus();
      await isClosed(page);
    }
  }
  // Out of the rail: from the toggle into the topbar, nothing stays open.
  await tabTo(page, toggle);
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest(".v2-topbar")),
    "focus moved on to the topbar",
  ).toBe(true);
  await isClosed(page);
});

// The focused element inside `region`, and where its focus ring (outline
// plus offset) is cut off by an ancestor that clips or by the viewport;
// null when focus is elsewhere.
function focusedRing(region: string) {
  const element = document.activeElement;
  if (!element || !element.closest(region)) return null;
  const name =
    element.getAttribute("aria-label") ||
    element.textContent?.trim() ||
    element.tagName;
  const style = getComputedStyle(element);
  if (!element.matches(":focus-visible"))
    return { name, found: ["not :focus-visible"] };
  if (style.outlineStyle === "none" || !parseFloat(style.outlineWidth))
    return { name, found: ["no focus ring"] };
  const reach =
    parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
  const box = element.getBoundingClientRect();
  const ring = {
    left: box.left - reach,
    top: box.top - reach,
    right: box.right + reach,
    bottom: box.bottom + reach,
  };
  const found: string[] = [];
  for (
    let parent = element.parentElement;
    parent && parent !== document.documentElement;
    parent = parent.parentElement
  ) {
    const clip = getComputedStyle(parent);
    const x = clip.overflowX !== "visible",
      y = clip.overflowY !== "visible";
    if (!x && !y) continue;
    const outer = parent.getBoundingClientRect();
    const margin =
      clip.overflowX === "clip" || clip.overflowY === "clip"
        ? parseFloat(clip.overflowClipMargin) || 0
        : 0;
    const edge = {
      left: outer.left + parseFloat(clip.borderLeftWidth) - margin,
      top: outer.top + parseFloat(clip.borderTopWidth) - margin,
      right: outer.right - parseFloat(clip.borderRightWidth) + margin,
      bottom: outer.bottom - parseFloat(clip.borderBottomWidth) + margin,
    };
    const what = `${parent.tagName.toLowerCase()}.${[...parent.classList].join(".")}`;
    if (x && (ring.left < edge.left - 0.5 || ring.right > edge.right + 0.5))
      found.push(`cut sideways by ${what}`);
    if (y && (ring.top < edge.top - 0.5 || ring.bottom > edge.bottom + 0.5))
      found.push(`cut vertically by ${what}`);
  }
  if (
    ring.left < 0 ||
    ring.top < 0 ||
    ring.right > window.innerWidth ||
    ring.bottom > window.innerHeight
  )
    found.push("cut by the viewport");
  return { name, found };
}

// Moves focus `steps` times with `key` and collects the cut rings of the
// focused elements inside `region`.
async function cutRings(
  page: Page,
  region: string,
  steps: number,
  key = "Tab",
) {
  const cuts: string[] = [];
  const seen = new Set<string>();
  for (let step = 0; step <= steps; step++) {
    const result = await page.evaluate(focusedRing, region);
    if (result) {
      seen.add(result.name);
      for (const cut of result.found) cuts.push(`${result.name}: ${cut}`);
    }
    if (step < steps) await page.keyboard.press(key);
  }
  return { cuts, seen: [...seen] };
}

test("focus rings are never cut off in the frame", async ({ page }) => {
  await withTwoMovieInstances(page);
  await test.step("rail and its flyout", async () => {
    await start(page, desktop, "#/settings/appearance");
    await page.mouse.move(700, 600);
    await tabTo(page, page.getByRole("link", { name: "Scopearr home" }));
    const rail = await cutRings(page, "#v2-sidebar", 12);
    expect(rail.seen).toEqual(
      expect.arrayContaining(["Scopearr home", "Dashboard", "Settings"]),
    );
    expect(rail.cuts, "rail").toEqual([]);
    const settings = mainNavigation(page).getByRole("button", {
      name: "Settings",
      exact: true,
    });
    await tabTo(page, settings);
    await page.keyboard.press("ArrowRight");
    const flyout = await cutRings(page, "#v2-fly", 6, "ArrowDown");
    expect(flyout.seen).toEqual(
      expect.arrayContaining(["Services", "Display", "System"]),
    );
    expect(flyout.cuts, "flyout items").toEqual([]);
  });
  await test.step("expanded sidebar with its groups", async () => {
    await preferSidebar(page, "expanded");
    await start(page, desktop, "#/settings/appearance");
    // Settings opens only by its own button; the drawer keeps it open.
    await mainNavigation(page)
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await page.mouse.move(700, 600);
    await tabTo(page, page.getByRole("link", { name: "Scopearr home" }));
    const expanded = await cutRings(page, "#v2-sidebar", 22);
    expect(expanded.seen).toEqual(
      expect.arrayContaining(["Radarr 4K", "Instances", "Display"]),
    );
    expect(expanded.cuts, "expanded sidebar").toEqual([]);
  });
  await test.step("drawer", async () => {
    await start(page, phone, "#/settings/appearance");
    await mainNavigation(page)
      .getByRole("button", { name: "More", exact: true })
      .click();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const drawer = await cutRings(page, "#v2-sidebar", 26);
    expect(drawer.seen).toEqual(
      expect.arrayContaining(["Close", "Scopearr home", "Display", "Sign out"]),
    );
    expect(drawer.cuts, "drawer").toEqual([]);
  });
});

test("hiding the focused tool closes its flyout", async ({ page }) => {
  let hidden = false;
  await page.route(/\/api\/status$/, async (route) => {
    const response = await route.fetch();
    const status = await response.json();
    if (hidden) status.mux = { ...status.mux, enabled: false };
    await route.fulfill({ response, json: status });
  });
  await start(page, desktop);
  await page.mouse.move(700, 600);
  const mux = mainNavigation(page).getByRole("link", {
    name: "Muxing",
    exact: true,
  });
  await tabTo(page, mux);
  await isOpen(page);
  await expect(fly(page)).toHaveText("Muxing");
  hidden = true;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("scopearr:unauthorized")),
  );
  await expect(mux).toHaveCount(0);
  await isClosed(page);
  // The machine is not stuck on the gone entry: a hover opens as usual.
  await mainNavigation(page)
    .getByRole("link", { name: "Dashboard", exact: true })
    .hover();
  await isOpen(page);
  await expect(fly(page)).toHaveText("Dashboard");
});

test("Escape in a native dialog closes the dialog, not the flyout", async ({
  page,
}) => {
  await start(page, desktop);
  const settings = mainNavigation(page).getByRole("button", {
    name: "Settings",
    exact: true,
  });
  await settings.hover();
  await isOpen(page);
  const panel = (await fly(page).boundingBox())!;
  await page.mouse.move(panel.x + 40, panel.y + 12);
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.id = "native";
    dialog.innerHTML = "<p>A native dialog</p><button>OK</button>";
    document.body.append(dialog);
    dialog.showModal();
  });
  await expect(page.locator("#native")).toBeVisible();
  await isOpen(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("#native")).toBeHidden();
  expect(
    await page.locator("#native").evaluate((d: HTMLDialogElement) => d.open),
  ).toBe(false);
  await isOpen(page);
});

test("the drawer traps focus and returns it", async ({ page }) => {
  await withTwoMovieInstances(page);
  await start(page, phone, "#/movies");
  const sidebar = page.locator("#v2-sidebar");
  const more = mainNavigation(page).getByRole("button", {
    name: "More",
    exact: true,
  });
  const drawer = page.getByRole("dialog", { name: "Main navigation" });
  const inDrawer = () =>
    page.evaluate(() => !!document.activeElement?.closest("#v2-sidebar"));

  await test.step("a closed drawer takes no focus", async () => {
    for (let step = 0; step < 30; step++) {
      await page.keyboard.press("Tab");
      expect(await inDrawer(), `Tab ${step + 1}`).toBe(false);
    }
    expect(
      await sidebar.evaluate((root) => {
        const link = root.querySelector("a")!;
        link.focus();
        return document.activeElement === link;
      }),
      "a script focuses a closed drawer's link",
    ).toBe(false);
  });

  await test.step("open: modal over the topbar and the tab bar, focus on Close", async () => {
    await more.click();
    await expect(drawer).toBeVisible();
    await expect(sidebar).toHaveAttribute("aria-modal", "true");
    await expect(drawer.getByRole("button", { name: "Close" })).toBeFocused();
    const layers = await page.evaluate(() => {
      const z = (query: string) =>
        Number(getComputedStyle(document.querySelector(query)!).zIndex);
      const modal = Number(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--z-modal",
        ),
      );
      const bar = document.querySelector(".v2-tabbar")!.getBoundingClientRect();
      const hit = (x: number, y: number) =>
        document.elementFromPoint(x, y)?.closest("#v2-sidebar, .v2-scrim")
          ?.className ?? "";
      return {
        drawer: z("#v2-sidebar"),
        modal,
        topbar: z(".v2-topbar"),
        tabbar: z(".v2-tabbar"),
        topbarPoint: hit(60, 30),
        besideDrawer: hit(window.innerWidth - 20, 30),
        tabbarPoint: hit(window.innerWidth - 20, bar.top + bar.height / 2),
      };
    });
    expect(layers.drawer, "the drawer's layer").toBe(layers.modal);
    expect(layers.drawer).toBeGreaterThan(layers.topbar);
    expect(layers.drawer).toBeGreaterThan(layers.tabbar);
    expect(layers.topbarPoint).toContain("v2-sidebar");
    expect(layers.besideDrawer).toContain("v2-scrim");
    expect(layers.tabbarPoint).toContain("v2-scrim");
  });

  await test.step("Tab and Shift+Tab stay inside, through head and extras", async () => {
    for (const key of ["Tab", "Shift+Tab"]) {
      const seen = new Set<string>();
      for (let step = 0; step < 25; step++) {
        await page.keyboard.press(key);
        expect(await inDrawer(), `${key} ${step + 1}`).toBe(true);
        seen.add(await active(page));
      }
      expect([...seen], key).toEqual(
        expect.arrayContaining([
          "Close",
          "Scopearr home",
          "Radarr 4K",
          "Light theme",
          "Sign out",
        ]),
      );
      // The sync row of the drawer's head.
      expect(
        [...seen].some((name) => /Synchroni|Last sync|sync/i.test(name)),
        `${key} reaches the sync row (${[...seen].join(", ")})`,
      ).toBe(true);
    }
  });

  const reopen = async () => {
    await more.click();
    await expect(drawer).toBeVisible();
  };
  await test.step("Escape, the scrim, Close and an entry return focus to More", async () => {
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(more).toBeFocused();

    await reopen();
    await page.mouse.click(phone.width - 20, 400);
    await expect(drawer).toBeHidden();
    await expect(more).toBeFocused();

    await reopen();
    await drawer.getByRole("button", { name: "Close" }).click();
    await expect(drawer).toBeHidden();
    await expect(more).toBeFocused();

    await reopen();
    await drawer.getByRole("link", { name: "TV series", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "TV library" }),
    ).toBeVisible();
    await expect(drawer).toBeHidden();
    await expect(more).toBeFocused();
  });

  await test.step("a resize to 740 closes it and returns no focus", async () => {
    await reopen();
    await page.setViewportSize({ width: 740, height: 812 });
    await expect(sidebar).toHaveAttribute("data-mode", "rail");
    await expect(sidebar).not.toHaveAttribute("data-open", "");
    expect(await active(page)).toBe("body");
  });
});

test("a popover closes on Escape or a press outside as soon as it shows", async ({
  page,
}) => {
  await start(page, desktop);
  const bell = page
    .getByRole("banner")
    .getByRole("button", { name: /open jobs/ });
  const pop = page.locator(".v2-pop");
  await bell.click();
  await expect(pop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(bell).toBeFocused();
  await bell.click();
  await expect(pop).toBeVisible();
  await page.mouse.click(700, 600);
  await expect(pop).toHaveCount(0);
  // The tab bar's menu on phones.
  await page.setViewportSize(phone);
  const tools = mainNavigation(page).getByRole("button", {
    name: "Tools",
    exact: true,
  });
  await tools.click();
  await expect(pop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(tools).toBeFocused();
});

test("the tools menu of the tab bar opens the tools", async ({ page }) => {
  await start(page, phone);
  const tools = mainNavigation(page).getByRole("button", {
    name: "Tools",
    exact: true,
  });
  const menu = page.getByRole("menu", { name: "Tools" });
  await tools.click();
  await expect(menu).toBeVisible();
  await expect(tools).toHaveAttribute("aria-expanded", "true");
  const items = menu.getByRole("menuitem");
  await expect(items).toHaveText([
    "Muxing",
    "Disk placement",
    "Files & permissions",
  ]);
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(items.nth(2)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(tools).toBeFocused();

  for (const [name, heading, path] of [
    ["Muxing", "Muxing", "mux"],
    ["Disk placement", "Disk placement", "placement"],
    ["Files & permissions", "Files & permissions", "files"],
  ]) {
    await tools.click();
    await menu.getByRole("menuitem", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: heading, exact: true }),
    ).toBeVisible();
    await expect(menu).toHaveCount(0);
    await expect
      .poll(() => currentHash(page))
      .toMatch(new RegExp(`^#/tools/${path}(\\?|$)`));
    await expect(tools).toHaveAttribute("aria-current", "page");
  }
});

test("long labels fit the tab bar in Spanish and Italian", async ({ page }) => {
  for (const language of ["es", "it"]) {
    await test.step(language, async () => {
      await page.addInitScript((value) => {
        try {
          localStorage.setItem("scopearr-language", value);
        } catch {
          // Storage can be blocked; English is then used.
        }
      }, language);
      for (const size of [phone, sizeOf(320)]) {
        await start(page, size);
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        const labels = await page.locator(".v2-tab").evaluateAll((tabs) =>
          tabs.map((tab) => {
            const text = tab.querySelector(".v2-tab-label")!;
            return {
              text: text.textContent ?? "",
              cut: text.scrollWidth > text.clientWidth,
              ellipsis: getComputedStyle(text).textOverflow === "ellipsis",
              title: tab.getAttribute("title") ?? "",
            };
          }),
        );
        expect(labels.length).toBe(5);
        for (const tab of labels) {
          const where = `"${tab.text}" (${language}) at ${label(size)}`;
          if (size === phone) expect(tab.cut, `${where} is cut`).toBe(false);
          else if (tab.cut) {
            expect(tab.ellipsis, `${where} ends with an ellipsis`).toBe(true);
            expect(tab.title, `${where} has its name as title`).toBe(tab.text);
          }
        }
      }
    });
  }
});

// Links, buttons and the sync controls of the frame that a touch reaches.
async function smallTargets(page: Page, regions: string) {
  return page.evaluate((query) => {
    const small: string[] = [];
    for (const element of document.querySelectorAll(query)) {
      if (
        element.closest("[inert]") ||
        !element.checkVisibility({
          visibilityProperty: true,
          opacityProperty: true,
        })
      )
        continue;
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      // An invisible hit area (::after) may reach 44 for a smaller pill.
      const after = getComputedStyle(element, "::after");
      const area = after.content !== "none" && after.position === "absolute";
      const width = area
        ? Math.max(box.width, parseFloat(after.width) || 0)
        : box.width;
      const height = area
        ? Math.max(box.height, parseFloat(after.height) || 0)
        : box.height;
      if (width < 44 - 0.5 || height < 44 - 0.5)
        small.push(
          `${element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName}: ${box.width}×${box.height}`,
        );
    }
    return small;
  }, regions);
}

test("touch targets reach 44 px on a coarse pointer", async ({ browser }) => {
  const targets =
    "#v2-sidebar :is(a, button), .v2-fly a, .v2-topbar :is(a, button), .v2-tabbar :is(a, button), .v2-pop :is(a, button)";
  await test.step("phone", async () => {
    const page = await touchPage(browser, phone, { isMobile: true });
    await withTwoMovieInstances(page);
    await openApp(page);
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      "a coarse pointer",
    ).toBe(true);
    expect(await smallTargets(page, targets), "topbar and tab bar").toEqual([]);
    await mainNavigation(page)
      .getByRole("button", { name: "Tools", exact: true })
      .tap();
    await expect(page.getByRole("menu", { name: "Tools" })).toBeVisible();
    expect(await smallTargets(page, targets), "tools menu").toEqual([]);
    await page.keyboard.press("Escape");
    await mainNavigation(page)
      .getByRole("button", { name: "More", exact: true })
      .tap();
    const drawer = page.getByRole("dialog", { name: "Main navigation" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: "Settings", exact: true }).tap();
    expect(await smallTargets(page, targets), "drawer").toEqual([]);
    await page.context().close();
  });
  // A tablet in landscape with the rail. Below 900 the sync chip shows only
  // its dot, and its hit area keeps exactly the pill's width (28) so its
  // neighbours never overlap (Part 1, 10.7; the stylesheet guard "topbar
  // pills keep 28px …"); the report of Task 10 lists that as open.
  await test.step("tablet rail", async () => {
    const page = await touchPage(browser, { width: 1024, height: 768 });
    await withTwoMovieInstances(page);
    await openApp(page);
    expect(await smallTargets(page, targets), "rail and topbar").toEqual([]);
    const nav = mainNavigation(page);
    for (const name of ["Movies", "Settings"]) {
      await nav
        .getByRole(name === "Settings" ? "button" : "link", {
          name,
          exact: true,
        })
        .tap();
      await expect(fly(page)).toHaveAttribute("data-open", "");
      expect(await smallTargets(page, targets), `${name} flyout`).toEqual([]);
    }
    await page.context().close();
  });
});

test("the sidebar remembers its mode and groups", async ({ page }) => {
  await withTwoMovieInstances(page);
  await start(page, desktop);
  const sidebar = page.locator("#v2-sidebar");
  const stored = () =>
    page.evaluate(() => ({
      mode: localStorage.getItem("scopearr-sidebar"),
      groups: JSON.parse(
        localStorage.getItem("scopearr-sidebar-groups") ?? "null",
      ),
    }));
  await expect(sidebar).toHaveAttribute("data-mode", "rail");
  expect((await stored()).mode).toBeNull();
  const nav = mainNavigation(page);
  const sidebarButton = (name: string) =>
    sidebar.getByRole("button", { name, exact: true });
  await sidebarButton("Expand navigation").click();
  await expect(sidebar).toHaveAttribute("data-mode", "expanded");
  await nav.getByRole("button", { name: "Settings", exact: true }).click();
  await nav.getByRole("button", { name: "Instances" }).first().click();
  expect(await stored()).toEqual({
    mode: "expanded",
    groups: { movies: false, series: true, settings: true },
  });

  await page.reload();
  await expect(page.locator("main h1")).toBeVisible();
  await expect(sidebar).toHaveAttribute("data-mode", "expanded");
  await expect(
    nav.getByRole("button", { name: "Settings", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    nav.getByRole("button", { name: "Instances" }).first(),
  ).toHaveAttribute("aria-expanded", "false");

  await sidebarButton("Collapse navigation").click();
  await expect(sidebar).toHaveAttribute("data-mode", "rail");
  await page.reload();
  await expect(page.locator("main h1")).toBeVisible();
  await expect(sidebar).toHaveAttribute("data-mode", "rail");
  expect((await stored()).mode).toBe("rail");
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("theme and band are set before the first paint", async ({ page }) => {
    for (const [theme, band, expected] of [
      ["light", null, { theme: "light", band: "strong" }],
      ["light", "muted", { theme: "light", band: "muted" }],
      ["dark", null, { theme: "dark", band: "muted" }],
      ["dark", "strong", { theme: "dark", band: "strong" }],
    ] as const) {
      await test.step(`${theme}, band ${band ?? "default"}`, async () => {
        await page.addInitScript(
          ({ theme, band }) => {
            try {
              localStorage.setItem("scopearr-theme", theme);
              if (band) localStorage.setItem("scopearr-band", band);
              else localStorage.removeItem("scopearr-band");
            } catch {
              // Storage can be blocked; the defaults are then used.
            }
            document.addEventListener("DOMContentLoaded", () => {
              const root = document.documentElement;
              (window as unknown as { __loaded: object }).__loaded = {
                theme: root.dataset.theme,
                band: root.dataset.band,
              };
            });
          },
          { theme, band },
        );
        await page.goto("/");
        await expect(
          page.getByRole("button", { name: "Sign in", exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => (window as unknown as { __loaded: object }).__loaded,
          ),
        ).toEqual(expected);
      });
    }
  });
});

test("links keep the browser's new-tab behavior", async ({ page, context }) => {
  await start(page, desktop);
  const nav = mainNavigation(page);
  const kept = () =>
    page.evaluate(() => (window as Window & { __keep?: number }).__keep);
  await page.evaluate(() => {
    (window as Window & { __keep?: number }).__keep = 1;
  });
  const newTab = async (link: Locator, hash: string, heading: string) => {
    const [tab] = await Promise.all([
      context.waitForEvent("page"),
      link.click({ modifiers: ["ControlOrMeta"] }),
    ]);
    await expect(
      tab.getByRole("heading", { level: 1, name: heading, exact: true }),
    ).toBeVisible();
    await expect.poll(() => currentHash(tab)).toBe(hash);
    await tab.close();
    expect(await currentHash(page)).toBe("#/dashboard");
  };
  // A sidebar link and a flyout entry.
  await newTab(
    nav.getByRole("link", { name: "TV series", exact: true }),
    "#/series",
    "TV library",
  );
  await nav.getByRole("button", { name: "Settings", exact: true }).click();
  await newTab(
    fly(page).getByRole("link", { name: "Display", exact: true }),
    "#/settings/appearance",
    "Settings",
  );
  await page.keyboard.press("Escape");

  // A plain click opens the route in this page, without a reload.
  const length = await historyLength(page);
  await nav.getByRole("link", { name: "TV series", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "TV library" }),
  ).toBeVisible();
  await expect.poll(() => currentHash(page)).toBe("#/series");
  expect(await historyLength(page)).toBe(length + 1);
  expect(await kept()).toBe(1);
});
