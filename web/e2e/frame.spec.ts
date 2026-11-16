// Frame invariants (docs/STYLEGUIDE.md, Part 1, 13): the frame keeps its
// geometry per breakpoint, between pages and states and after its first
// paint, and its rail, flyout, drawer and tab bar follow keyboard, pointer
// and touch. Measured after network idle and loaded fonts; tolerance 0.5 px.
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  currentHash,
  firstPaintChanges,
  goTo,
  historyLength,
  jobsMenu,
  mainNavigation,
  networkQuiet,
  openApp,
  openRoute,
  pageOverflowX,
  preferSidebar,
  quickSearch,
  recordApi,
  recordFirstPaint,
  rect,
  settingsSection,
  settingsSections,
  settle,
  smallTargets,
  surfaceTop,
  syncPopover,
  touchPage,
  withOpenJobs,
  withStatus,
  withTwoMovieInstances,
  type View,
} from "./app";
import { withFindings, withMuxJobs, withPlacement } from "./tool-fixtures";

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

// The sheet is the page's surface: the first block of the page (surfaceTop).
async function frameGeometry(page: Page) {
  const frame = await page.evaluate(() => {
    const box = (query: string) =>
      document
        .querySelector(query)!
        .getBoundingClientRect()
        .toJSON() as DOMRect;
    const sidebar = document.querySelector("#v2-sidebar")!;
    return {
      mode: sidebar.getAttribute("data-mode"),
      sidebar: sidebar.getBoundingClientRect().width,
      sidebarShown: getComputedStyle(sidebar).visibility === "visible",
      band: box(".v2-band"),
      topbar: box(".v2-topbar"),
      head: box(".v2-page-head"),
      view: box(".v2-view").top,
    };
  });
  return { ...frame, sheet: await surfaceTop(page) };
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

// Loads `hash` fresh at `size` and checks what recordFirstPaint saw against
// the settled frame (firstPaintChanges). Returns the index of the first
// frame with the page header.
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
  const { first, frames, recorded, late, ms } = await firstPaintChanges(page);
  const where = `${hash || "#/"} at ${label(size)}`;
  expect(first, `${where}: the navigation never appeared`).toBeTruthy();
  expect(first, where).toEqual([]);
  expect(recorded, `${where}: no frame was recorded`).toBeGreaterThan(0);
  expect(frames, where).toEqual([]);
  expect(
    late,
    `${where}: the page header never painted`,
  ).toBeGreaterThanOrEqual(0);
  return { late, ms, where };
}

test("the frame does not move after its first paint", async ({ page }) => {
  // Eager pages paint their header with the frame; lazy pages (tools,
  // settings) may show the band without a title until their chunk arrives.
  const entries = [
    { hash: "", heading: "Dashboard", lazy: false },
    { hash: "#/movies", heading: "Movie library", lazy: false },
    { hash: "#/tools/mux", heading: "Muxing", lazy: true },
    { hash: "#/settings/connections", heading: "Services", lazy: true },
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

// Final review I2: a palette (Nordic, themes.ts) is on <html> before the
// frame's first paint, and a theme change brings its other mode in the same
// frame. Each animation frame of the app (before it paints) records the
// theme and --accent; none may show the default accent or the other mode's.
test("a palette applies before the frame paints and with the theme", async ({
  page,
}) => {
  const accents: Record<string, string> = {
    dark: "#88c0d0",
    light: "#42668e",
  };
  await page.route(/\/api\/settings$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const settings = await response.json();
    settings.interfaceTheme = "nord";
    await route.fulfill({ response, json: settings });
  });
  await page.addInitScript(() => {
    const frames: string[][] = [];
    (window as unknown as { __palette: string[][] }).__palette = frames;
    const sample = () => {
      const root = document.documentElement;
      if (document.querySelector(".v2-shell"))
        frames.push([
          root.dataset.theme ?? "",
          getComputedStyle(root).getPropertyValue("--accent").trim(),
        ]);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const frames = () =>
    page.evaluate(
      () => (window as unknown as { __palette: string[][] }).__palette,
    );
  const expectPalette = async (what: string) => {
    const seen = await frames();
    expect(seen.length, `${what}: frames`).toBeGreaterThan(0);
    const wrong = seen.filter(([theme, accent]) => accent !== accents[theme]);
    expect(wrong, `${what}: frames with another accent`).toEqual([]);
  };
  await start(page, desktop);
  await expectPalette("first paint");
  for (const [name, next] of [
    ["Light theme", "light"],
    ["Dark theme", "dark"],
  ]) {
    const before = (await frames()).length;
    await page
      .getByRole("banner")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", next);
    await expect
      .poll(async () => (await frames()).length - before)
      .toBeGreaterThan(10);
    await expectPalette(name);
  }
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
      // The stored choice holds from 740 (E8), so an expanded sidebar is
      // really there (final review T13-a); below 740 it is the drawer.
      if (width <= 739 || mode === "expanded")
        await expect(
          page.locator("#v2-sidebar"),
          `${where} at ${label(size)}`,
        ).toHaveAttribute("data-mode", width <= 739 ? "drawer" : "expanded");
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
// is checked on its own below.
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

// A stored expanded sidebar at 740 to 899 (E8 keeps the stored choice from
// 740): the filter bars of the libraries and, since Phase 5b, of the tools
// follow their card (container 760). The tools' 1.7.0 filter row needed a
// rule of its own there (Phase 5a, E21; removed with it in Phase 5b, Task
// 9), which kept its icon tools 39px (820) and 119px (740) beyond the page.
// Both edges of the range, 899 and 900, are checked too (final review
// T13-b).
test("no horizontal page overflow with a stored expanded sidebar below 900", async ({
  page,
}) => {
  await checkOverflow(page, "expanded", [900, 899, 820, 740], LIST_VIEWS, []);
});

test("every page starts its first block where the sheet started", async ({
  page,
}) => {
  test.setTimeout(240_000);
  for (const size of [desktop, sizeOf(820), phone]) {
    await test.step(label(size), async () => {
      await start(page, size);
      for (const view of [
        "dashboard",
        "movies",
        "series",
        "mux",
        "placement",
        "files",
      ] as View[]) {
        await goTo(page, view);
        expectSame(
          await surfaceTop(page),
          frameOf(size).sheet,
          `${view} at ${label(size)}, first block top`,
        );
      }
      await goTo(page, "settings");
      for (const section of settingsSections) {
        await settingsSection(page, section);
        expectSame(
          await surfaceTop(page),
          frameOf(size).sheet,
          `Settings → ${section} at ${label(size)}, first block top`,
        );
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
      const toasts = page.locator(".v2-toast");
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

// Phase 5d (E25): a press on a toast is no press outside the rail's flyout
// and takes no focus from it: the flyout opened by keyboard stays open
// through a press on the toast's text and on its dismiss button.
test("a press on a toast keeps the rail flyout open", async ({ page }) => {
  await start(page, desktop);
  await page.mouse.move(700, 600);
  const settings = mainNavigation(page).getByRole("button", {
    name: "Settings",
    exact: true,
  });
  await tabTo(page, settings);
  await isOpen(page);
  await page.evaluate(() => {
    for (const message of ["First.", "Second."])
      window.dispatchEvent(
        new CustomEvent("scopearr-notification", {
          detail: { message, kind: "success" },
        }),
      );
  });
  const toast = page.locator(".v2-toast");
  await expect(toast).toHaveCount(2);
  await toast.first().locator(".v2-toast-text").click();
  await isOpen(page);
  expect(await active(page)).toBe("Settings");
  await toast
    .last()
    .getByRole("button", { name: "Dismiss notification" })
    .click();
  await expect(toast).toHaveCount(1);
  await isOpen(page);
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
          "Sign out",
        ]),
      );
      // The theme switch is the topbar's alone (D30 R7).
      expect([...seen], key).not.toContain("Light theme");
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

  // Final review M2: a press on a part of the drawer that takes no focus (a
  // group label) leaves focus on body; Escape still closes the drawer.
  await test.step("Escape with focus on body closes it", async () => {
    await reopen();
    await drawer.locator(".v2-nav-group").first().click();
    expect(await active(page)).toBe("body");
    await page.keyboard.press("Escape");
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

// The sync display's three places (E16): the chip in the rail's topbar,
// the card in the expanded sidebar's footer and the row in the drawer head.
const SYNC_TRIGGERS = ".v2-sync-chip, .v2-sync--card, .v2-sync--row";
const shownSyncTriggers = (page: Page) =>
  page
    .locator(SYNC_TRIGGERS)
    .evaluateAll(
      (triggers) =>
        triggers.filter((trigger) =>
          trigger.checkVisibility({ visibilityProperty: true }),
        ).length,
    );
// The two instances of withTwoMovieInstances in the popover: name, line and
// button. The demo has synced the first only.
async function expectSyncEntries(page: Page, locked: boolean) {
  const pop = syncPopover(page);
  await expect(pop.locator(".v2-sync-name")).toHaveText([
    "Radarr HD",
    "Radarr 4K",
  ]);
  await expect(pop.locator(".v2-sync-state")).toHaveText([
    /^Last sync: \S/,
    "Last sync: Not synced yet",
  ]);
  const buttons = pop.getByRole("button", { name: "Sync now", exact: true });
  await expect(buttons).toHaveCount(2);
  for (const button of await buttons.all())
    if (locked) await expect(button).toBeDisabled();
    else await expect(button).toBeEnabled();
}

test("sync status opens from chip, card and drawer row", async ({ page }) => {
  await withTwoMovieInstances(page);
  const pops = page.locator(".v2-pop");

  await test.step("1440: the chip opens it below itself", async () => {
    await start(page, desktop);
    expect(await shownSyncTriggers(page), "one sync display").toBe(1);
    const chip = page.getByRole("banner").locator(".v2-sync-chip");
    await expect(chip).toHaveAttribute("aria-expanded", "false");
    await chip.click();
    await expect(syncPopover(page)).toBeVisible();
    await expect(chip).toHaveAttribute("aria-expanded", "true");
    await expect(pops).toHaveCount(1);
    await expectSyncEntries(page, true);
    const [anchor, pop] = [await chip.boundingBox(), await pops.boundingBox()];
    expectSame(pop!.x + pop!.width, anchor!.x + anchor!.width, "popover end");
    expectSame(pop!.y, anchor!.y + anchor!.height + 6, "popover top");
    await page.keyboard.press("Escape");
    await expect(pops).toHaveCount(0);
    await expect(chip).toBeFocused();
    await expect(chip).toHaveAttribute("aria-expanded", "false");
    // Another popover replaces it: never two at once.
    await chip.click();
    await expect(syncPopover(page)).toBeVisible();
    await page
      .getByRole("banner")
      .getByRole("button", { name: /open jobs/ })
      .click();
    await expect(pops).toHaveCount(1);
    await expect(syncPopover(page)).toHaveCount(0);
    await expect(chip).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Escape");
    await expect(pops).toHaveCount(0);
  });

  await test.step("1600: the card opens it beside itself", async () => {
    await start(page, wide);
    expect(await shownSyncTriggers(page), "one sync display").toBe(1);
    await expect(page.locator(".v2-sync-chip")).toHaveCount(0);
    const card = page.locator("#v2-sidebar .v2-sync--card");
    await card.click();
    await expect(syncPopover(page)).toBeVisible();
    await expect(card).toHaveAttribute("aria-expanded", "true");
    await expectSyncEntries(page, true);
    const [anchor, pop] = [await card.boundingBox(), await pops.boundingBox()];
    expectSame(pop!.x, anchor!.x + anchor!.width + 6, "popover start");
    expectSame(pop!.y + pop!.height, anchor!.y + anchor!.height, "popover end");
    await page.keyboard.press("Escape");
    await expect(pops).toHaveCount(0);
    await expect(card).toBeFocused();
  });

  // Carry-forward (a): the drawer row's popover renders inside the modal
  // drawer, Tab stays in the drawer, Escape closes the popover first.
  await test.step("375: the drawer row opens it inside the drawer", async () => {
    await start(page, phone);
    expect(await shownSyncTriggers(page), "a closed drawer shows none").toBe(0);
    const more = mainNavigation(page).getByRole("button", {
      name: "More",
      exact: true,
    });
    const drawer = page.getByRole("dialog", { name: "Main navigation" });
    await more.click();
    await expect(drawer).toBeVisible();
    expect(await shownSyncTriggers(page), "one sync display").toBe(1);
    const row = drawer.locator(".v2-sync--row");
    await row.click();
    await expect(syncPopover(page)).toBeVisible();
    await expect(page.locator("#v2-sidebar > .v2-pop")).toHaveCount(1);
    await expect(row).toHaveAttribute("aria-expanded", "true");
    await expectSyncEntries(page, true);
    // Focus is in the popover (its buttons are locked in the demo).
    expect(
      await page.evaluate(() =>
        document.querySelector(".v2-pop")!.contains(document.activeElement),
      ),
    ).toBe(true);
    // First Escape: the popover closes, the drawer stays, focus on the row.
    await page.keyboard.press("Escape");
    await expect(pops).toHaveCount(0);
    await expect(drawer).toBeVisible();
    await expect(row).toBeFocused();
    await expect(row).toHaveAttribute("aria-expanded", "false");
    // With focus on the row and the popover open, too.
    await row.click();
    await expect(syncPopover(page)).toBeVisible();
    await row.focus();
    await page.keyboard.press("Escape");
    await expect(pops).toHaveCount(0);
    await expect(drawer).toBeVisible();
    await expect(row).toBeFocused();
    // Second Escape: the drawer closes, focus returns to More.
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(more).toBeFocused();
    // The scrim closes both.
    await more.click();
    await row.click();
    await expect(syncPopover(page)).toBeVisible();
    await page.mouse.click(phone.width - 20, 400);
    await expect(pops).toHaveCount(0);
    await expect(drawer).toBeHidden();
    await expect(more).toBeFocused();
  });
});

// Carry-forward (a) with buttons that take focus: outside the demo's lock,
// Tab and Shift+Tab move through the popover and on through the drawer,
// and never leave it.
test("the sync popover keeps focus in the drawer", async ({ page }) => {
  await withTwoMovieInstances(page);
  await withStatus(page, (status) => {
    status.demo = false;
  });
  await start(page, phone);
  const more = mainNavigation(page).getByRole("button", {
    name: "More",
    exact: true,
  });
  const drawer = page.getByRole("dialog", { name: "Main navigation" });
  const row = page.locator("#v2-sidebar .v2-sync--row");
  const inDrawer = () =>
    page.evaluate(() => !!document.activeElement?.closest("#v2-sidebar"));
  for (const key of ["Tab", "Shift+Tab"]) {
    await test.step(key, async () => {
      await more.click();
      await expect(drawer).toBeVisible();
      await row.click();
      await expectSyncEntries(page, false);
      const buttons = syncPopover(page).getByRole("button");
      await expect(buttons.first()).toBeFocused();
      if (key === "Tab") {
        await page.keyboard.press("Tab");
        await expect(buttons.nth(1)).toBeFocused();
      }
      const seen = new Set<string>();
      for (let step = 0; step < 25; step++) {
        await page.keyboard.press(key);
        expect(await inDrawer(), `${key} ${step + 1}`).toBe(true);
        seen.add(await active(page));
      }
      // Tab leaves the popover from its row (after its last button, or
      // Shift+Tab from its first) and goes on in the drawer.
      await expect(syncPopover(page)).toHaveCount(0);
      expect([...seen], key).toEqual(
        expect.arrayContaining(["Close", "Radarr 4K", "Sign out"]),
      );
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(more).toBeFocused();
    });
  }
});

// Fix round 1: a pressed "Sync now" locks and hands focus to the popover
// itself. Tab from there reaches the next instance's button and Shift+Tab
// the last one; the popover stays open. The request is held, so the pressed
// button stays locked meanwhile.
test("Tab after Sync now stays in the sync popover", async ({ page }) => {
  await withTwoMovieInstances(page);
  await withStatus(page, (status) => {
    status.demo = false;
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const requests: string[] = [];
  await page.route(/\/api\/sync$/, async (route) => {
    requests.push(route.request().postData() ?? "");
    await held;
    await route.fulfill({ json: {} });
  });
  await start(page, desktop);
  await page.getByRole("banner").locator(".v2-sync-chip").click();
  const pop = syncPopover(page);
  await expectSyncEntries(page, false);
  const buttons = pop.getByRole("button", { name: "Sync now", exact: true });
  await buttons.nth(0).click();
  await expect(buttons.nth(0)).toBeDisabled();
  expect(requests).toEqual([JSON.stringify({ service: "radarr" })]);
  await expect(page.locator(".v2-pop")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(pop).toBeVisible();
  await expect(buttons.nth(1)).toBeFocused();
  await page.locator(".v2-pop").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(pop).toBeVisible();
  await expect(buttons.nth(1)).toBeFocused();
  // After the last element Tab leaves from the chip, as before.
  await page.keyboard.press("Tab");
  await expect(pop).toHaveCount(0);
  release();
});

// What the frame shows without sync data (Task 11): without an enabled
// instance (the demo) no sync display at all; with instances that never
// synced "Synchronization" and each instance "Not synced yet".
test("the sync display without sync data", async ({ page }) => {
  await test.step("no enabled instance: no sync display", async () => {
    for (const size of [wide, desktop]) {
      await start(page, size);
      await expect(page.locator(SYNC_TRIGGERS)).toHaveCount(0);
    }
    await start(page, phone);
    await mainNavigation(page)
      .getByRole("button", { name: "More", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Main navigation" }),
    ).toBeVisible();
    await expect(page.locator(SYNC_TRIGGERS)).toHaveCount(0);
  });
  await test.step("instances without sync data", async () => {
    await withTwoMovieInstances(page);
    await withStatus(page, (status) => {
      delete status.sync;
    });
    await start(page, desktop);
    const chip = page.getByRole("banner").locator(".v2-sync-chip");
    await expect(chip).toHaveText("Synchronization");
    await expect(chip).toHaveAccessibleName("Synchronization");
    await expect(chip.locator(".v2-dot")).toHaveClass(/v2-dot--off/);
    await chip.click();
    await expect(syncPopover(page).locator(".v2-sync-state")).toHaveText([
      "Last sync: Not synced yet",
      "Last sync: Not synced yet",
    ]);
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

// Final review M1: a resize closes the open popover; focus in it returns
// to its anchor while the anchor is still there (the bell), and is not
// held by an anchor the new layout removes (the rail's sync chip).
test("a popover closed by a resize returns focus to its anchor", async ({
  page,
}) => {
  await withTwoMovieInstances(page);
  await start(page, desktop);
  const bell = page
    .getByRole("banner")
    .getByRole("button", { name: /open jobs/ });
  await bell.click();
  await expect(jobsMenu(page)).toBeVisible();
  expect(
    await page.evaluate(() => !!document.activeElement?.closest(".v2-pop")),
    "focus is in the jobs menu",
  ).toBe(true);
  await page.setViewportSize({ width: 1300, height: 900 });
  await expect(jobsMenu(page)).toHaveCount(0);
  await expect(bell).toBeFocused();
  await page.getByRole("banner").locator(".v2-sync-chip").click();
  await expect(syncPopover(page)).toBeVisible();
  await page.setViewportSize(phone);
  await expect(syncPopover(page)).toHaveCount(0);
  await expect(page.locator(".v2-sync-chip")).toHaveCount(0);
  expect(await active(page)).toBe("body");
});

// The toasts' resting edge (rc.4 R3, D30): the region ends --toast-bottom
// plus the safe area above the view's end (phones: above the tab bar). A
// zero-height probe at that offset gives the line, so no number repeats.
const toastHome = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;height:0;bottom:calc(var(--toast-bottom) + env(safe-area-inset-bottom))";
    document.body.append(probe);
    const edge = probe.getBoundingClientRect().bottom;
    probe.remove();
    return edge;
  });

// The centre of each control of the page head and the card head takes a
// press itself: nothing (a toast) lies over it.
const freeControls = (page: Page) =>
  page.evaluate(() => {
    const blocked: string[] = [];
    for (const control of document.querySelectorAll(
      ".v2-filter-bar > *, .v2-page-actions > *, .v2-tc-head :is(button, input, a)",
    )) {
      const box = control.getBoundingClientRect();
      if (!box.height || box.top < 0 || box.bottom > innerHeight) continue;
      const hit = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      if (!hit || !(control.contains(hit) || hit.contains(control)))
        blocked.push(`${control.className} is covered by ${hit?.className}`);
    }
    return blocked;
  });

// rc.4 R3 (D30): toasts sit bottom right and lift only above what they
// would cover there. While a popover is open and overlaps the toast
// column, the region ends --sp-3 (12) above the popover's top, and only
// the toasts move; with no overlap it keeps its resting edge. A press on a
// toast (its text or its dismiss button) is no press outside, so the
// popover stays open. The region is back at its resting edge once the
// popover has closed. Each animation frame (before it paints) records a
// toast that covers the open popover: none may, not even in the frame a
// toast first shows.
test("toasts stay clear of an open popover", async ({ page }) => {
  await page.addInitScript(() => {
    const covered: string[] = [];
    (window as unknown as { __covered: string[] }).__covered = covered;
    const sample = () => {
      const pop = document.querySelector(".v2-pop")?.getBoundingClientRect();
      for (const toast of pop ? document.querySelectorAll(".v2-toast") : []) {
        const box = toast.getBoundingClientRect();
        if (
          box.height &&
          box.left < pop!.right &&
          pop!.left < box.right &&
          box.top < pop!.bottom &&
          pop!.top < box.bottom
        )
          covered.push(`toast at ${box.top} over ${pop!.top}–${pop!.bottom}`);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const covered = () =>
    page.evaluate(
      () => (window as unknown as { __covered: string[] }).__covered,
    );
  await withTwoMovieInstances(page);
  await withOpenJobs(page, (status) => {
    status.demo = false;
  });
  await page.route(/\/api\/sync$/, (route) => route.fulfill({ json: {} }));
  const toast = page.locator(".v2-toast");
  const pop = page.locator(".v2-pop");
  const box = async (locator: Locator) => (await locator.boundingBox())!;
  const frame = () =>
    page.evaluate(() =>
      [".v2-band", ".v2-topbar", ".v2-page-head", "#v2-sidebar"].map(
        (query) => document.querySelector(query)!.getBoundingClientRect().y,
      ),
    );
  // The toast ends at its resting edge, or --sp-3 above the popover when
  // that would cover it; the popover stays open after a press on the
  // toast's text and on its dismiss button.
  const clear = async () => {
    await expect(toast).toHaveCount(1);
    await toast.evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)),
    );
    expect(await covered(), "frames with a toast over the popover").toEqual([]);
    const [card, below, home] = [
      await box(pop),
      await box(toast),
      await toastHome(page),
    ];
    const shares =
      below.x < card.x + card.width && card.x < below.x + below.width;
    const reaches = card.y + card.height > home - below.height;
    expectSame(
      below.y + below.height,
      shares && reaches ? card.y - 12 : home,
      shares && reaches
        ? "toast bottom, 12 above the popover"
        : "toast bottom, at its resting edge",
    );
    await toast.locator(".v2-toast-text").click();
    await expect(pop).toBeVisible();
    await toast.getByRole("button", { name: "Dismiss notification" }).click();
    await expect(toast).toHaveCount(0);
    await expect(pop).toBeVisible();
    expect(await covered(), "frames with a toast over the popover").toEqual([]);
  };
  const notifyNow = () =>
    page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("scopearr-notification", {
          detail: { message: "Settings saved", kind: "success" },
        }),
      ),
    );
  await start(page, desktop);
  const at = await frame();

  await test.step("Sync now in the sync popover of the chip", async () => {
    await page.getByRole("banner").locator(".v2-sync-chip").click();
    await expect(syncPopover(page)).toBeVisible();
    const card = await box(pop);
    await syncPopover(page)
      .getByRole("button", { name: "Sync now", exact: true })
      .first()
      .click();
    await expect(toast).toHaveText(
      "Sync queued. Services run one at a time; you can keep filtering.",
    );
    expect(await box(pop), "the popover stays in place").toEqual(card);
    expect(await frame(), "the frame stays in place").toEqual(at);
    await clear();
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
  });

  await test.step("a toast while the jobs menu is open", async () => {
    await page
      .getByRole("banner")
      .getByRole("button", { name: /open jobs/ })
      .click();
    await expect(jobsMenu(page)).toBeVisible();
    await notifyNow();
    await clear();
    expect(await frame(), "the frame stays in place").toEqual(at);
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
  });

  await test.step("a popover the toast would cover lifts it, 12 above", async () => {
    await page.getByRole("banner").locator(".v2-sync-chip").click();
    await expect(syncPopover(page)).toBeVisible();
    const card = await box(pop);
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
    // A view that ends just below the popover: the resting edge lies in it
    // (a resize closes a popover, so it opens again in the short view).
    const tall = page.viewportSize()!;
    await page.setViewportSize({
      width: tall.width,
      height: Math.ceil(card.y + card.height) + 40,
    });
    await page.getByRole("banner").locator(".v2-sync-chip").click();
    await expect(syncPopover(page)).toBeVisible();
    await notifyNow();
    await expect(toast).toHaveCount(1);
    await toast.evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)),
    );
    const [now, own] = [await box(pop), await box(toast)];
    expect(
      own.x < now.x + now.width && now.x < own.x + own.width,
      "the toast shares the popover's column",
    ).toBe(true);
    expectSame(own.y + own.height, now.y - 12, "toast bottom, 12 above");
    expect(await covered(), "frames with a toast over the popover").toEqual([]);
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
    await toast.getByRole("button", { name: "Dismiss notification" }).click();
    await expect(toast).toHaveCount(0);
    await page.setViewportSize(tall);
  });

  await test.step("without a popover the toasts are back at their resting edge", async () => {
    await notifyNow();
    await expect(toast).toHaveCount(1);
    await toast.evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)),
    );
    const own = await box(toast);
    expectSame(own.y + own.height, await toastHome(page), "toast bottom");
  });
});

// rc.4 R3 (D30, was Phase 5a final review I1): the toasts sit at the
// bottom right, so they stay clear of a page's top controls, the card head
// of a list (search, preset, Filters) and the page header's actions (the
// instance segment, Retry), without moving: the newest toast ends at the
// resting edge (--toast-bottom plus the safe area; phones above the tab
// bar), also while scrolling. Each animation frame records a toast over one
// of those controls: none may, at the top, while scrolling or in the frame
// a toast first shows; each control answers a hit test at its centre, and
// Retry takes its click with the error's toast up.
test("toasts stay clear of a page's top controls", async ({ page }) => {
  test.setTimeout(240_000);
  // A frame paints what its last animation frame callback left: the
  // page's own callbacks (the toasts' placement, once per frame) run after
  // this recorder's, so each of them is followed by a sample too, and a
  // frame counts with its last sample.
  await page.addInitScript(() => {
    const covered: string[] = [];
    let frame = { time: -1, found: [] as string[] };
    const sample = () => {
      const found: string[] = [];
      const toasts = [...document.querySelectorAll(".v2-toast")].map((toast) =>
        toast.getBoundingClientRect(),
      );
      if (toasts.length)
        for (const control of document.querySelectorAll(
          ".v2-filter-bar > *, .v2-page-actions > *",
        )) {
          const box = control.getBoundingClientRect();
          for (const toast of toasts)
            if (
              box.height &&
              toast.height &&
              box.left < toast.right &&
              toast.left < box.right &&
              box.top < toast.bottom &&
              toast.top < box.bottom
            )
              found.push(
                `${location.hash} at ${scrollY}: toast ${toast.top}–${toast.bottom} over ${control.className} ${box.top}–${box.bottom}`,
              );
        }
      return found;
    };
    const record = (time: number) => {
      if (time !== frame.time) {
        covered.push(...frame.found);
        frame = { time, found: [] };
      }
      frame.found = sample();
    };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      raf((time) => {
        callback(time);
        record(time);
      });
    const loop = (time: number) => {
      record(time);
      raf(loop);
    };
    raf(loop);
    (window as unknown as { __covered(): string[] }).__covered = () => [
      ...covered,
      ...frame.found,
    ];
  });
  const covered = () =>
    page.evaluate(() =>
      (window as unknown as { __covered(): string[] }).__covered(),
    );
  await withTwoMovieInstances(page);
  let failing = false;
  await page.route(/\/api\/statistics$/, (route) =>
    failing
      ? route.fulfill({ status: 500, json: { error: "unavailable" } })
      : route.fallback(),
  );
  const toast = page.locator(".v2-toast");
  const notifyNow = (message: string, kind: string) =>
    page.evaluate(
      ([message, kind]) =>
        window.dispatchEvent(
          new CustomEvent("scopearr-notification", {
            detail: { message, kind },
          }),
        ),
      [message, kind],
    );
  // The toasts' boxes once their entry has ended; two frames after a
  // scroll, so its listener has run.
  const firstToast = async () => {
    await toast.evaluateAll((list) =>
      Promise.all(
        list.flatMap((item) => item.getAnimations().map((a) => a.finished)),
      ),
    );
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
    return (await toast.first().boundingBox())!;
  };
  // Where the newest toast ends, once its entry has ended.
  const edge = async () => {
    await firstToast();
    const last = (await toast.last().boundingBox())!;
    return last.y + last.height;
  };
  const atHome = async (what: string) =>
    expectSame(await edge(), await toastHome(page), what);
  const scrollTo = async (y: number) => {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    return firstToast();
  };
  for (const size of [desktop, sizeOf(820), phone]) {
    await test.step(`the movie library at ${label(size)}`, async () => {
      failing = false;
      await start(page, size, "#/movies");
      await expect(page.locator(".v2-row--placeholder")).toHaveCount(0);
      await notifyNow(
        "Sync failed · The service did not answer in time",
        "error",
      );
      await notifyNow("Settings saved", "success");
      await expect(toast).toHaveCount(2);
      await atHome("toast bottom");
      expect(await covered(), "frames with a toast over a control").toEqual([]);
      expect(await freeControls(page), "controls under a toast").toEqual([]);
      for (const y of [40, 100, 160, 240]) await scrollTo(y);
      await scrollTo(900);
      await atHome("toast bottom, scrolled away");
      await scrollTo(0);
      await atHome("toast bottom again");
      expect(await covered(), "frames with a toast over a control").toEqual([]);
      expect(await freeControls(page), "controls under a toast").toEqual([]);
    });
    await test.step(`a failed dashboard load at ${label(size)}`, async () => {
      failing = true;
      await start(page, size, "#/dashboard");
      const retry = page
        .locator(".v2-page-actions")
        .getByRole("button", { name: "Retry", exact: true });
      await expect(retry).toBeVisible();
      await expect(toast).toHaveCount(1);
      await notifyNow("Settings saved", "success");
      await expect(toast).toHaveCount(2);
      await atHome("toast bottom");
      expect(await covered(), "frames with a toast over a control").toEqual([]);
      expect(await freeControls(page), "controls under a toast").toEqual([]);
      for (const y of [40, 100, 300]) await scrollTo(y);
      await scrollTo(0);
      expect(await covered(), "frames with a toast over a control").toEqual([]);
      // Retry takes the click while the error's toast is up; the toasts
      // stay where they are.
      failing = false;
      await retry.click();
      await expect(retry).toHaveCount(0);
      await atHome("toast bottom after Retry");
      expect(await covered(), "frames with a toast over a control").toEqual([]);
    });
  }
  // Final re-review N1: four toasts never cover the tab bar. They end at
  // the resting edge and stack upward, all inside the view, also on a
  // phone 667 high.
  const four = async () => {
    for (const [message, kind] of [
      ["Sync completed · Radarr", "success"],
      ["Sync failed · The service did not answer in time", "error"],
      ["Settings saved", "success"],
      ["Could not add the new default tag rules: disk full", "error"],
    ])
      await notifyNow(message, kind);
    await expect(toast).toHaveCount(4);
    await firstToast();
    return toast.evaluateAll((list) =>
      list.map((item) => item.getBoundingClientRect().toJSON() as DOMRect),
    );
  };
  await test.step("four toasts at the resting edge at 1440", async () => {
    failing = false;
    await start(page, desktop, "#/movies");
    await expect(page.locator(".v2-row--placeholder")).toHaveCount(0);
    const boxes = await four();
    expectSame(boxes[3].bottom, await toastHome(page), "the last toast's end");
    expect(boxes[0].top, "the first toast starts in the view").toBeGreaterThan(
      0,
    );
    expect(await covered(), "frames with a toast over a control").toEqual([]);
    expect(await freeControls(page), "controls under a toast").toEqual([]);
  });
  await test.step("four toasts on a phone 667 high", async () => {
    const short = { width: 375, height: 667 };
    await start(page, short, "#/movies");
    await expect(page.locator(".v2-row--placeholder")).toHaveCount(0);
    const boxes = await four();
    const bar = await rect(page, ".v2-tabbar");
    for (const box of boxes)
      expect(
        box.bottom,
        `a toast (${box.top}–${box.bottom}) covers the tab bar (${bar.top})`,
      ).toBeLessThanOrEqual(bar.top + 0.5);
    expectSame(boxes[3].bottom, await toastHome(page), "the last toast's end");
    expect(boxes[0].top, "the first toast starts in the view").toBeGreaterThan(
      0,
    );
    expect(await covered(), "frames with a toast over a control").toEqual([]);
  });
});

// Ruling M18 (Phase 5b, Task 6): the Muxing card is a TableCard, so the
// toasts keep clear of its head (search, preset, Filters) and of the page
// header's Show in log as on the libraries (rc.4 R3, D30): the toasts sit
// at the bottom right, end at the resting edge and cover neither.
test("toasts keep clear of the Muxing card head", async ({ page }) => {
  await withMuxJobs(page);
  await start(page, desktop, "#/tools/mux");
  await expect(page.locator("table.v2-table--fixed tbody tr")).toHaveCount(6);
  for (const [message, kind] of [
    ["Sync failed · The service did not answer in time", "error"],
    ["Settings saved", "success"],
  ])
    await page.evaluate(
      ([message, kind]) =>
        window.dispatchEvent(
          new CustomEvent("scopearr-notification", {
            detail: { message, kind },
          }),
        ),
      [message, kind],
    );
  const toast = page.locator(".v2-toast");
  await expect(toast).toHaveCount(2);
  await toast.evaluateAll((list) =>
    Promise.all(
      list.flatMap((item) => item.getAnimations().map((a) => a.finished)),
    ),
  );
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
  const boxes = await toast.evaluateAll((list) =>
    list.map((item) => item.getBoundingClientRect().toJSON() as DOMRect),
  );
  const head = await rect(page, ".v2-tc-head");
  const actions = await rect(page, ".v2-page-actions");
  expectSame(
    boxes[1].bottom,
    await toastHome(page),
    "the newest toast ends at the resting edge",
  );
  expect(await freeControls(page), "controls under a toast").toEqual([]);
  for (const box of boxes)
    for (const [name, control] of [
      ["card head", head],
      ["page actions", actions],
    ] as const)
      expect(
        box.left < control.right &&
          control.left < box.right &&
          box.top < control.bottom &&
          control.top < box.bottom,
        `a toast (${box.top}–${box.bottom}) covers the ${name} (${control.top}–${control.bottom})`,
      ).toBe(false);
});

// Ruling M18 (Phase 5b, Task 7): the Disk placement card is a TableCard
// below the disk row, so the toasts keep clear of its head and of the page
// header's Scan report and Scan (rc.4 R3, D30): the toasts sit at the
// bottom right, end at the resting edge and cover neither.
test("toasts keep clear of the Disk placement card head", async ({ page }) => {
  await withPlacement(page);
  await start(page, desktop, "#/tools/placement");
  await expect(page.locator("table.v2-table--fixed tbody tr")).toHaveCount(5);
  for (const [message, kind] of [
    ["Sync failed · The service did not answer in time", "error"],
    ["Settings saved", "success"],
  ])
    await page.evaluate(
      ([message, kind]) =>
        window.dispatchEvent(
          new CustomEvent("scopearr-notification", {
            detail: { message, kind },
          }),
        ),
      [message, kind],
    );
  const toast = page.locator(".v2-toast");
  await expect(toast).toHaveCount(2);
  await toast.evaluateAll((list) =>
    Promise.all(
      list.flatMap((item) => item.getAnimations().map((a) => a.finished)),
    ),
  );
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
  const boxes = await toast.evaluateAll((list) =>
    list.map((item) => item.getBoundingClientRect().toJSON() as DOMRect),
  );
  const head = await rect(page, ".v2-tc-head");
  const actions = await rect(page, ".v2-page-actions");
  expectSame(
    boxes[1].bottom,
    await toastHome(page),
    "the newest toast ends at the resting edge",
  );
  expect(await freeControls(page), "controls under a toast").toEqual([]);
  for (const box of boxes)
    for (const [name, control] of [
      ["card head", head],
      ["page actions", actions],
    ] as const)
      expect(
        box.left < control.right &&
          control.left < box.right &&
          box.top < control.bottom &&
          control.top < box.bottom,
        `a toast (${box.top}–${box.bottom}) covers the ${name} (${control.top}–${control.bottom})`,
      ).toBe(false);
});

// Ruling M18 (Phase 5b, Task 8): the Files & permissions card is a
// TableCard below the KPI row, so the toasts keep clear of its head and of
// the page header's Scan report and Scan (rc.4 R3, D30): the toasts sit at
// the bottom right, end at the resting edge and cover neither.
test("toasts keep clear of the Files & permissions card head", async ({
  page,
}) => {
  await withFindings(page);
  await start(page, desktop, "#/tools/files");
  await expect(page.locator("table.v2-table--fixed tbody tr")).toHaveCount(4);
  for (const [message, kind] of [
    ["Sync failed · The service did not answer in time", "error"],
    ["Settings saved", "success"],
  ])
    await page.evaluate(
      ([message, kind]) =>
        window.dispatchEvent(
          new CustomEvent("scopearr-notification", {
            detail: { message, kind },
          }),
        ),
      [message, kind],
    );
  const toast = page.locator(".v2-toast");
  await expect(toast).toHaveCount(2);
  await toast.evaluateAll((list) =>
    Promise.all(
      list.flatMap((item) => item.getAnimations().map((a) => a.finished)),
    ),
  );
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
  const boxes = await toast.evaluateAll((list) =>
    list.map((item) => item.getBoundingClientRect().toJSON() as DOMRect),
  );
  const head = await rect(page, ".v2-tc-head");
  const actions = await rect(page, ".v2-page-actions");
  expectSame(
    boxes[1].bottom,
    await toastHome(page),
    "the newest toast ends at the resting edge",
  );
  expect(await freeControls(page), "controls under a toast").toEqual([]);
  for (const box of boxes)
    for (const [name, control] of [
      ["card head", head],
      ["page actions", actions],
    ] as const)
      expect(
        box.left < control.right &&
          control.left < box.right &&
          box.top < control.bottom &&
          control.top < box.bottom,
        `a toast (${box.top}–${box.bottom}) covers the ${name} (${control.top}–${control.bottom})`,
      ).toBe(false);
});

// Task 12 (E17, ruling R-B): the bell counts the open jobs of the status;
// its jobs load only when it opens; a tool row opens the tool page through
// its link, the footer the error log of the failed tools, and Escape
// returns focus to the bell. Jobs that cannot be loaded leave the tool's
// row alone, without a notice.
test("the bell opens tools and the log", async ({ page }) => {
  await withOpenJobs(page);
  const api = recordApi(page);
  await start(page, desktop);
  const bell = page
    .getByRole("banner")
    .getByRole("button", { name: /open jobs/ });
  const menu = jobsMenu(page);
  const tools = menu.locator(".v2-jobs > li > a");
  // Loaded job rows; placeholders (aria-hidden) hold their place before.
  const jobs = menu.locator(".v2-job:not([aria-hidden])");
  const calls = (path: string, mark = 0) =>
    api.since(mark).filter((call) => call.path === path).length;

  await test.step("the count is the status's", async () => {
    type Jobs = { pending?: number; running?: number; failed?: number };
    const status = await page.evaluate(() =>
      fetch("/api/status").then((response) => response.json()),
    );
    const open = (jobs?: Jobs) =>
      (jobs?.pending || 0) + (jobs?.running || 0) + (jobs?.failed || 0);
    const count =
      (status.mux?.enabled ? open(status.mux) : 0) +
      (status.unraid?.enabled ? open(status.unraid) : 0) +
      (status.files?.available ? open(status.files) : 0);
    expect(count, "the fixture's open jobs").toBe(6);
    await expect(bell).toHaveAccessibleName(`Tools, ${count} open jobs`);
    await expect(bell.locator(".v2-plaque")).toHaveText(String(count));
    await expect(bell.locator(".v2-plaque")).toHaveClass(/v2-plaque--error/);
    // Startup asked for no item list; mux/jobs only for the library.
    expect(calls("filecheck/items") + calls("placement/items")).toBe(0);
    expect(calls("mux/jobs")).toBe(1);
  });

  await test.step("opening loads the jobs of the tools with open jobs", async () => {
    const mark = api.mark();
    await bell.click();
    await expect(menu).toBeVisible();
    await expect(bell).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".v2-pop")).toHaveCount(1);
    await expect(tools.first()).toBeFocused();
    await expect(tools.locator(".v2-jobs-name")).toHaveText([
      "Muxing",
      "Files & permissions",
    ]);
    await expect(tools.locator(".v2-jobs-line")).toHaveText([
      "Running 1 · Waiting 1 · Failed 1",
      "Waiting 2 · Failed 1",
    ]);
    await expect(tools.first()).toHaveAccessibleName(
      "Muxing Running 1 · Waiting 1 · Failed 1",
    );
    await expect(jobs.locator(".v2-jobs-name")).toHaveText([
      "Arrival",
      "Heat",
      "Dune",
      "Tron",
      "Up",
      "Big",
    ]);
    await expect(jobs.locator(".v2-jobs-line")).toHaveText([
      "Running · Arrival (2016).mkv",
      "Failed · Heat (1995).mkv",
      "Waiting · Dune (2021).mkv",
      "Failed · Tron (1982).mkv",
      "Waiting · Up (2009).mkv",
      "Waiting · Big (1988).mkv",
    ]);
    await networkQuiet(page);
    // Disk placement has no open jobs: no row and no request.
    expect(calls("mux/jobs", mark)).toBe(1);
    expect(calls("filecheck/items", mark)).toBe(2);
    expect(calls("placement/items", mark)).toBe(0);
    await expect(menu.getByRole("button")).toHaveText(["Show in log"]);
    // Escape closes it and returns focus to the bell.
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(bell).toBeFocused();
    await expect(bell).toHaveAttribute("aria-expanded", "false");
  });

  await test.step("a tool row opens its page", async () => {
    await bell.click();
    await tools.filter({ hasText: "Files & permissions" }).click();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Files & permissions",
        exact: true,
      }),
    ).toBeVisible();
    await expect(menu).toHaveCount(0);
    await expect
      .poll(() => currentHash(page))
      .toMatch(/^#\/tools\/files(\?|$)/);
    // Focus returns to the bell, as from the drawer to More (M1).
    await expect(bell).toBeFocused();
    await bell.press("Enter");
    await expect(tools.first()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { level: 1, name: "Muxing", exact: true }),
    ).toBeVisible();
    await expect(menu).toHaveCount(0);
    await expect(bell).toBeFocused();
  });

  await test.step("Show in log opens the errors of the failed tools", async () => {
    await bell.click();
    await menu
      .getByRole("button", { name: "Show in log", exact: true })
      .click();
    await expect(menu).toHaveCount(0);
    await expect
      .poll(() => currentHash(page))
      .toBe("#/settings/system/log?level=error&source=mux&source=filecheck");
    await expect(
      page.getByRole("heading", { level: 1, name: "System", exact: true }),
    ).toBeVisible();
    // Focus returns to the bell, as after a row (M1).
    await expect(bell).toBeFocused();
  });

  await test.step("jobs that cannot be loaded leave the tool's row", async () => {
    await page.route(/\/api\/filecheck\/items\?/, (route) =>
      route.fulfill({ status: 500, json: { error: "Request failed" } }),
    );
    await bell.click();
    await expect(tools).toHaveCount(2);
    await expect(jobs.locator(".v2-jobs-name")).toHaveText([
      "Arrival",
      "Heat",
      "Dune",
    ]);
    await networkQuiet(page);
    await expect(
      tools.nth(1).locator("xpath=following-sibling::*"),
    ).toHaveCount(0);
    await expect(page.locator(".v2-toast")).toHaveCount(0);
    await page.keyboard.press("Escape");
  });
});

// Final review M1: a bell row that the unsaved-changes question declines
// changes nothing and leaves focus on the bell, not on body.
test("a declined bell row keeps focus on the bell", async ({ page }) => {
  await withOpenJobs(page);
  await start(page, desktop);
  await goTo(page, "settings");
  await settingsSection(page, "Display");
  const entries = page.getByLabel("Entries per page", { exact: true });
  const changed = (await entries.inputValue()) === "37" ? "38" : "37";
  await entries.fill(changed);
  const bell = page
    .getByRole("banner")
    .getByRole("button", { name: /open jobs/ });
  await bell.click();
  await jobsMenu(page).locator(".v2-jobs > li > a").first().click();
  const question = page.getByRole("dialog", { name: "Really cancel?" });
  await expect(question).toBeVisible();
  await question.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(question).toBeHidden();
  await expect(
    page.getByRole("heading", { level: 1, name: "Display", exact: true }),
  ).toBeVisible();
  await expect(entries).toHaveValue(changed);
  await expect(jobsMenu(page)).toHaveCount(0);
  await expect(bell).toBeFocused();
});

// E17: outside the demo a polite live region carries the bell's name, so
// a changed count is announced; the demo, where no job starts, has none.
test("the bell's count is announced outside the demo", async ({ page }) => {
  const region = page.locator(".v2-shell > [aria-live]");
  await start(page, desktop);
  await expect(region).toHaveCount(0);
  let more = 0;
  await withOpenJobs(page, (status) => {
    status.demo = false;
    (status.files as { pending: number }).pending += more;
  });
  // The status polls every 30 s; the test's clock jumps there.
  await page.clock.install();
  await start(page, desktop);
  await expect(region).toHaveCount(1);
  await expect(region).toHaveAttribute("aria-live", "polite");
  await expect(region).toHaveText("Tools, 6 open jobs");
  await expect(region).toHaveClass("v2-sr-only");
  // Fix round 1: a changed count changes the text of the same mounted
  // node, which is what a screen reader announces; a new node would not be.
  const node = await region.elementHandle();
  more = 1;
  await page.clock.fastForward(31_000);
  await expect(region).toHaveText("Tools, 7 open jobs");
  expect(
    await node!.evaluate((element) => [
      element.isConnected,
      element.textContent,
    ]),
  ).toEqual([true, "Tools, 7 open jobs"]);
  expect(
    await region.evaluate((element, before) => element === before, node),
  ).toBe(true);
});

// Fix round 1: while the jobs load (their answers held), placeholder rows
// of the final height hold their place, so the menu, its tool rows and
// "Show in log" do not move when the jobs arrive.
test("the jobs menu keeps its size when the jobs arrive", async ({ page }) => {
  await withOpenJobs(page);
  await start(page, desktop);
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/api\/(mux\/jobs$|filecheck\/items\?)/, async (route) => {
    await held;
    await route.fallback();
  });
  const menu = jobsMenu(page);
  const placeholders = menu.locator('.v2-job[aria-hidden="true"]');
  const loaded = menu.locator(".v2-job:not([aria-hidden])");
  const boxes = async () => ({
    menu: await page.locator(".v2-pop").boundingBox(),
    files: await menu.locator(".v2-jobs > li > a").nth(1).boundingBox(),
    log: await menu
      .getByRole("button", { name: "Show in log", exact: true })
      .boundingBox(),
  });
  await page
    .getByRole("banner")
    .getByRole("button", { name: /open jobs/ })
    .click();
  await expect(placeholders).toHaveCount(6);
  await expect(loaded).toHaveCount(0);
  const before = await boxes();
  release();
  await expect(loaded).toHaveCount(6);
  await expect(placeholders).toHaveCount(0);
  const after = await boxes();
  for (const part of ["menu", "files", "log"] as const)
    for (const side of ["x", "y", "width", "height"] as const)
      expectSame(after[part]![side], before[part]![side], `${part} ${side}`);
});

// Fix round 1: the requests the bell builds reach the demo server and
// answer 200 with a list: Disk placement and Files & permissions (both
// states each) and mux. The demo has no jobs, so the placeholders go and
// each tool's row stands alone.
test("the bell's job requests reach the server", async ({ page }) => {
  await withStatus(page, (status) => {
    const tools = status as unknown as Record<string, Record<string, unknown>>;
    for (const tool of ["mux", "unraid", "files"])
      tools[tool] = { ...tools[tool], pending: 1, running: 1, failed: 1 };
  });
  const answers: Promise<[string, number, boolean]>[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (
      /^\/api\/(mux\/jobs|placement\/items|filecheck\/items)$/.test(
        url.pathname,
      )
    )
      answers.push(
        response
          .json()
          .then((body) => [
            url.pathname.slice("/api/".length) + url.search,
            response.status(),
            Array.isArray(body?.items ?? body),
          ]),
      );
  });
  await start(page, desktop);
  await networkQuiet(page);
  const startup = answers.length;
  await page
    .getByRole("banner")
    .getByRole("button", { name: /open jobs/ })
    .click();
  const menu = jobsMenu(page);
  await expect(menu).toBeVisible();
  await networkQuiet(page);
  expect((await Promise.all(answers.slice(startup))).sort()).toEqual([
    ["filecheck/items?status=active&sort=status&dir=desc&limit=3", 200, true],
    ["filecheck/items?status=failed&sort=status&dir=desc&limit=3", 200, true],
    ["mux/jobs", 200, true],
    [
      "placement/items?status=failed&status=needs_review&status=needs_attention&sort=status&dir=desc&limit=3",
      200,
      true,
    ],
    [
      "placement/items?status=running&status=queued&sort=status&dir=desc&limit=3",
      200,
      true,
    ],
  ]);
  await expect(menu.locator(".v2-jobs > li > a")).toHaveCount(3);
  await expect(menu.locator(".v2-job")).toHaveCount(0);
});

// Task 13 (V11, E18, ruling R-C): quick search opens from its button and
// with Ctrl+K or Meta+K, also from a field; it lists the pages and, from
// two letters on, six titles per library; Enter opens the active option,
// a title its library filtered by it; Escape returns focus to where it was.
test("quick search opens with Ctrl+K and Meta+K and returns focus", async ({
  page,
  context,
}) => {
  const searches: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/files" && url.searchParams.has("limit"))
      searches.push(url.search);
  });
  await start(page, desktop);
  const button = page
    .getByRole("banner")
    .getByRole("button", { name: "Quick search", exact: true });
  const dialog = quickSearch(page);
  const field = dialog.getByRole("combobox", { name: "Quick search" });
  const options = dialog.getByRole("option");

  await test.step("the button opens it with every page", async () => {
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await button.click();
    await expect(dialog).toBeVisible();
    await expect(field).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(field).toHaveAttribute(
      "placeholder",
      "Search pages, movies and TV series …",
    );
    const pages = dialog.getByRole("group", { name: "Pages" });
    await expect(pages.getByRole("option").first()).toHaveAccessibleName(
      "Dashboard Library",
    );
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    // ↓ moves the active option; focus stays in the field.
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(field).toHaveAttribute(
      "aria-activedescendant",
      (await options.nth(1).getAttribute("id"))!,
    );
    await expect(field).toBeFocused();
    // Ctrl+K in it keeps it open and focused (no browser search).
    await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible();
    await expect(field).toBeFocused();
    expect(searches, "pages need no request").toEqual([]);
    // Escape closes it; focus returns to the button.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });

  await test.step("a title opens its library filtered by it", async () => {
    await page.keyboard.press("Control+k");
    await expect(field).toBeFocused();
    await page.keyboard.type("arri");
    const arrival = dialog
      .getByRole("group", { name: "Movies" })
      .getByRole("option", { name: "Arrival 2016", exact: true });
    await expect(arrival).toHaveAttribute("aria-selected", "true");
    // One request per library after the pause, for six titles.
    expect([...searches].sort()).toEqual([
      "?service=radarr&mode=matches&q=arri&limit=6",
      "?service=sonarr&mode=matches&q=arri&limit=6&distinct=series",
    ]);
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    // A movie opens its list and File & metadata on its file (E18).
    await expect
      .poll(() => currentHash(page))
      .toMatch(/^#\/movies\?q=Arrival&file=radarr%3A\d+$/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Movie library",
        exact: true,
      }),
    ).toBeVisible();
    const file = page.getByRole("dialog", { name: "File & metadata" });
    await expect(file).toBeVisible();
    await expect(file.locator(".v2-file-name")).toContainText("Arrival");
    await page.keyboard.press("Escape");
    await expect(file).toHaveCount(0);
    await expect.poll(() => currentHash(page)).toBe("#/movies?q=Arrival");
  });

  await test.step("Ctrl+K and Meta+K from a filter field", async () => {
    const filter = page
      .getByRole("main")
      .getByRole("textbox", { name: "Title or filename" });
    await expect(filter).toHaveValue("Arrival");
    for (const key of ["Control+k", "Meta+k"]) {
      await filter.focus();
      await page.keyboard.press(key);
      await expect(field, key).toBeFocused();
      await expect(filter, "no K typed into the field").toHaveValue("Arrival");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(filter, key).toBeFocused();
    }
  });

  await test.step("a page opens through its link, a modified click in a new tab", async () => {
    await button.click();
    await page.keyboard.type("disp");
    const display = dialog.getByRole("option", {
      name: "Display Settings",
      exact: true,
    });
    await expect(display).toHaveAttribute("href", "#/settings/appearance");
    const [tab] = await Promise.all([
      context.waitForEvent("page"),
      display.click({ modifiers: ["ControlOrMeta"] }),
    ]);
    // The new tab starts on about:blank and then loads the link; a check
    // before that load would run in a context that goes away.
    await tab.waitForURL(/#\/settings\/appearance$/);
    await expect.poll(() => currentHash(tab)).toBe("#/settings/appearance");
    await tab.close();
    await expect(dialog).toBeVisible();
    await expect(field).toBeFocused();
    // The pointer makes the option under it active; a click opens it.
    await display.hover();
    await expect(display).toHaveAttribute("aria-selected", "true");
    await display.click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => currentHash(page)).toBe("#/settings/appearance");
    await expect(
      page.getByRole("heading", { level: 1, name: "Display", exact: true }),
    ).toBeVisible();
  });

  await test.step("a press on the backdrop closes it", async () => {
    await button.click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(8, 450);
    await expect(dialog).toHaveCount(0);
  });
});

// Fix round 1: ⌘K with focus in an open popover replaces it; Escape then
// returns focus to the popover's trigger (the bell; on phones the tab
// bar's Tools button), not to body.
test("quick search from an open popover returns focus to its trigger", async ({
  page,
}) => {
  await start(page, desktop);
  const dialog = quickSearch(page);
  const bell = page
    .getByRole("banner")
    .getByRole("button", { name: /open jobs/ });
  await bell.click();
  await expect(jobsMenu(page)).toBeVisible();
  expect(
    await page.evaluate(() => !!document.activeElement?.closest(".v2-pop")),
    "focus is in the jobs menu",
  ).toBe(true);
  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await expect(jobsMenu(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(bell).toBeFocused();

  await page.setViewportSize(phone);
  const tools = mainNavigation(page).getByRole("button", {
    name: "Tools",
    exact: true,
  });
  await tools.click();
  await expect(page.getByRole("menu", { name: "Tools" })).toBeVisible();
  await page.keyboard.press("Meta+k");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("menu", { name: "Tools" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(tools).toBeFocused();
});

// Final review M1: ⌘K with focus in the rail's flyout (which closes when
// focus leaves it) returns focus to the flyout's entry, not to body.
test("quick search from the rail flyout returns focus to its entry", async ({
  page,
}) => {
  await start(page, desktop);
  const settings = mainNavigation(page).getByRole("button", {
    name: "Settings",
    exact: true,
  });
  const dialog = quickSearch(page);
  for (const key of ["Control+k", "Meta+k"]) {
    await test.step(key, async () => {
      await page.mouse.move(700, 600);
      // From outside the rail, so Tab focuses Settings afresh.
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
      await tabTo(page, settings);
      await isOpen(page);
      await page.keyboard.press("ArrowRight");
      expect(
        await page.evaluate(() => !!document.activeElement?.closest("#v2-fly")),
        "focus is in the flyout",
      ).toBe(true);
      await page.keyboard.press(key);
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(settings).toBeFocused();
      // Visible focus on the entry opens its flyout again, as any.
      await isOpen(page);
    });
  }
});

// Fix round 1: quick search has the popovers' edge in both themes (the
// card border in dark, line-soft in light).
test("quick search has the popovers' border in both themes", async ({
  page,
}) => {
  for (const theme of ["dark", "light"] as const) {
    await page.setViewportSize(desktop);
    await page.goto("about:blank");
    await openRoute(page, "", { theme });
    await page
      .getByRole("banner")
      .getByRole("button", { name: /open jobs/ })
      .click();
    const border = (selector: string) =>
      page
        .locator(selector)
        .evaluate((element) => getComputedStyle(element).borderTopColor);
    const popover = await border(".v2-pop");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await expect(quickSearch(page)).toBeVisible();
    expect(await border(".v2-qs"), theme).toBe(popover);
    if (theme === "light")
      expect(popover, "a visible edge in light").not.toBe("rgba(0, 0, 0, 0)");
    await page.keyboard.press("Escape");
  }
});

// Nothing in quick search moves while it lists: its box has a fixed size,
// whatever it shows; its field and the pages above the titles keep their
// place when the titles arrive. Measured with the title answers held.
// Phase 5d, task 7 (E18): quick search opened from the topbar button,
// whose button goes with a resize to the phone layout, returns focus to
// the page's h1 (the topbar's search is gone too) instead of losing it.
test("quick search returns focus when its button is gone", async ({ page }) => {
  await start(page, desktop);
  const button = page
    .getByRole("banner")
    .getByRole("button", { name: "Quick search", exact: true });
  await button.click();
  const dialog = quickSearch(page);
  await expect(dialog).toBeVisible();
  await page.setViewportSize(phone);
  await expect(button).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const h1 = page.locator("main h1").first();
  await expect(h1).toBeFocused();
  // Back at the desktop width, the button takes focus again.
  await page.setViewportSize(desktop);
  await button.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();
});

test("quick search keeps its size when the titles arrive", async ({ page }) => {
  await start(page, desktop);
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/api\/files\?.*limit=6/, async (route) => {
    await held;
    await route.fallback();
  });
  const dialog = quickSearch(page);
  const list = dialog.getByRole("listbox");
  const boxes = async () => ({
    dialog: await dialog.boundingBox(),
    field: await dialog
      .getByRole("combobox", { name: "Quick search" })
      .boundingBox(),
    first: await dialog.getByRole("option").first().boundingBox(),
  });
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Quick search", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  const rest = await boxes();
  await page.keyboard.type("da");
  await expect(list).toHaveAttribute("aria-busy", "true");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  const waiting = await boxes();
  release();
  await expect(dialog.getByRole("group", { name: "TV series" })).toBeVisible();
  await expect(list).not.toHaveAttribute("aria-busy");
  await expect(dialog.getByRole("option").first()).toHaveAccessibleName(
    "Dashboard Library",
  );
  const arrived = await boxes();
  expect(await dialog.getByRole("option").count()).toBeGreaterThan(1);
  for (const [label, box] of [
    ["while the titles wait", waiting],
    ["after they arrived", arrived],
  ] as const)
    for (const part of ["dialog", "field", "first"] as const)
      for (const side of ["x", "y", "width", "height"] as const)
        expectSame(
          box[part]![side],
          rest[part]![side],
          `${label}: ${part} ${side}`,
        );
  // No match: the same box.
  await page.keyboard.type("zzz");
  await expect(dialog.getByText("No matches.", { exact: true })).toBeVisible();
  const empty = (await dialog.boundingBox())!;
  for (const side of ["x", "y", "width", "height"] as const)
    expectSame(empty[side], rest.dialog![side], `without a match: ${side}`);
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
    // Focus returns to Tools, as from the drawer to More (M1).
    await expect(tools).toBeFocused();
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

// Final review M6: every target is at least 44 × 44, and the state's own
// region has a visible target, so a selector that matches nothing (a
// renamed class) fails instead of passing.
async function expectTargets(
  page: Page,
  regions: string,
  what: string,
  shown: string,
) {
  // Links, buttons and the sync controls of the frame that a touch reaches
  // (smallTargets, app.ts); `checked` counts those of `shown`.
  const { checked, small } = await smallTargets(page, regions, {
    counted: shown,
  });
  expect(
    checked,
    `${what}: no visible target matches ${shown}`,
  ).toBeGreaterThan(0);
  expect(small, what).toEqual([]);
}

// Hit areas (box, or a wider invisible ::after centered on it) of the
// topbar's end that overlap their neighbour, as "a | b: overlap px".
async function hitOverlaps(page: Page) {
  return page.evaluate(() => {
    const areas = [...document.querySelectorAll(".v2-topbar-end > *")]
      .filter((element) => element.checkVisibility())
      .map((element) => {
        const box = element.getBoundingClientRect();
        const after = getComputedStyle(element, "::after");
        const width =
          after.content !== "none" && after.position === "absolute"
            ? Math.max(box.width, parseFloat(after.width) || 0)
            : box.width;
        const center = box.left + box.width / 2;
        return {
          name:
            element.getAttribute("aria-label") ||
            element.textContent?.trim() ||
            element.tagName,
          left: center - width / 2,
          right: center + width / 2,
        };
      });
    return areas.slice(1).flatMap((area, index) => {
      const overlap = areas[index].right - area.left;
      return overlap > 0.5
        ? [`${areas[index].name} | ${area.name}: ${overlap}px`]
        : [];
    });
  });
}

test("touch targets reach 44 px on a coarse pointer", async ({ browser }) => {
  const targets =
    "#v2-sidebar :is(a, button), .v2-fly a, .v2-topbar :is(a, button), .v2-tabbar :is(a, button), .v2-pop :is(a, button)";
  // The regions of the states.
  const sidebar = "#v2-sidebar :is(a, button)",
    pop = ".v2-pop :is(a, button)",
    bars = ".v2-topbar :is(a, button), .v2-tabbar :is(a, button)",
    rail = "#v2-sidebar :is(a, button), .v2-topbar :is(a, button)";
  await test.step("phone", async () => {
    const page = await touchPage(browser, phone, { isMobile: true });
    await withTwoMovieInstances(page);
    await openApp(page);
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      "a coarse pointer",
    ).toBe(true);
    await expectTargets(page, targets, "topbar and tab bar", bars);
    await mainNavigation(page)
      .getByRole("button", { name: "Tools", exact: true })
      .tap();
    await expect(page.getByRole("menu", { name: "Tools" })).toBeVisible();
    await expectTargets(page, targets, "tools menu", pop);
    await page.keyboard.press("Escape");
    await mainNavigation(page)
      .getByRole("button", { name: "More", exact: true })
      .tap();
    const drawer = page.getByRole("dialog", { name: "Main navigation" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: "Settings", exact: true }).tap();
    await expectTargets(page, targets, "drawer", sidebar);
    // The sync popover of the drawer row.
    await drawer.locator(".v2-sync--row").tap();
    await expect(syncPopover(page)).toBeVisible();
    await expectTargets(page, targets, "sync popover", pop);
    expect(await hitOverlaps(page), "phone topbar").toEqual([]);
    await page.context().close();
  });
  // A tablet in landscape with the rail: the chip shows its text.
  await test.step("tablet rail", async () => {
    const page = await touchPage(browser, { width: 1024, height: 768 });
    await withTwoMovieInstances(page);
    await openApp(page);
    await expectTargets(page, targets, "rail and topbar", rail);
    const nav = mainNavigation(page);
    for (const name of ["Movies", "Settings"]) {
      await nav
        .getByRole(name === "Settings" ? "button" : "link", {
          name,
          exact: true,
        })
        .tap();
      await expect(fly(page)).toHaveAttribute("data-open", "");
      await expectTargets(page, targets, `${name} flyout`, ".v2-fly a");
    }
    expect(await hitOverlaps(page), "topbar at 1024").toEqual([]);
    await page.context().close();
  });
  // Carry-forward (c): a tablet in portrait with the rail. Below 900 the
  // sync chip shows only its dot and is 28 × 28; its invisible hit area
  // reaches 44 × 44 (Part 1, 10.7) and overlaps neither neighbour.
  await test.step("tablet rail below 900: the dot-only sync chip", async () => {
    const page = await touchPage(browser, sizeOf(820));
    await withTwoMovieInstances(page);
    await openApp(page);
    const chip = page.getByRole("banner").locator(".v2-sync-chip");
    await expect(chip.locator(".v2-sync-text")).toBeHidden();
    const box = (await chip.boundingBox())!;
    expectSame(box.width, 28, "chip width");
    expectSame(box.height, 28, "chip height");
    await expectTargets(page, targets, "rail and topbar", rail);
    expect(await hitOverlaps(page), "topbar at 820").toEqual([]);
    await chip.tap();
    await expect(syncPopover(page)).toBeVisible();
    await expectTargets(page, targets, "sync popover", pop);
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

// Sign-in and setup (Task 15): recorded from the first script on, when the
// loading screen and the sign-in page first enter the document (a
// MutationObserver, before they paint) and in every animation frame of the
// sign-in page after that.
async function recordStartScreens(page: Page) {
  await page.addInitScript(() => {
    type Boxes = { [key: string]: [number, number, number, number] };
    const w = window as unknown as {
      __start: {
        loading?: Boxes;
        appearance?: { theme?: string; band?: string };
        first?: Boxes;
        frames: Boxes[];
      };
    };
    const read = (): Boxes => {
      const boxes: Boxes = {};
      const add = (key: string, element: Element | null) => {
        if (!element) return;
        const { x, y, width, height } = element.getBoundingClientRect();
        boxes[key] = [x, y, width, height];
      };
      add("loading icon", document.querySelector(".v2-loading img"));
      add("icon", document.querySelector(".v2-login-band img"));
      add("name", document.querySelector(".v2-login-band h1"));
      add("claim", document.querySelector(".v2-login-band p"));
      add("card", document.querySelector(".v2-login-card"));
      add("heading", document.querySelector(".v2-login-head h2"));
      add("language", document.querySelector(".v2-login-head select"));
      add("footer", document.querySelector(".v2-login-foot"));
      document
        .querySelectorAll(".v2-login-card :is(input, button, .v2-notice)")
        .forEach((element, index) => add(`control ${index}`, element));
      return boxes;
    };
    const start: (typeof w)["__start"] = (w.__start = { frames: [] });
    const observer = new MutationObserver(() => {
      if (!start.loading && document.querySelector(".v2-loading")) {
        start.loading = read();
        const root = document.documentElement;
        start.appearance = {
          theme: root.dataset.theme,
          band: root.dataset.band,
        };
      }
      if (!start.first && document.querySelector(".v2-login")) {
        start.first = read();
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
    const frame = () => {
      if (document.querySelector(".v2-login")) start.frames.push(read());
      if (start.frames.length < 60) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

test.describe("signed out start screens", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("sign-in and setup do not move after their first paint", async ({
    page,
  }) => {
    await recordStartScreens(page);
    await page.addInitScript(() => {
      try {
        localStorage.setItem("scopearr-theme", "light");
      } catch {
        // Storage can be blocked; the default theme is then used.
      }
    });
    // The status answers wait 300 ms, so the loading screen paints first;
    // for setup they say the instance is not initialized.
    let setup = false;
    await page.route(/\/api\/status$/, async (route) => {
      await new Promise((done) => setTimeout(done, 300));
      if (!setup || route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      const status = await response.json();
      status.initialized = false;
      await route.fulfill({ response, json: status });
    });
    for (const screen of ["sign-in", "setup"] as const) {
      setup = screen === "setup";
      for (const size of [desktop, phone]) {
        await test.step(`${screen} at ${label(size)}`, async () => {
          await page.setViewportSize(size);
          await page.goto("about:blank");
          await page.goto("/");
          await expect(
            page.getByRole("button", {
              name: screen === "setup" ? "Create account" : "Sign in",
              exact: true,
            }),
          ).toBeVisible();
          await expect(page.locator(".v2-login-head select")).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  (window as unknown as { __start: { frames: unknown[] } })
                    .__start.frames.length,
              ),
            )
            .toBe(60);
          const { start, final } = await page.evaluate(() => {
            const w = window as unknown as {
              __start: {
                loading?: Record<string, number[]>;
                appearance?: { theme?: string; band?: string };
                first?: Record<string, number[]>;
                frames: Record<string, number[]>[];
              };
            };
            const final: Record<string, number[]> = {};
            for (const [key, element] of [
              ["icon", ".v2-login-band img"],
              ["name", ".v2-login-band h1"],
              ["claim", ".v2-login-band p"],
              ["card", ".v2-login-card"],
              ["heading", ".v2-login-head h2"],
              ["language", ".v2-login-head select"],
              ["footer", ".v2-login-foot"],
            ] as const) {
              const { x, y, width, height } = document
                .querySelector(element)!
                .getBoundingClientRect();
              final[key] = [x, y, width, height];
            }
            document
              .querySelectorAll(".v2-login-card :is(input, button, .v2-notice)")
              .forEach((element, index) => {
                const { x, y, width, height } = element.getBoundingClientRect();
                final[`control ${index}`] = [x, y, width, height];
              });
            return { start: w.__start, final };
          });
          const where = `${screen} at ${label(size)}`;
          // The loading screen came first, already in the stored theme and
          // the band of its mode (E13).
          expect(start.loading, `${where}: no loading screen`).toBeTruthy();
          expect(start.appearance).toEqual({ theme: "light", band: "strong" });
          // The icon stays where the loading screen showed it.
          const icon = start.loading!["loading icon"];
          expect(icon, `${where}: the loading screen has no icon`).toBeTruthy();
          icon.forEach((value, i) =>
            expectSame(
              value,
              final.icon[i],
              `${where}: loading → sign-in icon`,
            ),
          );
          // The demo notice, the fields (setup: with its code), the password
          // toggle and the button.
          expect(
            Object.keys(final).filter((key) => key.startsWith("control "))
              .length,
            where,
          ).toBe(screen === "setup" ? 6 : 5);
          const moved = (boxes: Record<string, number[]>, when: string) => [
            ...Object.keys(final)
              .filter((key) => !boxes[key])
              .map((key) => `${when}: ${key} missing`),
            ...Object.entries(boxes)
              .filter(([key]) => key !== "loading icon")
              .filter(
                ([key, box]) =>
                  !final[key] ||
                  box.some(
                    (value, i) => Math.abs(value - final[key][i]) > TOLERANCE,
                  ),
              )
              .map(([key, box]) => `${when}: ${key} ${box} → ${final[key]}`),
          ];
          expect(moved(start.first!, "first paint"), where).toEqual([]);
          expect(
            start.frames.flatMap((boxes, index) =>
              moved(boxes, `frame ${index}`),
            ),
            where,
          ).toEqual([]);
        });
      }
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
    "Display",
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

// D30 R7: on phones the theme switch is in the topbar only; the drawer
// (More) holds Sign out, which the phone topbar leaves out.
test("phones switch the theme in the topbar only", async ({ page }) => {
  await start(page, phone, "#/dashboard");
  const banner = page.getByRole("banner");
  await expect(
    banner.getByRole("button", { name: /^(Light|Dark) theme$/ }),
  ).toHaveCount(1);
  await expect(
    banner.getByRole("button", { name: "Sign out", exact: true }),
  ).toHaveCount(0);
  await mainNavigation(page)
    .getByRole("button", { name: "More", exact: true })
    .click();
  const drawer = page.locator("#v2-sidebar");
  await expect(
    drawer.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: /^(Light|Dark) theme$/ }),
  ).toHaveCount(0);
});
