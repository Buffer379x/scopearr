// axe-core on the frame (D18, E23): WCAG 2.0 and 2.1, A and AA, on the
// visible frame regions in every mode and its open states. Zero violations;
// incomplete results are logged. The 1.7.0 content is checked with its
// rebuild in Phase 5; sign-in, setup and the loading screen are v2 as a
// whole (Task 15).
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  axeDialog,
  axeFrame,
  axeScreen,
  axeView,
  columnsButton,
  columnsMenu,
  currentHash,
  DIALOG_OPENERS,
  filterDrawer,
  goTo,
  inLanguage,
  L,
  LANGUAGES,
  pageOverflowX,
  jobsMenu,
  keepColumnSaves,
  mainNavigation,
  openApp,
  openDialog,
  openRoute,
  quickSearch,
  setColumns,
  settle,
  storageArea,
  syncPopover,
  withAudioTracks,
  withMoreValues,
  withOpenJobs,
  withStatus,
  withTwoMovieInstances,
  type DialogId,
  type Theme,
} from "./app";
import { withFindings, withMuxJobs, withPlacement } from "./tool-fixtures";
import { interfaceThemes } from "../src/themes";

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
  // Toasts in the region (Phase 5d): a success, an error and one with a
  // link, none excluded.
  await page.evaluate(() => {
    const send = (detail: object) =>
      window.dispatchEvent(
        new CustomEvent("scopearr-notification", { detail }),
      );
    send({ message: "Filter view saved.", kind: "success" });
    send({ message: "Request failed.", kind: "error" });
    send({
      message: "Marked for muxing.",
      kind: "success",
      action: { label: "Open Muxing", hash: "#/tools/mux" },
    });
  });
  await expect(page.locator(".v2-toast")).toHaveCount(3);
  await expect(
    page.getByRole("region", { name: "Notifications" }),
  ).toBeVisible();
  // axe reads the toasts once their entry animations ended (Task 4 M4).
  await page
    .locator(".v2-toast")
    .evaluateAll((toasts) =>
      Promise.all(
        toasts.flatMap((toast) =>
          toast
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished),
        ),
      ),
    );
  await axeFrame(page, `${label} with success, error and link toasts`);
  for (let left = 3; left > 0; left--)
    await page
      .getByRole("button", { name: "Dismiss notification" })
      .first()
      .click();
  await expect(page.locator(".v2-toast")).toHaveCount(0);
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

// The sync popover open from the sync display of this mode: the chip
// (rail), the card (expanded) or the drawer row.
async function checkSyncPopover(page: Page, label: string) {
  const mode = await page.locator("#v2-sidebar").getAttribute("data-mode");
  if (mode === "drawer") {
    await mainNavigation(page)
      .getByRole("button", { name: "More", exact: true })
      .click();
    await page.locator("#v2-sidebar .v2-sync--row").click();
  } else if (mode === "expanded")
    await page.locator("#v2-sidebar .v2-sync--card").click();
  else await page.getByRole("banner").locator(".v2-sync-chip").click();
  await expect(syncPopover(page)).toBeVisible();
  await axeFrame(page, `${label} with the sync popover (${mode})`);
  await page.keyboard.press("Escape");
  await expect(syncPopover(page)).toHaveCount(0);
  if (mode === "drawer") await page.keyboard.press("Escape");
}

test("the frame has no axe violations", async ({ page }) => {
  test.setTimeout(240_000);
  for (const item of cases) {
    await test.step(name(item), async () => {
      await page.setViewportSize(item);
      await openApp(page, { theme: item.theme });
      await checkStates(page, name(item));
      // Without an enabled instance there is no sync display (Task 11).
      await expect(
        page.locator(".v2-sync-chip, .v2-sync--card, .v2-sync--row"),
      ).toHaveCount(0);
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
      await checkSyncPopover(page, `${name(item)} with instances`);
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

// The sync popover with unlocked buttons (outside the demo) and without any
// sync data ("Not synced yet"), in each mode and both themes.
test("the sync popover has no axe violations without sync data", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await withTwoMovieInstances(page);
  await withStatus(page, (status) => {
    status.demo = false;
    delete status.sync;
  });
  for (const item of [cases[0], cases[2], cases[3], cases[5]]) {
    await test.step(name(item), async () => {
      await page.setViewportSize(item);
      await openApp(page, { theme: item.theme });
      await checkSyncPopover(page, `${name(item)} without sync data`);
    });
  }
});

// The bell's jobs menu (Task 12) in each mode: in the demo without open
// jobs ("No open jobs."), then with open jobs (tool rows, their jobs,
// "Show in log") once they have loaded.
test("the jobs menu has no axe violations", async ({ page }) => {
  test.setTimeout(240_000);
  const check = async (jobs: boolean) => {
    for (const item of [cases[0], cases[2], cases[3], cases[4]]) {
      const label = `${name(item)} with the jobs menu${jobs ? " and jobs" : ""}`;
      await test.step(label, async () => {
        await page.setViewportSize(item);
        await openApp(page, { theme: item.theme });
        await page
          .getByRole("banner")
          .getByRole("button", { name: /open jobs/ })
          .click();
        const menu = jobsMenu(page);
        await expect(menu).toBeVisible();
        if (jobs)
          await expect(menu.locator(".v2-job:not([aria-hidden])")).toHaveCount(
            6,
          );
        else await expect(menu).toContainText("No open jobs.");
        await axeFrame(page, label);
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
      });
    }
  };
  await check(false);
  await withOpenJobs(page);
  await check(true);
  // Fix round 1: while the jobs load (answers held), with the placeholder
  // rows in their place.
  await test.step("1440x900-light while the jobs load", async () => {
    await page.setViewportSize(cases[2]);
    await openApp(page, { theme: cases[2].theme });
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      /\/api\/(mux\/jobs$|filecheck\/items\?)/,
      async (route) => {
        await held;
        await route.fallback();
      },
    );
    await page
      .getByRole("banner")
      .getByRole("button", { name: /open jobs/ })
      .click();
    const menu = jobsMenu(page);
    await expect(menu.locator('.v2-job[aria-hidden="true"]')).toHaveCount(6);
    await axeFrame(
      page,
      "1440x900-light with the jobs menu while its jobs load",
    );
    release();
    await expect(menu.locator(".v2-job:not([aria-hidden])")).toHaveCount(6);
    await page.keyboard.press("Escape");
  });
});

// Quick search (Task 13) in each mode, opened with Ctrl+K (phones have no
// button): with its pages and titles, without a match, and while its
// titles are on their way (answers held).
test("quick search has no axe violations", async ({ page }) => {
  test.setTimeout(240_000);
  // The title answers of the query "wait" are held until released.
  const held: (() => void)[] = [];
  await page.route(/\/api\/files\?.*limit=6/, async (route) => {
    if (route.request().url().includes("q=wait"))
      await new Promise<void>((resolve) => held.push(resolve));
    await route.fallback();
  });
  for (const item of [cases[0], cases[2], cases[3], cases[4]]) {
    await test.step(`${name(item)} with quick search`, async () => {
      await page.setViewportSize(item);
      await openApp(page, { theme: item.theme });
      await page.keyboard.press("Control+k");
      const dialog = quickSearch(page);
      const field = dialog.getByRole("combobox", { name: "Quick search" });
      const list = dialog.getByRole("listbox");
      await expect(field).toBeFocused();
      await axeFrame(page, `${name(item)} with quick search and its pages`);
      await field.fill("da");
      await expect(
        dialog.getByRole("group", { name: "TV series" }),
      ).toBeVisible();
      await expect(list).not.toHaveAttribute("aria-busy");
      await axeFrame(page, `${name(item)} with quick search and titles`);
      await field.fill("zzz");
      await expect(
        dialog.getByText("No matches.", { exact: true }),
      ).toBeVisible();
      await axeFrame(page, `${name(item)} with quick search without a match`);
      await field.fill("wait");
      await expect(list).toHaveAttribute("aria-busy", "true");
      await expect.poll(() => held.length).toBe(2);
      await axeFrame(
        page,
        `${name(item)} with quick search while its titles load`,
      );
      for (const go of held.splice(0)) go();
      await expect(list).not.toHaveAttribute("aria-busy");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    });
  }
});

// The libraries (Phase 5a, E28): axeView on the content of Movies and TV
// series and axeFrame on the frame with the instance segment, in each mode
// and theme: the list (card rows at 375), the column menu, the track menu, the "+n" popover
// and the sort menu of the audio tracks (Arrival with four tracks), the
// filter drawer with an open value list, its operator menu and its help,
// the TV series' group rows and the empty state.
test("the libraries have no axe violations", async ({ page }) => {
  test.setTimeout(480_000);
  await withTwoMovieInstances(page);
  await withAudioTracks(page);
  await keepColumnSaves(page);
  const shown = async (locator: Locator, what: string, label: string) => {
    await expect(locator).toBeVisible();
    await axeView(page, `${label} with ${what}`);
    await page.keyboard.press("Escape");
    await expect(locator).toHaveCount(0);
  };
  for (const item of cases) {
    const label = name(item);
    await test.step(label, async () => {
      await page.setViewportSize(item);
      await openApp(page, { theme: item.theme });
      await goTo(page, "movies");
      await expect(page.locator(".v2-row--placeholder")).toHaveCount(0);
      await axeView(page, `${label} movies`);
      await axeFrame(page, `${label} movies`);
      const main = page.getByRole("main");
      await columnsButton(page).click();
      await shown(columnsMenu(page), "the column menu", label);
      const hidden = await setColumns(page, null, true);
      const arrival = main.getByRole("row").filter({
        has: page.getByRole("checkbox", { name: "Select Arrival" }),
      });
      // rc.4 R6: a phone card has no track chips, "+n" or column heads to
      // press; its row menu and the sort menu instead.
      if (item.width <= 739) {
        await main
          .getByRole("button", { name: "Actions: Arrival", exact: true })
          .click();
        await shown(
          page.getByRole("menu", { name: "Actions: Arrival" }),
          "the row menu",
          label,
        );
        await main.getByRole("button", { name: /^Sort: / }).click();
        await shown(
          page.getByRole("menu", { name: "Sort by" }),
          "the sort menu",
          label,
        );
      }
      if (item.width > 739) {
        await arrival
          .getByRole("button", {
            name: "Track 1 · German · DTS · 5.1 · Default track",
            exact: true,
          })
          .click();
        await shown(
          page.getByRole("menu", { name: "Filter by this track" }),
          "the track menu",
          label,
        );
        await arrival
          .getByRole("button", {
            name: "+2 · Show all 4 audio tracks",
            exact: true,
          })
          .click();
        await shown(
          page.getByRole("dialog", { name: "Audio tracks of Arrival" }),
          "the tracks popover",
          label,
        );
        await main
          .getByRole("button", { name: "Sort by Audio tracks", exact: true })
          .click();
        await shown(
          page.getByRole("menu", { name: "Sort by Audio tracks" }),
          "the sort menu",
          label,
        );
      }
      await setColumns(page, hidden, false);
      await main.getByRole("button", { name: "Filters", exact: true }).click();
      const drawer = filterDrawer(page);
      await expect(drawer).toBeVisible();
      await settle(page);
      await axeView(page, `${label} with the filter drawer`);
      await drawer
        .getByRole("button", { name: "Resolution All", exact: true })
        .click();
      await expect(drawer.locator(".v2-ff-opt").first()).toBeVisible();
      await axeView(page, `${label} with the drawer's values`);
      await drawer
        .getByRole("button", {
          name: "HDR: contains at least one",
          exact: true,
        })
        .click();
      await shown(
        page.getByRole("menu", { name: "HDR: operator" }),
        "the drawer's operator menu",
        label,
      );
      await drawer
        .getByRole("button", { name: "Filter logic", exact: true })
        .click();
      await shown(page.locator(".v2-pop"), "the drawer's help", label);
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await goTo(page, "series");
      await expect(page.locator(".v2-row--placeholder")).toHaveCount(0);
      await axeView(page, `${label} TV series`);
      // rc.3 K3: a collapsed series (its toggle without aria-controls).
      await page.getByRole("button", { name: "Hide episodes: Dark" }).click();
      await expect(
        page.getByRole("button", { name: "Show episodes: Dark" }),
      ).toBeFocused();
      await axeView(page, `${label} TV series with Dark collapsed`);
      // rc.4 R2: the collapsed series view, a page of series rows.
      await page
        .getByRole("button", { name: "Collapse all series", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Expand all series", exact: true }),
      ).toBeFocused();
      await expect(page.locator(".v2-table > tbody > tr.v2-row")).toHaveCount(
        0,
      );
      // The rows are no longer dimmed for the request.
      await expect(
        page.getByRole("main").locator(".v2-table-scroll"),
      ).toHaveAttribute("aria-busy", "false");
      await settle(page);
      await axeView(page, `${label} TV series collapsed`);
      await page
        .getByRole("button", { name: "Expand all series", exact: true })
        .click();
      await expect.poll(() => currentHash(page)).toBe("#/series");
      await page.evaluate(() => {
        location.hash = "#/movies?q=zzzz";
      });
      await expect.poll(() => currentHash(page)).toBe("#/movies?q=zzzz");
      await expect(
        page.getByText("No matching files.", { exact: true }),
      ).toBeVisible();
      await axeView(page, `${label} with the empty state`);
      // The library keeps its filters through a reload: the next case
      // starts without them.
      await main
        .getByRole("button", { name: "Reset filters", exact: true })
        .first()
        .click();
      await expect.poll(() => currentHash(page)).toBe("#/movies");
    });
  }
});

// The tool pages (Phase 5b, E29): axeView on their content and axeFrame on
// the frame, in each mode and theme, with the rows, KPI cards and disk
// cards of the tool fixtures: loaded (Disk placement's disk row
// overflowing, a focusable region, at 820 and 375), with a pressed KPI
// card, the filter drawer, the HelpTip and a row's status dialog open,
// empty (no matching jobs) and pending (every answer held: placeholders).
test("the tools have no axe violations", async ({ page }) => {
  test.setTimeout(600_000);
  await withMuxJobs(page);
  await withPlacement(page, { standby: true });
  await withFindings(page);
  // Holds every tool answer while `holding`.
  let holding = false;
  const held: (() => void)[] = [];
  await page.route(
    /\/api\/(mux\/jobs$|placement\/(scan$|items\?)|unraid\/status$|filecheck\/(scan$|items\?))/,
    async (route) => {
      if (holding) await new Promise<void>((done) => held.push(done));
      await route.fallback();
    },
  );
  const main = page.getByRole("main");
  const rows = page.locator("table.v2-table--fixed > tbody > tr");
  const open = async (hash: string, theme: Theme) => {
    await page.goto("about:blank");
    await openRoute(page, hash, { theme });
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    await settle(page);
  };
  for (const item of cases) {
    const label = name(item);
    await test.step(label, async () => {
      await page.setViewportSize(item);
      for (const tool of ["mux", "placement", "files"]) {
        const where = `${label} ${tool}`;
        await open("#/tools/" + tool, item.theme);
        await axeView(page, where);
        await axeFrame(page, where);
        if (tool === "placement" && item.width <= 820) {
          await expect(main.locator(".v2-disks")).toHaveAttribute(
            "data-overflow",
            "",
          );
          await expect(
            main.getByRole("region", { name: "Disks and pools", exact: true }),
          ).toHaveAttribute("tabindex", "0");
        }
        if (tool !== "placement") {
          const kpi = main
            .locator("section.v2-dash-kpis")
            .getByRole("button", { name: /^(Failed|Open) / });
          await kpi.first().click();
          await expect(kpi.first()).toHaveAttribute("aria-pressed", "true");
          await axeView(page, `${where} with a pressed KPI card`);
          await kpi.first().click();
          await expect(kpi.first()).toHaveAttribute("aria-pressed", "false");
        }
        await main
          .getByRole("button", { name: "Filters", exact: true })
          .click();
        const drawer = filterDrawer(page);
        await expect(drawer).toBeVisible();
        await expect(drawer.getByRole("button", { name: /^Apply/ })).toHaveText(
          /\(\d+ match(es)?\)/,
        );
        await axeView(page, `${where} with the filter drawer`);
        await page.keyboard.press("Escape");
        await expect(drawer).toHaveCount(0);
        await main.getByRole("button", { name: "Help", exact: true }).click();
        const help = page.getByRole("dialog", { name: "Help", exact: true });
        await expect(help).toBeVisible();
        await axeView(page, `${where} with the help`);
        await page.keyboard.press("Escape");
        await expect(help).toHaveCount(0);
        await rows
          .first()
          .getByRole("button", { name: /^Status: / })
          .click();
        // Every tool's status is a v2 modal (Phase 5d).
        const dialog = page.locator("dialog.v2-modal[open]");
        await expect(dialog).toBeVisible();
        await axeView(page, `${where} with a status dialog`);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      }
      await page.evaluate(() => {
        location.hash = "#/tools/mux?q=zzzz";
      });
      await expect(
        main.getByText("No matching jobs.", { exact: true }),
      ).toBeVisible();
      await axeView(page, `${label} with the empty state`);
      // The page keeps its filters: the next steps start without them.
      await main
        .getByRole("button", { name: "Reset filters", exact: true })
        .first()
        .click();
      await expect.poll(() => currentHash(page)).toBe("#/tools/mux");
      for (const tool of ["mux", "placement", "files"]) {
        // From another page (a hash change), so the tool mounts and asks.
        await page.evaluate(() => {
          location.hash = "#/settings";
        });
        await expect(
          page.getByRole("heading", { level: 1, name: "Services" }),
        ).toBeVisible();
        holding = true;
        await page.evaluate((hash) => {
          location.hash = hash;
        }, "#/tools/" + tool);
        await expect.poll(() => held.length).toBeGreaterThan(0);
        await expect(main.locator(".v2-empty")).toHaveAttribute(
          "aria-hidden",
          "true",
        );
        await axeView(page, `${label} ${tool} pending`);
        holding = false;
        for (const go of held.splice(0)) go();
        await expect(rows.first()).toBeVisible({ timeout: 15_000 });
      }
    });
  }
});

// The dashboard (Phase 5a, E28): axeView on its content and axeFrame on
// the frame, in each mode and theme: loaded (the Codec card with More, the
// storage ring with an area's error), with a matching HelpTip open, with
// More open, on the TV series tab, while loading (placeholders), empty (no
// files in cache, no storage paths) and after a failed load with Retry.
test("the dashboard has no axe violations", async ({ page }) => {
  test.setTimeout(480_000);
  let mode: "data" | "empty" | "error" | "hold" = "data";
  const held: (() => void)[] = [];
  const zero = { all: 0, radarr: 0, sonarr: 0 };
  await withMoreValues(page);
  await page.route(/\/api\/statistics$/, async (route) => {
    if (mode === "error")
      return route.fulfill({ status: 500, json: { error: "unavailable" } });
    if (mode === "empty")
      return route.fulfill({
        json: {
          fileTotals: zero,
          languageTotals: zero,
          movies: 0,
          series: 0,
          episodes: 0,
          files: 0,
          emby: {},
          incomplete: 0,
          distributions: { all: {}, radarr: {}, sonarr: {} },
        },
      });
    if (mode === "hold") await new Promise<void>((go) => held.push(go));
    await route.fallback();
  });
  await page.route(/\/api\/storage$/, (route) =>
    mode === "empty"
      ? route.fallback()
      : route.fulfill({
          json: {
            services: {},
            areas: {
              all: [
                storageArea("movies", 9.3, {
                  error:
                    "Shared storage readings have different total capacities",
                }),
                storageArea("series", 3),
              ],
              radarr: [],
              sonarr: [],
            },
          },
        }),
  );
  const main = page.getByRole("main");
  const kpi = page.locator(".v2-dash-kpis .v2-kpi-value").first();
  for (const item of cases) {
    const label = name(item);
    await test.step(label, async () => {
      mode = "data";
      await page.setViewportSize(item);
      await openApp(page, { theme: item.theme });
      await expect(kpi).toHaveText(/\d/);
      await expect(main.locator(".v2-ring-error")).toBeVisible();
      await axeView(page, `${label} dashboard`);
      await axeFrame(page, `${label} dashboard`);
      await main.getByRole("button", { name: "Matched", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Matched" })).toBeVisible();
      await axeView(page, `${label} with a HelpTip`);
      await page.keyboard.press("Escape");
      await expect(page.locator(".v2-pop")).toHaveCount(0);
      await main.getByRole("button", { name: "More", exact: true }).click();
      await expect(
        main.getByRole("button", { name: "Less", exact: true }),
      ).toBeVisible();
      await axeView(page, `${label} with More open`);
      await main
        .getByRole("tablist", { name: "Statistics scope" })
        .getByRole("tab", { name: "TV series", exact: true })
        .click();
      await settle(page);
      await axeView(page, `${label} TV series`);
      // The next case starts on the entire library.
      await main
        .getByRole("tab", { name: "Entire library", exact: true })
        .click();

      mode = "hold";
      await page.goto("about:blank");
      await page.goto("/#/dashboard");
      await expect(
        page.getByRole("status").filter({ hasText: "Loading dashboard …" }),
      ).toHaveCount(1);
      await page.evaluate(() => document.fonts.ready);
      await axeView(page, `${label} while loading`);
      mode = "data";
      for (const go of held.splice(0)) go();
      await expect(kpi).toHaveText(/\d/);

      mode = "empty";
      await openApp(page, { theme: item.theme });
      await expect(
        main.getByText("No files in cache yet", { exact: true }),
      ).toHaveCount(5);
      await expect(main.locator(".v2-ring-note")).toBeVisible();
      await axeView(page, `${label} empty`);

      mode = "error";
      await openApp(page, { theme: item.theme });
      const retry = main.getByRole("button", { name: "Retry", exact: true });
      await expect(retry).toBeVisible();
      await axeView(page, `${label} after a failed load`);
      await axeFrame(page, `${label} after a failed load`);
    });
  }
});

// Sign-in, setup and the loading screen (Task 15), as whole pages in both
// themes at 1440 and 375: the password hidden and shown (ruling R-A); setup
// with its code field; the loading screen while the status is held. Each
// case is a fresh signed-out browser context with its stored theme.
const screens = [cases[1], cases[2], cases[4], cases[5]];

async function signedOut(browser: Browser, item: Case): Promise<Page> {
  const { baseURL, locale } = test.info().project.use;
  const context = await browser.newContext({
    baseURL,
    locale,
    viewport: { width: item.width, height: item.height },
    reducedMotion: "reduce",
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.addInitScript((value) => {
    try {
      localStorage.setItem("scopearr-theme", value);
    } catch {
      // Storage can be blocked; the default theme is then used.
    }
  }, item.theme);
  return page;
}

async function checkPassword(page: Page, label: string) {
  await axeScreen(page, label);
  const toggle = page.getByRole("button", {
    name: "Show password",
    exact: true,
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await axeScreen(page, `${label} with the password shown`);
}

test("the sign-in page has no axe violations", async ({ browser }) => {
  test.setTimeout(240_000);
  for (const item of screens) {
    await test.step(name(item), async () => {
      const page = await signedOut(browser, item);
      await page.goto("/");
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
      await checkPassword(page, `${name(item)} sign-in`);
      await page.context().close();
    });
  }
});

test("setup and the loading screen have no axe violations", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  for (const item of screens) {
    await test.step(name(item), async () => {
      const page = await signedOut(browser, item);
      await withStatus(page, (status) => {
        (status as { initialized?: boolean }).initialized = false;
      });
      // The status answers are held: the loading screen stays.
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route(/\/api\/status$/, async (route) => {
        await held;
        await route.fallback();
      });
      await page.goto("/");
      await expect(page.locator(".v2-loading")).toBeVisible();
      await axeScreen(page, `${name(item)} loading screen`);
      release();
      await expect(
        page.getByRole("button", { name: "Create account", exact: true }),
      ).toBeVisible();
      await checkPassword(page, `${name(item)} setup`);
      await page.context().close();
    });
  }
});

// Fix round 1: sign-in after an expired session, with the warn-toned notice,
// in both themes. The session ends in this browser context only (as in
// behavior.spec), so the stored demo session stays valid.
test("sign-in after an expired session has no axe violations", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  for (const item of [cases[1], cases[2]]) {
    await test.step(name(item), async () => {
      const { baseURL, locale, storageState } = test.info().project.use;
      const context = await browser.newContext({
        baseURL,
        locale,
        storageState,
        viewport: { width: item.width, height: item.height },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await openApp(page, { theme: item.theme });
      await context.clearCookies();
      await page.evaluate(() =>
        window.dispatchEvent(new Event("scopearr:unauthorized")),
      );
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Your session expired. Sign in again." }),
      ).toBeVisible();
      await expect(page.locator(".v2-notice--warn")).toBeVisible();
      await axeScreen(page, `${name(item)} sign-in after an expired session`);
      await context.close();
    });
  }
});

// Fix round 1: fields and the language select show focus by their border
// and shadow, which forced colors drop; a transparent outline (painted by
// the system colors there) keeps their focus visible.
test("sign-in fields keep a focus outline in forced colors", async ({
  browser,
}) => {
  const page = await signedOut(browser, cases[1]);
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/");
  for (const control of [
    page.getByLabel("Username", { exact: true }),
    page.getByLabel("Password", { exact: true }),
    page.getByRole("combobox", { name: "Interface language" }),
  ]) {
    await control.focus();
    await expect(control).toBeFocused();
    expect(
      await control.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.outlineStyle, style.outlineWidth];
      }),
    ).toEqual(["solid", "2px"]);
  }
  await page.context().close();
});

// Final review I3: forced colors drop backgrounds, gradients and shadows,
// so quick search's field (no ring, the caret shows it), its active option
// (a tint) and the current page's tile in the rail and the tab bar (a
// gradient) carry a transparent 2px outline that forced colors paint. The
// other options and tiles have none; without forced colors it draws
// nothing (the pixel run).
test("frame markers stay visible in forced colors", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  const outline = (locator: Locator) =>
    locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        style: style.outlineStyle,
        width: style.outlineWidth,
        painted: !/^rgba\(.*,\s*0\)$|^transparent$/.test(style.outlineColor),
      };
    });
  const shown = { style: "solid", width: "2px", painted: true };
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  const nav = mainNavigation(page);

  await test.step("the rail's current page", async () => {
    const current = nav.locator('[aria-current="page"] .v2-tile');
    await expect(current).toHaveCount(1);
    expect(await outline(current)).toEqual(shown);
    const other = nav.getByRole("link", { name: "Movies", exact: true });
    expect((await outline(other.locator(".v2-tile"))).style).toBe("none");
  });

  await test.step("quick search's field and active option", async () => {
    await page.keyboard.press("Control+k");
    const dialog = quickSearch(page);
    const field = dialog.getByRole("combobox", { name: "Quick search" });
    await expect(field).toBeFocused();
    expect(await outline(field)).toEqual(shown);
    const options = dialog.getByRole("option");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    expect(await outline(options.first())).toEqual(shown);
    expect((await outline(options.nth(1))).style).toBe("none");
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    expect(await outline(options.nth(1))).toEqual(shown);
    expect((await outline(options.first())).style).toBe("none");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  await test.step("the tab bar's current page", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    const tabs = page.locator(".v2-tabbar");
    await expect(tabs).toBeVisible();
    const current = tabs.locator("[aria-current] .v2-tab-tile");
    await expect(current).toHaveCount(1);
    expect(await outline(current)).toEqual(shown);
    const other = tabs.getByRole("link", { name: "Movies", exact: true });
    expect((await outline(other.locator(".v2-tab-tile"))).style).toBe("none");
  });
});

// 5a final review I5 and M2: the current item of a segment (the
// dashboard's scope tab, the instance segment's link) and the current page
// button carry the inset transparent outline that forced colors paint
// (offset -2), and only while they have no focus: focused (by keyboard),
// they show the focus ring outside (offset 2), so focus stays visible on
// the current item (WCAG 2.4.7). The other items have no outline.
test("current items show their focus ring in forced colors", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await withTwoMovieInstances(page);
  const outline = (locator: Locator) =>
    locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        style: style.outlineStyle,
        width: style.outlineWidth,
        offset: style.outlineOffset,
        painted: !/^rgba\(.*,\s*0\)$|^transparent$/.test(style.outlineColor),
      };
    });
  const marked = {
    style: "solid",
    width: "2px",
    offset: "-2px",
    painted: true,
  };
  const ring = { ...marked, offset: "2px" };
  // Focus by keyboard, as a user tabs there: the ring is :focus-visible.
  const keyboardFocus = async (locator: Locator) => {
    await page.keyboard.press("Shift");
    await locator.focus();
    await expect(locator).toBeFocused();
    expect(
      await locator.evaluate((element) => element.matches(":focus-visible")),
    ).toBe(true);
  };
  const check = async (current: Locator, other: Locator) => {
    expect(await outline(current), "the current item").toEqual(marked);
    expect((await outline(other)).style, "another item").toBe("none");
    await keyboardFocus(current);
    expect(await outline(current), "the focused current item").toEqual(ring);
    await keyboardFocus(other);
    expect(await outline(current), "the current item again").toEqual(marked);
    expect(await outline(other), "the focused other item").toEqual(ring);
  };

  await test.step("the dashboard's scope tab", async () => {
    await openRoute(page, "#/dashboard");
    const tabs = page.getByRole("tablist", { name: "Statistics scope" });
    await check(
      tabs.getByRole("tab", { name: "Entire library", exact: true }),
      tabs.getByRole("tab", { name: "Movies", exact: true }),
    );
  });

  await test.step("the instance segment", async () => {
    await openRoute(page, "#/movies");
    const segment = page.getByRole("navigation", { name: "Instances" });
    await check(
      segment.getByRole("link", { name: "All", exact: true }),
      segment.getByRole("link", { name: "Radarr 4K", exact: true }),
    );
  });

  await test.step("the current page button", async () => {
    await openRoute(page, "#/series");
    const pager = page.getByRole("navigation", { name: "Page 1 / 2" });
    await check(
      pager.getByRole("button", { name: "1", exact: true }),
      pager.getByRole("button", { name: "2", exact: true }),
    );
  });
});

// The settings (Phase 5c, E30): axeView on each area's content and
// axeFrame on the frame, in each mode and theme: every service tab (two
// enabled movie instances, the demo has none), the three Display tabs,
// Widgets, Custom tags with its help open, Tag rules, System → Info and
// Log with its filter drawer open, and the save dock with a draft.
test("the settings have no axe violations", async ({ page }) => {
  test.setTimeout(600_000);
  await withTwoMovieInstances(page);
  const main = page.getByRole("main");
  const open = async (hash: string, theme: Theme) => {
    await page.goto("about:blank");
    await openRoute(page, hash, { theme });
    await settle(page);
  };
  for (const item of cases) {
    const label = name(item);
    await test.step(label, async () => {
      await page.setViewportSize(item);
      await open("#/settings/connections", item.theme);
      const tabs = page
        .getByRole("tablist", { name: "Configured services" })
        .getByRole("tab");
      for (let i = 0; i < (await tabs.count()); i++) {
        await tabs.nth(i).click();
        await expect(tabs.nth(i)).toHaveAttribute("aria-selected", "true");
        await settle(page);
        const where = `${label} Services, ${await tabs.nth(i).textContent()}`;
        await axeView(page, where);
        await axeFrame(page, where);
      }
      await page.getByLabel("Sync timezone", { exact: true }).fill("UTC");
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      await expect(page.locator(".v2-save-dock")).toBeVisible();
      await axeView(page, `${label} Services with the save dock`);
      for (const hash of [
        "#/settings/appearance/general",
        "#/settings/appearance/lists",
        "#/settings/appearance/colors",
        "#/settings/widgets",
        "#/settings/custom",
        "#/settings/recognition",
        "#/settings/system/info",
        "#/settings/system/log",
      ]) {
        const where = `${label} ${hash}`;
        await open(hash, item.theme);
        if (hash.endsWith("recognition"))
          await expect(
            main.locator("tbody tr:not(.v2-row--placeholder)").first(),
          ).toBeVisible();
        await axeView(page, where);
        await axeFrame(page, where);
        // The per-list switches of Movies and TV series (D31 S3).
        if (hash.endsWith("appearance/lists"))
          for (const list of ["Movies", "TV series"]) {
            await page
              .getByRole("tablist", { name: "Lists & columns" })
              .getByRole("tab", { name: new RegExp(`^${list}`) })
              .click();
            await expect(
              page.getByRole("checkbox", {
                name: "Show the filename below the title",
                exact: true,
              }),
            ).toBeVisible();
            await settle(page);
            await axeView(page, `${where} ${list}`);
          }
      }
      await main.getByRole("button", { name: "Filters", exact: true }).click();
      await expect(filterDrawer(page)).toBeVisible();
      await axeView(page, `${label} the log drawer`);
      await page.keyboard.press("Escape");
      await open("#/settings/custom", item.theme);
      await main
        .getByRole("button", { name: "Custom tags help", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Custom tags help" }),
      ).toBeVisible();
      await axeView(page, `${label} Custom tags with its help`);
    });
  }
});

// E35 (Phase 5d, Task 14): every dialog of DIALOGS, opened like a user, at
// 1440 dark and light and 375 dark; File & metadata also at 1600 dark and
// 820 light, with renaming open, the evidence menu open and on its
// MediaInfo tab. Zero violations, no rule turned off.
test.describe("every dialog has no axe violations", () => {
  const dialogCases: Case[] = [
    { width: 1440, height: 900, theme: "dark" },
    { width: 1440, height: 900, theme: "light" },
    { width: 375, height: 812, theme: "dark" },
  ];
  for (const id of Object.keys(DIALOG_OPENERS) as DialogId[])
    test(id, async ({ page }) => {
      test.setTimeout(180_000);
      const file = id === "file";
      if (file)
        await withStatus(page, (status) => {
          const s = status as Record<string, unknown> & {
            mux?: object;
            mediaInfo?: object;
          };
          s.demo = false;
          s.mux = { ...s.mux, enabled: true, installed: true };
          s.mediaInfo = { ...s.mediaInfo, enabled: true, installed: true };
        });
      for (const item of file
        ? [
            ...dialogCases,
            { width: 1600, height: 900, theme: "dark" as const },
            { width: 820, height: 1180, theme: "light" as const },
          ]
        : dialogCases) {
        const label = `${id} at ${name(item)}`;
        await page.setViewportSize(item);
        const shown = await openDialog(page, id, { theme: item.theme });
        // A log dialog polls its log, so the network never goes quiet.
        if (id === "muxLog" || id === "placementLog")
          await expect(shown.locator("pre.v2-code")).toBeVisible();
        else await settle(page);
        await axeDialog(page, label);
        if (!file) continue;
        await shown
          .getByRole("button", { name: "Rename file", exact: true })
          .click();
        await expect(
          shown.getByRole("textbox", { name: "Filename" }),
        ).toBeFocused();
        await axeDialog(page, `${label} renaming`);
        await shown
          .getByRole("button", { name: "Cancel renaming", exact: true })
          .click();
        await shown
          .getByRole("button", { name: /^Choose source for / })
          .first()
          .click();
        await expect(
          page.getByRole("menu", { name: /^Choose source for / }),
        ).toBeVisible();
        await axeDialog(page, `${label} with the evidence menu`);
        await page.keyboard.press("Escape");
        const tab = shown
          .getByRole("tablist", { name: "File details" })
          .getByRole("tab", { name: "MediaInfo", exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await settle(page);
        await axeDialog(page, `${label} on MediaInfo`);
        // The tab is kept for the session: the next case starts on Overview.
        await shown
          .getByRole("tablist", { name: "File details" })
          .getByRole("tab", { name: "Overview", exact: true })
          .click();
      }
    });
});

// D32 (Phase 6.6): every interface palette in both modes, color-contrast
// included (axe runs all WCAG A/AA rules). The palette is a server setting;
// the settings answer is rewritten here, so nothing is saved. One viewport,
// four representative pages: dashboard, movies, a tool and a dialog.
test.describe("every palette has no axe violations", () => {
  for (const palette of interfaceThemes)
    test(palette, async ({ page }) => {
      test.setTimeout(240_000);
      await withMuxJobs(page);
      await page.route(/\/api\/settings$/, async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        const response = await route.fetch();
        const settings = await response.json();
        settings.interfaceTheme = palette;
        await route.fulfill({ response, json: settings });
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      for (const theme of ["dark", "light"] as const) {
        const label = `${palette} ${theme}`;
        await page.goto("about:blank");
        await openRoute(page, "", { theme });
        await expect(page.locator("html")).toHaveAttribute(
          "data-palette",
          palette,
        );
        await axeView(page, `${label} dashboard`);
        await axeFrame(page, `${label} dashboard`);
        await page.goto("about:blank");
        await openRoute(page, "#/movies", { theme });
        await expect(page.locator(".v2-row--placeholder")).toHaveCount(0);
        await axeView(page, `${label} movies`);
        await page.goto("about:blank");
        await openRoute(page, "#/tools/mux", { theme });
        await expect(
          page.locator("table.v2-table--fixed > tbody > tr").first(),
        ).toBeVisible({ timeout: 15_000 });
        await settle(page);
        await axeView(page, `${label} mux`);
        await openDialog(page, "savePreset", { theme });
        await settle(page);
        await axeDialog(page, `${label} dialog`);
      }
    });
});

// D32 (Phase 6.6): the narrow places in all four languages, at 1440 and
// 375: filter row, filter drawer, tool row, dashboard. The page never
// scrolls sideways, and text a box clips (overflow hidden, one line or a
// line clamp) ends in an ellipsis or has a title or label to read it whole.
test("clipped text keeps an ellipsis or a title in four languages", async ({
  page,
}) => {
  test.setTimeout(400_000);
  await withMuxJobs(page);
  const clipped = () =>
    page.evaluate(() => {
      const found: string[] = [];
      const scope = document.querySelectorAll(
        "main, header, nav, dialog[open], [role=dialog]",
      );
      const seen = new Set<Element>();
      for (const root of scope)
        for (const el of [root, ...root.querySelectorAll("*")]) {
          if (seen.has(el) || !(el instanceof HTMLElement)) continue;
          seen.add(el);
          const style = getComputedStyle(el);
          if (!el.checkVisibility({ visibilityProperty: true })) continue;
          if (!/hidden|clip/.test(style.overflowX + style.overflowY)) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4) continue;
          if (!el.textContent?.trim()) continue;
          const sideways = el.scrollWidth > el.clientWidth + 1;
          const clamped =
            style.webkitLineClamp !== "none" &&
            el.scrollHeight > el.clientHeight + 1;
          if (!sideways && !clamped) continue;
          const reads =
            style.textOverflow === "ellipsis" ||
            // The phone card's chip line fades out under a mask on purpose.
            style.maskImage !== "none" ||
            clamped ||
            el.closest("[title], [aria-label], [data-tooltip]");
          if (reads) continue;
          found.push(
            `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} "${el.textContent.trim().slice(0, 30)}" ${el.scrollWidth}>${el.clientWidth}`,
          );
        }
      return found;
    });
  for (const language of LANGUAGES) {
    await inLanguage(page, language);
    for (const size of [
      { width: 1440, height: 900 },
      { width: 375, height: 812 },
    ]) {
      await page.setViewportSize(size);
      const check = async (what: string) => {
        const at = `${what} in ${language} at ${size.width}`;
        expect(
          await pageOverflowX(page),
          `${at} scrolls sideways`,
        ).toBeLessThanOrEqual(0);
        expect(
          await clipped(),
          `${at}: clipped text without ellipsis or title`,
        ).toEqual([]);
      };
      for (const hash of [
        "#/",
        "#/movies",
        "#/series",
        "#/tools/mux",
        "#/tools/placement",
        "#/tools/files",
      ]) {
        await page.goto("about:blank");
        await openRoute(page, hash, { theme: "dark" });
        await check(hash);
        if (hash !== "#/movies" && hash !== "#/series") continue;
        await page
          .getByRole("button", { name: L(page, "Filters"), exact: true })
          .click();
        await expect(page.getByRole("dialog").first()).toBeVisible();
        await settle(page);
        await check(`${hash} filter drawer`);
      }
    }
  }
});
