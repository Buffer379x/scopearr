// The settings areas (Phase 5c, Task 11; docs/STYLEGUIDE.md, Part 1, 10.8,
// 10.11, 11.4 and 13): Services, Display, Widgets, Custom tags, Tag rules
// and System (Info, Log) on their band. Their geometry from the first
// paint on and while statuses, drafts and saves change, their lines and
// widths in four languages, and the band's Save, the dock, the band
// choice, the log drawer and the overlays as a user drives them. Measured
// after network idle and loaded fonts; tolerance 0.5 px. Every save is
// answered here (the demo database is shared, so nothing is stored).
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ALL,
  axeDialog,
  answerDiscard,
  currentHash,
  dialog,
  expectSection,
  expectSteady,
  filterDrawer,
  firstPaintChanges,
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
  sectionLink,
  serviceCard,
  settingsBand,
  settle,
  sizeLabel as label,
  sizeOf,
  withDelayedSettingsData,
  withStatus,
  withTwoMovieInstances,
  WIDTHS,
  type Edge,
  type SettingsSection,
} from "./app";

type Size = { width: number; height: number };
const desktop = sizeOf(1440),
  phone = sizeOf(375);

// A fresh load (not a hash change of the same document) at `size`.
async function start(page: Page, size: Size, hash: string) {
  await page.setViewportSize(size);
  await page.goto("about:blank");
  await openRoute(page, hash);
}

// Answers every PUT of the settings (nothing is stored) and returns the
// bodies sent; `hold` keeps each answer back until it resolves. GETs reach
// the demo.
function answerSaves(page: Page, hold?: () => Promise<void>) {
  const sent: Record<string, unknown>[] = [];
  void page.route(/\/api\/settings$/, async (route) => {
    const request = route.request();
    if (request.method() !== "PUT") return route.fallback();
    sent.push(request.postDataJSON());
    if (hold) await hold();
    return route.fulfill({ json: {} });
  });
  return sent;
}

// Two animation frames: a late effect of the last render has run.
const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
const bandSave = (page: Page) =>
  settingsBand(page).getByRole("button", { name: "Save settings" });
const dock = (page: Page) => page.locator(".v2-save-dock");
const topbarTheme = (page: Page) =>
  page
    .locator(".v2-topbar")
    .getByRole("button", { name: /^(Light|Dark) theme$/ });
const radio = (page: Page, group: string, name: string) =>
  page
    .getByRole("radiogroup", { name: group, exact: true })
    .getByRole("radio", { name, exact: true });
const displayTab = (page: Page, name: string) =>
  page
    .getByRole("tablist", { name: "Display sections" })
    .getByRole("tab", { name: new RegExp("^" + name) });
const serviceTab = (page: Page, name: string) =>
  page
    .getByRole("tablist", { name: "Configured services" })
    .getByRole("tab", { name: new RegExp("^" + name) });
const logCard = (page: Page) =>
  page.locator("section.v2-table-card:has(#event-log-title)");
const logFilters = (page: Page) =>
  logCard(page).getByRole("button", { name: "Filters", exact: true });
const applyButton = (drawer: Locator) =>
  drawer.getByRole("button", { name: /^Apply/ });

// A part counts only while no [hidden] ancestor hides it: the other areas
// stay in the page, hidden.
const V = ":not([hidden], [hidden] *)";
const BAND: Record<string, Edge[]> = {
  ".v2-band": ALL,
  ".v2-page-head": ALL,
  // The title's width follows the area's own header actions.
  "main h1": ["x", "y", "height"],
};
// Save settings without a segment beside it, and after one (Display): on
// phones the two stand in other places, so the frames of the area left
// before do not count for the next.
const SAVE: Record<string, Edge[]> = {
  ".v2-page-actions:not(:has(> .v2-seg)) > .v2-btn": ALL,
};
const SAVE_AFTER_SEGMENT: Record<string, Edge[]> = {
  ".v2-page-actions:has(> .v2-seg) > .v2-btn": ALL,
};
const SEGMENT: Record<string, Edge[]> = { ".v2-page-actions > .v2-seg": ALL };
const set = (id: string) =>
  `section.v2-set-card[aria-labelledby="${id}-title"]${V}`;
const tableCard = (id: string) => `section.v2-table-card:has(#${id}-title)`;

type SettingsView = {
  name: string;
  section: SettingsSection;
  tab?: "Info" | "Log";
  parts: Record<string, Edge[]>;
};
const VIEWS: SettingsView[] = [
  {
    name: "Services",
    section: "Services",
    parts: {
      ...BAND,
      ...SAVE,
      [`.v2-svc-sync${V}`]: ALL,
      [`.v2-svc-bar${V}`]: ALL,
      [`.v2-svc${V}`]: PLACE,
      [`.v2-svc-head${V}`]: ALL,
      // The status first: its section keeps its size until the answer.
      [`.v2-svc > section:nth-of-type(1)${V}`]: ALL,
      [`.v2-svc > section:nth-of-type(2) > .v2-svc-sec-head${V}`]: ALL,
    },
  },
  {
    name: "Display",
    section: "Display",
    parts: {
      ...BAND,
      ...SAVE_AFTER_SEGMENT,
      ...SEGMENT,
      [set("interface-theme")]: ALL,
      [`${set("interface-theme")} .v2-set-head`]: ALL,
      [`${set("interface-theme")} .v2-mode`]: ALL,
      [set("interface-language")]: PLACE,
    },
  },
  {
    name: "Widgets",
    section: "Widgets",
    parts: {
      ...BAND,
      ...SAVE,
      [set("dashboard-widgets")]: ALL,
      [set("storage-colors")]: ALL,
      [set("storage")]: PLACE,
      [`${set("storage")} > .v2-set-head`]: ALL,
    },
  },
  {
    name: "Custom tags",
    section: "Custom tags",
    parts: {
      ...BAND,
      ...SAVE,
      [tableCard("custom-tags")]: PLACE,
      [`${tableCard("custom-tags")} .v2-tc-head`]: ALL,
      [`${tableCard("custom-tags")} .v2-filter-bar`]: ALL,
    },
  },
  {
    name: "Tag rules",
    section: "Tag rules",
    parts: {
      ...BAND,
      ...SAVE,
      [tableCard("recognition-rules")]: PLACE,
      [`${tableCard("recognition-rules")} .v2-tc-head`]: ALL,
      [`${tableCard("recognition-rules")} thead`]: ALL,
      [`${tableCard("recognition-rules")} tbody > tr:first-child`]: PLACE,
      // The columns: the Attribute head and the last one.
      [`${tableCard("recognition-rules")} thead th:nth-child(5)`]: PLACE,
      [`${tableCard("recognition-rules")} thead th:last-child`]: PLACE,
    },
  },
  {
    name: "System → Info",
    section: "System",
    tab: "Info",
    parts: {
      ...BAND,
      ...SEGMENT,
      [set("system-version")]: ALL,
      [set("system-backup")]: ALL,
      [set("system-password")]: ALL,
      [set("system-services")]: PLACE,
    },
  },
  {
    name: "System → Log",
    section: "System",
    tab: "Log",
    parts: {
      ...BAND,
      ...SEGMENT,
      [tableCard("event-log")]: PLACE,
      [`${tableCard("event-log")} .v2-tc-head`]: ALL,
      [`${tableCard("event-log")} .v2-filter-bar`]: ALL,
      [`${tableCard("event-log")} .v2-chips-row`]: ALL,
      [`${tableCard("event-log")} thead`]: ALL,
    },
  },
];

async function systemTab(page: Page, tab: "Info" | "Log") {
  const choice = page
    .getByRole("tablist", { name: "System sections" })
    .getByRole("tab", { name: tab, exact: true });
  await choice.click();
  await expect(choice).toHaveAttribute("aria-selected", "true");
}

// --- Geometry and jumps -------------------------------------------------

// Every area from its first paint, with its data held 300 ms, one area
// after the other through the sidebar (Tag rules is a lazy chunk): the
// band, the first cards, the card heads, the segments, the status section
// and the table heads stand where they settle from the frame they appear
// in. Services also at 1180 and 1120, where the service head's switch
// would wrap first (T4 re-review).
test("settings pages do not move after their first paint", async ({ page }) => {
  test.setTimeout(600_000);
  await recordFirstPaint(page);
  await recordBoxes(page, [
    ...new Set(VIEWS.flatMap((view) => Object.keys(view.parts))),
  ]);
  await withDelayedSettingsData(page, 300);
  for (const width of [...WIDTHS, 1180, 1120]) {
    const size = sizeOf(width);
    await test.step(label(size), async () => {
      await start(page, size, "#/settings/connections");
      const frame = await firstPaintChanges(page);
      expect(frame.first, `the frame at ${label(size)}`).toEqual([]);
      expect(frame.frames, `the frame at ${label(size)}`).toEqual([]);
      await expectSteady(
        page,
        VIEWS[0].parts,
        `Services (load) at ${label(size)}`,
      );
      if (width === 1180 || width === 1120) return;
      let from = "Services";
      for (const view of VIEWS.slice(1)) {
        if (view.tab !== "Log") {
          const link = await sectionLink(page, view.section);
          await recordedBoxes(page);
          await link.click();
          await expectSection(page, view.section);
          await page.mouse.move(0, 0);
        } else await recordedBoxes(page);
        if (view.tab) await systemTab(page, view.tab);
        await settle(page);
        await expectSteady(
          page,
          view.parts,
          `${view.name} (from ${from}) at ${label(size)}`,
        );
        from = view.name;
      }
    });
  }
});

// T4 re-review: from 1120 to 1280 a service head may wrap its switch;
// a wrapped switch has no divider before it (no orphan line at the start
// of its row), on every service tab in four languages.
test("a wrapped service switch has no divider", async ({ page }) => {
  test.setTimeout(300_000);
  await withTwoMovieInstances(page);
  for (const language of LANGUAGES)
    for (const width of [1280, 1180, 1120]) {
      await inLanguage(page, language);
      await start(page, sizeOf(width), "#/settings/connections");
      const tabs = page
        .getByRole("tablist", { name: "Configured services" })
        .getByRole("tab");
      for (let i = 0; i < (await tabs.count()); i++) {
        await tabs.nth(i).click();
        await expect(tabs.nth(i)).toHaveAttribute("aria-selected", "true");
        await settle(page);
        const head = await serviceCard(page)
          .locator(".v2-svc-head")
          .evaluate((element) => {
            const tile = element.querySelector(".v2-tile")!;
            const toggle = element.querySelector(".v2-svc-switch")!;
            const style = getComputedStyle(toggle);
            return {
              name: element.querySelector("h2")!.textContent,
              wrapped:
                toggle.getBoundingClientRect().top >=
                tile.getBoundingClientRect().bottom,
              divider:
                style.boxShadow !== "none" || parseFloat(style.paddingLeft) > 0,
            };
          });
        expect(
          head.wrapped && head.divider,
          `${head.name} in ${language} at ${width}: a wrapped switch with its divider`,
        ).toBe(false);
      }
    }
});

// The boxes of every visible card head, segment item and band action:
// what a status, a draft or a save may not move.
const STEADY =
  ".v2-page-actions > *, .v2-seg-item, .v2-svc-head, .v2-svc-sec-head, .v2-set-head, .v2-tc-head, .v2-view thead, .v2-svc-switch";
function steadyBoxes(page: Page) {
  return page.evaluate((query) => {
    return [...document.querySelectorAll(query)]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        const name =
          element.className +
          (element.textContent ? " " + element.textContent.slice(0, 24) : "");
        return { name, box: [x, y + scrollY, width, height] };
      });
  }, STEADY);
}
async function expectUnmoved(
  page: Page,
  before: Awaited<ReturnType<typeof steadyBoxes>>,
  where: string,
) {
  const now = await steadyBoxes(page);
  expect(now.length, `${where}: the number of heads`).toBe(before.length);
  const moved: string[] = [];
  now.forEach(({ box }, i) =>
    box.forEach((value, edge) => {
      if (Math.abs(value - before[i].box[edge]) > 0.5)
        moved.push(
          `${before[i].name}: ${["x", "y", "width", "height"][edge]} ${before[i].box[edge]} → ${value}`,
        );
    }),
  );
  expect(moved, where).toEqual([]);
}

// What changes while a page is open moves no card head, segment or band
// action, at 1440 and 375: a tool turning busy and idle, a library's sync
// running and failing, its tag sync waiting and asking for a review, a
// draft made and undone, a save in progress, the band, a palette and a
// column moved up, and an applied log filter.
test("status, saving and drafts never move a settings card", async ({
  page,
}) => {
  test.setTimeout(300_000);
  let busy = "download";
  await page.route(/\/api\/mux\/tool$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), busy },
    });
  });
  type Phase = "idle" | "running" | "error" | "pending" | "review";
  let phase: Phase = "idle";
  await withTwoMovieInstances(page);
  await withStatus(page, (status) => {
    const s = status as Record<string, unknown> & {
      sync?: Record<string, unknown>;
    };
    s.webhooksEnabled = true;
    const sync = (s.sync ??= {});
    sync.radarr = {
      running: phase === "running",
      queued: false,
      lastAttempt: "2026-11-06T09:00:00Z",
      lastSuccess: "2026-11-06T09:00:00Z",
      error: phase === "error" ? "Radarr is not reachable" : "",
      count: 12,
    };
    s.tagSync = {
      ...(s.tagSync as object),
      radarr: {
        running: false,
        pending: phase === "pending",
        error: "",
        changed: phase === "review" ? 3 : 0,
        approvalRequired: phase === "review",
      },
    };
  });
  let release = () => {};
  const sent = answerSaves(
    page,
    () => new Promise<void>((resolve) => (release = resolve)),
  );
  const statusAnswer = () =>
    page.waitForResponse((r) => /\/api\/status$/.test(r.url()));
  for (const size of [desktop, phone]) {
    await test.step(label(size), async () => {
      const at = label(size);
      await test.step("a tool busy and idle", async () => {
        busy = "download";
        await start(page, size, "#/settings/connections/mux");
        await expect(serviceCard(page)).toContainText(/Working/);
        const before = await steadyBoxes(page);
        busy = "";
        await page.waitForResponse((r) => /\/api\/mux\/tool$/.test(r.url()));
        await expect(serviceCard(page)).not.toContainText(/Working/);
        await expectUnmoved(page, before, `MKVToolNix idle at ${at}`);
      });
      for (const where of [
        "#/settings/connections/radarr",
        "#/settings/system/info",
      ])
        await test.step(`a sync on ${where}`, async () => {
          phase = "idle";
          await start(page, size, where);
          const before = await steadyBoxes(page);
          for (const next of [
            "running",
            "error",
            "pending",
            "review",
          ] as const) {
            phase = next;
            await statusAnswer();
            await statusAnswer();
            if (next === "error")
              await expect(
                page
                  .getByRole("main")
                  .getByText(/Radarr is not reachable/)
                  .first(),
              ).toBeVisible();
            if (next === "review")
              await expect(
                page
                  .getByRole("button", { name: "Review tag removals" })
                  .first(),
              ).toBeEnabled();
            await expectUnmoved(
              page,
              before,
              `${where}, sync ${next} at ${at}`,
            );
          }
        });
      await test.step("drafts and saves on Display", async () => {
        phase = "idle";
        await start(page, size, "#/settings/appearance/general");
        // On phones the band's row scrolls; a press on Save scrolls it to
        // the button first, as a user does.
        await bandSave(page).scrollIntoViewIfNeeded();
        const before = await steadyBoxes(page);
        const entries = page.getByLabel("Entries per page", { exact: true });
        const old = await entries.inputValue();
        await entries.fill("37");
        await expect(bandSave(page)).toBeEnabled();
        await expectUnmoved(page, before, `a draft at ${at}`);
        await entries.fill(old);
        await expect(bandSave(page)).toBeDisabled();
        await expectUnmoved(page, before, `the draft undone at ${at}`);
        await radio(page, "Accent band", "Strong").click();
        await expectUnmoved(page, before, `a band draft at ${at}`);
        await page
          .getByRole("radiogroup", { name: "Interface theme", exact: true })
          .getByRole("radio")
          .nth(3)
          .click();
        await expectUnmoved(page, before, `a palette draft at ${at}`);
        const count = sent.length;
        await bandSave(page).click();
        await expect.poll(() => sent.length).toBe(count + 1);
        await expect(bandSave(page).locator(".v2-spin")).toBeVisible();
        await expectUnmoved(page, before, `saving at ${at}`);
        release();
        await expect(bandSave(page).locator(".v2-spin")).toHaveCount(0);
        await expectUnmoved(page, before, `saved at ${at}`);
      });
      await test.step("a column moved up", async () => {
        await start(page, size, "#/settings/appearance/lists");
        const before = await steadyBoxes(page);
        await page
          .locator("#display-panel-lists")
          .getByRole("button", { name: /· Move up$/ })
          .and(page.locator(":enabled"))
          .first()
          .click();
        await expect(bandSave(page)).toBeEnabled();
        await expectUnmoved(page, before, `a column moved up at ${at}`);
      });
      await test.step("a log filter applied", async () => {
        await start(page, size, "#/settings/system/log");
        const before = await steadyBoxes(page);
        await logFilters(page).click();
        const drawer = filterDrawer(page);
        await drawer.getByRole("checkbox", { name: /^Info/ }).check();
        await applyButton(drawer).click();
        await expect(drawer).toHaveCount(0);
        await expect(logCard(page).locator(".v2-chip")).toHaveCount(1);
        await settle(page);
        await expectUnmoved(page, before, `a log filter at ${at}`);
      });
    });
  }
});

// T9 re-review: the sync progress a screen reader hears in System → Info
// is the same node across the status reloads, so it is not announced
// again on each one.
test("the sync status of System → Info stays one live region", async ({
  page,
}) => {
  await withTwoMovieInstances(page);
  await withStatus(page, (status) => {
    const s = status as Record<string, unknown> & {
      sync?: Record<string, unknown>;
    };
    s.webhooksEnabled = true;
    s.sync = {
      ...s.sync,
      radarr: {
        running: true,
        queued: false,
        lastAttempt: null,
        lastSuccess: null,
        error: "",
        count: 0,
      },
    };
  });
  await start(page, desktop, "#/settings/system/info");
  const region = page
    .locator(set("system-service-radarr"))
    .locator('[role="status"]');
  await expect(region).toHaveText("Sync in progress …");
  await region.evaluate((element) => {
    (window as unknown as { __live?: Element }).__live = element;
  });
  for (let i = 0; i < 2; i++)
    await page.waitForResponse((r) => /\/api\/status$/.test(r.url()));
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(
    await region.evaluate(
      (element) =>
        (window as unknown as { __live?: Element }).__live === element,
    ),
    "the live region is the same node after two reloads",
  ).toBe(true);
});

// The lines of a text: the distinct tops of its line boxes.
function lines(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const tops: number[] = [];
    for (const box of range.getClientRects())
      if (box.width > 0 && !tops.some((top) => Math.abs(top - box.top) < 4))
        tops.push(box.top);
    return tops.length;
  });
}

// The design's lines at 1440 and 375 in four languages (the Phase 4
// wraps): the band's summary is one line in every area, the Mode column
// of Tag rules one line per row (1440; a phone's rule card wraps its
// cells) and Change password stands in its card's body on one line.
test("settings texts keep the lines of the design", async ({ page }) => {
  test.setTimeout(300_000);
  const hashes = [
    "#/settings/connections",
    "#/settings/appearance/general",
    "#/settings/widgets",
    "#/settings/custom",
    "#/settings/recognition",
    "#/settings/system/info",
  ];
  for (const language of LANGUAGES)
    await test.step(language, async () => {
      await inLanguage(page, language);
      for (const size of [desktop, phone]) {
        const at = `${language} at ${label(size)}`;
        for (const hash of hashes) {
          await start(page, size, hash);
          expect(
            await lines(settingsBand(page).locator(".v2-page-sum")),
            `${hash}: the band's summary in ${at}`,
          ).toBe(1);
        }
        // The Mode column of the rules table; a phone's rule card wraps
        // each cell in its own place (Task 8, settings-rules-375).
        if (size === desktop) {
          await start(page, size, "#/settings/recognition");
          const rules = page.locator(tableCard("recognition-rules"));
          await expect(
            rules.locator("tbody tr:not(.v2-row--placeholder)").first(),
          ).toBeVisible();
          const mode = await rules
            .locator("thead th")
            .evaluateAll((heads) =>
              heads.findIndex((head) =>
                /^(Mode|Modus|Modo|Modalità)$/.test(head.textContent!.trim()),
              ),
            );
          expect(mode, `the Mode column in ${at}`).toBeGreaterThan(-1);
          const cells = rules.locator(`tbody tr > td:nth-child(${mode + 1})`);
          const many = await cells.evaluateAll((list) =>
            list.flatMap((cell) => {
              const range = document.createRange();
              range.selectNodeContents(cell);
              const tops: number[] = [];
              for (const box of range.getClientRects())
                if (
                  box.width > 0 &&
                  !tops.some((top) => Math.abs(top - box.top) < 4)
                )
                  tops.push(box.top);
              return tops.length > 1 ? [cell.textContent] : [];
            }),
          );
          expect(many, `Mode cells on more than one line in ${at}`).toEqual([]);
        }
        await start(page, size, "#/settings/system/info");
        const card = page.locator(set("system-password"));
        const button = card.locator("button.v2-btn");
        await expect(button).toHaveCount(1);
        expect(
          await button.evaluate((element) => !element.closest(".v2-set-head")),
          `Change password in the card's body in ${at}`,
        ).toBe(true);
        expect(await lines(button), `Change password in ${at}`).toBe(1);
      }
    });
});

// The cells of the rules table whose value is cut (Attribute, Match type,
// Result and Mode: their text wider than the cell), as "column: text".
function cutRules(page: Page): Promise<string[]> {
  return page.locator(tableCard("recognition-rules")).evaluate((card) =>
    [...card.querySelectorAll("tbody tr:not(.v2-row--placeholder)")].flatMap(
      (row) =>
        [5, 6, 8, 9].flatMap((column) => {
          const cell = row.children[column - 1] as HTMLElement;
          return cell.scrollWidth > cell.clientWidth
            ? [`${column}: ${cell.textContent}`]
            : [];
        }),
    ),
  );
}

// In a phone's card rows the plain head Actions shares the middle of the
// head row with the rules' sort heads, as the log's Message head does
// (fix wave, T9).
test("the rules' heads share their middle at 375", async ({ page }) => {
  await start(page, phone, "#/settings/recognition");
  const rules = page.locator(tableCard("recognition-rules"));
  await expect(
    rules.locator("tbody tr:not(.v2-row--placeholder)").first(),
  ).toBeVisible();
  const middles = await rules.evaluate((card) =>
    [...card.querySelectorAll("thead th")].map((th) => {
      const range = document.createRange();
      range.selectNodeContents(th.querySelector("button") ?? th);
      const box = range.getBoundingClientRect();
      return (box.top + box.bottom) / 2;
    }),
  );
  expect(middles).toHaveLength(10);
  for (const [at, middle] of middles.entries())
    expect(
      Math.abs(middle - middles[0]),
      `head ${at + 1} middle at 375`,
    ).toBeLessThanOrEqual(0.5);
});

// No area scrolls the page sideways at 1440 and 375 in four languages; at
// 1440 the tables of Tag rules and the log fit their cards. With the
// sidebar expanded from 1120 to 1279 (T9-M6), the Version card's release
// line (up to date, and a new version) stays inside its card.
test("settings fit at 1440 and 375 in four languages", async ({ page }) => {
  test.setTimeout(400_000);
  let update = false;
  await withStatus(page, (status) => {
    const s = status as Record<string, unknown> & { version?: string };
    if (!("releaseCheck" in s)) return;
    s.releaseCheck = {
      latest: update ? "2.10.10" : s.version,
      checkedAt: "2026-11-06T09:00:00Z",
      successAt: "2026-11-06T09:00:00Z",
      error: "",
      updateAvailable: update,
    };
  });
  const hashes = [
    "#/settings/connections",
    "#/settings/appearance/general",
    "#/settings/appearance/lists",
    "#/settings/appearance/colors",
    "#/settings/widgets",
    "#/settings/custom",
    "#/settings/recognition",
    "#/settings/system/info",
    "#/settings/system/log",
  ];
  for (const language of LANGUAGES)
    await test.step(language, async () => {
      await inLanguage(page, language);
      for (const size of [desktop, phone])
        for (const hash of hashes) {
          await start(page, size, hash);
          const at = `${hash} in ${language} at ${label(size)}`;
          expect(
            await pageOverflowX(page),
            `${at} scrolls sideways`,
          ).toBeLessThanOrEqual(0);
          if (size !== desktop || !/recognition|log$/.test(hash)) continue;
          await expect(
            page
              .locator("main .v2-table tbody tr:not(.v2-row--placeholder)")
              .first(),
          ).toBeVisible();
          const scroll = await page
            .locator(
              `main ${V} > .v2-table-card .v2-table-scroll, main .v2-table-card${V} .v2-table-scroll`,
            )
            .first()
            .evaluate((region) => region.scrollWidth - region.clientWidth);
          expect(
            scroll,
            `${at}: the table scrolls in its card`,
          ).toBeLessThanOrEqual(0);
          if (hash.endsWith("recognition"))
            expect(await cutRules(page), `${at}: cut rule cells`).toEqual([]);
        }
      // Fix round 1 (I1): in a card narrower than the rules, the table
      // scrolls in its card; no value is cut and Name keeps its minimum.
      for (const width of [1119, 820, 740]) {
        await start(page, sizeOf(width), "#/settings/recognition");
        const at = `Tag rules in ${language} at ${width}`;
        await expect(
          page
            .locator(tableCard("recognition-rules"))
            .locator("tbody tr:not(.v2-row--placeholder)")
            .first(),
        ).toBeVisible();
        expect(
          await pageOverflowX(page),
          `${at} scrolls sideways`,
        ).toBeLessThanOrEqual(0);
        expect(await cutRules(page), `${at}: cut rule cells`).toEqual([]);
        const name = await page
          .locator(tableCard("recognition-rules"))
          .locator("thead th:nth-child(4)")
          .evaluate((head) => head.getBoundingClientRect().width);
        // --kv-label-max (170) + --sp-2 (8).
        expect(name, `${at}: the Name column`).toBeGreaterThanOrEqual(
          178 - 0.5,
        );
      }
    });
  await preferSidebar(page, "expanded");
  for (const language of LANGUAGES)
    for (const width of [1279, 1200, 1120])
      for (const next of [false, true]) {
        update = next;
        await inLanguage(page, language);
        await start(page, sizeOf(width), "#/settings/system/info");
        const at = `${language} at ${width}${next ? ", a new version" : ""}`;
        const card = page.locator(set("system-version"));
        const line = card.locator('p[role="status"]');
        await expect(line).toContainText(next ? /2\.10\.10/ : /\S/);
        const fits = await line.evaluate((element) => {
          const card = element.closest("section")!.getBoundingClientRect();
          const tag = element.firstElementChild!;
          const box = tag.getBoundingClientRect();
          return {
            inside:
              box.left >= card.left - 0.5 && box.right <= card.right + 0.5,
            cut:
              (tag as HTMLElement).scrollWidth -
              (tag as HTMLElement).clientWidth,
          };
        });
        expect(fits.inside, `${at}: the release line in its card`).toBe(true);
        expect(fits.cut, `${at}: the release line is cut`).toBeLessThanOrEqual(
          0,
        );
        expect(
          await pageOverflowX(page),
          `${at} scrolls sideways`,
        ).toBeLessThanOrEqual(0);
      }
});

// --- Behavior -----------------------------------------------------------

// The keys of the settings the app loads, without the two obsolete mux
// fields settingsPayload never sends back, and tagApprovals: what a save
// may send (rollback, E29).
async function savedKeys(page: Page): Promise<string[]> {
  const settings = await page.evaluate(async () => {
    const response = await fetch("/api/settings");
    return response.json();
  });
  return [
    ...Object.keys(settings).filter(
      (key) => key !== "muxColumnOrder" && key !== "muxVisibleColumns",
    ),
    "tagApprovals",
  ].sort();
}

test("a section change asks once and the band save submits the draft", async ({
  page,
}) => {
  const sent = answerSaves(page);
  const puts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && /\/api\/settings$/.test(request.url()))
      puts.push(request.url());
  });
  await start(page, desktop, "#/settings/appearance/general");
  const entries = page.getByLabel("Entries per page", { exact: true });
  await entries.fill("37");
  await bandSave(page).click();
  await expect(
    page.locator(".v2-toast").filter({ hasText: "Settings saved." }),
  ).toBeVisible();
  expect(puts, "one PUT of the settings").toHaveLength(1);
  expect(sent[0]).toMatchObject({ pageSize: 37 });
  expect(Object.keys(sent[0]).sort()).toEqual(await savedKeys(page));
  await expect(bandSave(page)).toBeDisabled();

  await entries.fill("38");
  let asked = 0;
  page.on("dialog", () => asked++);
  const widgets = await sectionLink(page, "Widgets");
  await widgets.click();
  await answerDiscard(page, "Cancel");
  await expectSection(page, "Display");
  await expect(entries).toHaveValue("38");
  await (await sectionLink(page, "Widgets")).click();
  await answerDiscard(page, "Discard changes");
  await expectSection(page, "Widgets");
  await expect(
    page.getByRole("dialog", { name: "Really cancel?" }),
  ).toHaveCount(0);
  expect(asked, "no browser dialog").toBe(0);
  expect(puts).toHaveLength(1);
});

// Every save sends the 1.7.0 fields only: Services, Display and Widgets
// (the keys of the loaded settings, nothing new).
test("saving settings sends only the 1.7.0 fields", async ({ page }) => {
  const sent = answerSaves(page);
  await start(page, desktop, "#/settings/connections");
  const keys = await savedKeys(page);
  await page.getByLabel("Sync timezone", { exact: true }).fill("Europe/Berlin");
  await bandSave(page).click();
  await expect.poll(() => sent.length).toBe(1);
  await start(page, desktop, "#/settings/appearance/general");
  await page.getByLabel("Entries per page", { exact: true }).fill("41");
  await radio(page, "Accent band", "Strong").click();
  await bandSave(page).click();
  await expect.poll(() => sent.length).toBe(2);
  await start(page, desktop, "#/settings/widgets");
  await page
    .locator(set("dashboard-widgets"))
    .getByRole("checkbox")
    .first()
    .click();
  await bandSave(page).click();
  await expect.poll(() => sent.length).toBe(3);
  for (const body of sent) expect(Object.keys(body).sort()).toEqual(keys);
});

// R-D with T3-M3: on a long page the dock shows only with a draft while
// the band's Save is out of view, which includes standing under the glass
// topbar; a press saves once and the dock goes. Without a draft there is
// none.
test("save settings stays reachable on long pages", async ({ page }) => {
  const sent = answerSaves(page);
  for (const [size, hash, change] of [
    [desktop, "#/settings/connections", "timezone"],
    [desktop, "#/settings/appearance/colors", "warning"],
    [phone, "#/settings/connections", "timezone"],
  ] as const) {
    await test.step(`${hash} at ${label(size)}`, async () => {
      await start(page, size, hash);
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      await expect(dock(page)).toHaveCount(0);
      await page.evaluate(() => window.scrollTo(0, 0));
      if (change === "timezone")
        await page
          .getByLabel("Sync timezone", { exact: true })
          .fill("Europe/Berlin");
      else {
        const input = page.getByLabel("Metadata warning color", {
          exact: true,
        });
        await input.evaluate((element) => {
          const field = element as HTMLInputElement;
          field.value = "#123456";
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }
      await expect(bandSave(page)).toBeEnabled();
      await expect(dock(page)).toHaveCount(0);
      // The band's Save under the topbar: in the viewport, but covered.
      // The band's Save under the stuck topbar (its sticky top and
      // height): in the viewport, but covered; 4 px lower it shows.
      const save = await bandSave(page).boundingBox();
      const covered = await page
        .locator(".v2-topbar")
        .evaluate(
          (bar) =>
            parseFloat(getComputedStyle(bar).top) +
            (bar as HTMLElement).offsetHeight,
        );
      const under = save!.y + save!.height - covered;
      await page.evaluate((by) => window.scrollTo(0, by), under - 4);
      await expect(dock(page), "Save just below the topbar").toHaveCount(0);
      await page.evaluate((by) => window.scrollTo(0, by), under + 2);
      expect(
        (await bandSave(page).boundingBox())!.y,
        "Save is still in the viewport",
      ).toBeGreaterThanOrEqual(0);
      await expect(
        dock(page),
        "the dock with Save under the topbar",
      ).toHaveCount(1);
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      const docked = dock(page).getByRole("button", { name: "Save settings" });
      await expect(docked).toBeVisible();
      const count = sent.length;
      await docked.click();
      await expect.poll(() => sent.length).toBe(count + 1);
      await expect(dock(page)).toHaveCount(0);
    });
  }
});

// P1: Strong, Muted and Use default are drafts; <html> takes the band only
// after a successful Save, without a reload, for both modes; a saved mode
// draft turns the topbar's button too, which itself applies at once.
test("the band choice reaches the frame after Save without a reload", async ({
  page,
}) => {
  answerSaves(page);
  await start(page, desktop, "#/settings/appearance/general");
  const html = page.locator("html");
  let loads = 0;
  page.on("load", () => loads++);
  const save = async () => {
    await bandSave(page).click();
    await expect(bandSave(page)).toBeDisabled();
  };
  await expect(html).toHaveAttribute("data-band", "muted");
  await radio(page, "Accent band", "Strong").click();
  await expect(radio(page, "Accent band", "Strong")).toBeChecked();
  // A draft: after its render and two frames <html> still has the band.
  await frames(page);
  expect(await html.getAttribute("data-band")).toBe("muted");
  await save();
  await expect(html).toHaveAttribute("data-band", "strong");
  const useDefault = page.getByRole("button", {
    name: "Use default",
    exact: true,
  });
  await expect(useDefault).toBeEnabled();
  await useDefault.click();
  await expect(useDefault).toBeDisabled();
  await frames(page);
  expect(await html.getAttribute("data-band")).toBe("strong");
  await save();
  await expect(html).toHaveAttribute("data-band", "muted");
  await radio(page, "Mode", "Light theme").click();
  await expect(radio(page, "Mode", "Light theme")).toBeChecked();
  await frames(page);
  expect(await html.getAttribute("data-theme")).toBe("dark");
  await expect(topbarTheme(page)).toHaveAccessibleName("Light theme");
  await save();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(html).toHaveAttribute("data-band", "strong");
  await expect(topbarTheme(page)).toHaveAccessibleName("Dark theme");
  await radio(page, "Accent band", "Muted").click();
  await save();
  await expect(html).toHaveAttribute("data-band", "muted");
  await topbarTheme(page).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(html).toHaveAttribute("data-band", "muted");
  await expect(radio(page, "Mode", "Dark theme")).toBeChecked();
  await expect(bandSave(page)).toBeDisabled();
  expect(loads, "no reload").toBe(0);
});

// P1: a topbar toggle during a draft clears only the mode draft: the band
// draft and the other changes stay, nothing asks, and Save applies them.
test("a topbar toggle during a display draft keeps the other changes", async ({
  page,
}) => {
  const sent = answerSaves(page);
  await start(page, desktop, "#/settings/appearance/general");
  const html = page.locator("html");
  const entries = page.getByLabel("Entries per page", { exact: true });
  await entries.fill("43");
  await radio(page, "Accent band", "Muted").click();
  await radio(page, "Mode", "Light theme").click();
  await expect(radio(page, "Mode", "Light theme")).toBeChecked();
  await frames(page);
  expect(await html.getAttribute("data-theme")).toBe("dark");
  await topbarTheme(page).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(html).toHaveAttribute("data-band", "strong");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(radio(page, "Mode", "Light theme")).toBeChecked();
  await expect(radio(page, "Accent band", "Muted")).toBeChecked();
  await expect(entries).toHaveValue("43");
  await expect(displayTab(page, "General")).toHaveAccessibleName(
    "General Unsaved changes",
  );
  await expect(bandSave(page)).toBeEnabled();
  await bandSave(page).click();
  await expect(bandSave(page)).toBeDisabled();
  expect(sent.at(-1)).toMatchObject({ pageSize: 43 });
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(html).toHaveAttribute("data-band", "muted");
});

// R-E: the count on Apply is the total of the drawer's limit=1 request;
// Escape changes nothing; Apply replaces the hash without a history entry.
test("the log drawer applies only on Apply", async ({ page }) => {
  const totals: { query: string; total: number }[] = [];
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.pathname === "/api/events" && url.searchParams.get("limit") === "1")
      totals.push({ query: url.search, total: (await response.json()).total });
  });
  await start(page, desktop, "#/settings/system/log");
  const length = await historyLength(page);
  await logFilters(page).click();
  let drawer = filterDrawer(page);
  await expect(drawer).toBeVisible();
  const level = () => drawer.getByRole("checkbox", { name: /^Info/ });
  await level().check();
  await expect
    .poll(() => totals.find((t) => t.query.includes("level=info")))
    .toBeTruthy();
  const total = totals.find((t) => t.query.includes("level=info"))!.total;
  await expect(applyButton(drawer)).toHaveText(
    `Apply (${total} ${total === 1 ? "match" : "matches"})`,
  );
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(logFilters(page)).toBeFocused();
  expect(await currentHash(page)).toBe("#/settings/system/log");
  await expect(logCard(page).locator(".v2-chip")).toHaveCount(0);
  await logFilters(page).click();
  drawer = filterDrawer(page);
  await expect(level()).not.toBeChecked();
  await level().check();
  await expect(applyButton(drawer)).toHaveText(
    `Apply (${total} ${total === 1 ? "match" : "matches"})`,
  );
  await applyButton(drawer).click();
  await expect(drawer).toHaveCount(0);
  await expect
    .poll(() => currentHash(page))
    .toBe("#/settings/system/log?level=info");
  await expect(logCard(page).locator(".v2-chip")).toHaveText(["Info"]);
  expect(await historyLength(page), "no history entry").toBe(length);
});

// 5a M12 on the settings: a press on a toast closes no open help (the
// toast came first).
test("a press on a toast leaves the settings help open", async ({ page }) => {
  for (const [hash, name] of [
    ["#/settings/custom", "Custom tags help"],
    ["#/settings/recognition", "Tag rules help"],
  ]) {
    await test.step(hash, async () => {
      await start(page, desktop, hash);
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent("scopearr-notification", {
            detail: { message: "Settings saved", kind: "success" },
          }),
        ),
      );
      const toast = page
        .locator(".v2-toast")
        .filter({ hasText: "Settings saved" });
      await expect(toast).toBeVisible();
      await page.getByRole("button", { name, exact: true }).click();
      const help = page.getByRole("dialog", { name, exact: true });
      await expect(help).toBeVisible();
      await toast.locator(".v2-toast-text").click();
      await expect(help).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(help).toHaveCount(0);
    });
  }
});

// The 5a toast decision on the settings (P6): with "Settings saved." up,
// the band's actions, the service tabs and the service head's controls
// take a press where they are (elementFromPoint), at 1440 and 375.
test("toasts leave the band actions usable", async ({ page }) => {
  answerSaves(page);
  const reachable = (locator: Locator) =>
    locator.evaluateAll((list) =>
      list
        .filter((element) => element.getClientRects().length > 0)
        .flatMap((element) => {
          const box = element.getBoundingClientRect();
          const x = box.left + box.width / 2,
            y = box.top + box.height / 2;
          // A part of the band's row scrolled out of the page (phones).
          if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) return [];
          const hit = document.elementFromPoint(x, y);
          return hit && (hit === element || element.contains(hit))
            ? []
            : [
                `${element.textContent || element.className} under ${hit?.className}`,
              ];
        }),
    );
  for (const size of [desktop, phone])
    for (const [hash, change] of [
      ["#/settings/appearance/general", "pageSize"],
      ["#/settings/connections", "timezone"],
    ] as const)
      await test.step(`${hash} at ${label(size)}`, async () => {
        await start(page, size, hash);
        if (change === "pageSize")
          await page.getByLabel("Entries per page", { exact: true }).fill("44");
        else
          await page
            .getByLabel("Sync timezone", { exact: true })
            .fill("Europe/Berlin");
        await bandSave(page).click();
        const toast = page
          .locator(".v2-toast")
          .filter({ hasText: "Settings saved." });
        await expect(toast).toBeVisible();
        await toast.evaluate((element) =>
          Promise.all(element.getAnimations().map((a) => a.finished)),
        );
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const controls = page.locator(
          ".v2-page-actions > .v2-btn, .v2-page-actions .v2-seg-item, .v2-svc-bar .v2-seg-item, .v2-svc-bar > .v2-btn, .v2-svc-head :is(button, .v2-svc-switch)",
        );
        expect(await controls.count()).toBeGreaterThan(1);
        expect(await reachable(controls), `${hash} at ${label(size)}`).toEqual(
          [],
        );
      });
});

// E28: the log drawer is a dialog on the dialog stack, so ⌘K / Ctrl+K wait
// until it has closed.
test("quick search is closed while the log drawer is open", async ({
  page,
}) => {
  await start(page, desktop, "#/settings/system/log");
  await logFilters(page).click();
  const drawer = filterDrawer(page);
  await expect(drawer).toBeVisible();
  for (const keys of ["Control+k", "Meta+k"]) {
    await page.keyboard.press(keys);
    await expect(quickSearch(page)).toHaveCount(0);
    await expect(drawer).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(logFilters(page)).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(quickSearch(page)).toBeVisible();
  await page.keyboard.press("Escape");
});

// Phase 5d, Task 11 (ruling Q3): the settings dialogs open under the
// settings page but set their own layout. With the rules of the settings
// shell taken out of the page's sheets every box in the open dialog stays
// where it was; axe finds nothing. Task 13 deleted the 1.7.0 shell rules
// (.settings-page, -content, -section, -layout, .connection and the form
// and tab panel rules under them) and gave the shell v2 names, whose rules
// this drops now.
const SHELL_RULES = /\.v2-set-(page|content|layout)\b/;
async function dialogBoxes(page: Page) {
  return page.locator("dialog.v2-modal[open]").evaluate((box) =>
    [box, ...box.querySelectorAll("*")].map((el) => {
      const r = el.getBoundingClientRect();
      return [el.tagName, r.x, r.y, r.width, r.height].join(" ");
    }),
  );
}
async function dropShellRules(page: Page): Promise<number> {
  return page.evaluate((source) => {
    const shell = new RegExp(source);
    let dropped = 0;
    const walk = (list: CSSStyleSheet | CSSGroupingRule) => {
      for (let i = list.cssRules.length - 1; i >= 0; i--) {
        const rule = list.cssRules[i];
        if (rule instanceof CSSStyleRule && shell.test(rule.selectorText)) {
          list.deleteRule(i);
          dropped++;
        } else if ("cssRules" in rule) walk(rule as CSSGroupingRule);
      }
    };
    for (const sheet of document.styleSheets) walk(sheet);
    return dropped;
  }, SHELL_RULES.source);
}
for (const { name, hash, open } of [
  {
    name: "Add service",
    hash: "#/settings/connections",
    open: (page: Page) =>
      page
        .locator(".v2-svc-bar")
        .getByRole("button", { name: "Add service", exact: true })
        .click(),
  },
  {
    name: "Change password",
    hash: "#/settings/system/info",
    open: (page: Page) =>
      page
        .getByRole("main")
        .getByRole("button", { name: "Change password", exact: true })
        .click(),
  },
  {
    name: "Edit recognition rule",
    hash: "#/settings/recognition",
    open: (page: Page) =>
      page
        .getByRole("button", { name: /^Edit rule: / })
        .first()
        .click(),
  },
  {
    name: "Log entry",
    hash: "#/settings/system/log",
    open: (page: Page) => page.locator(".v2-set-msg").first().click(),
  },
])
  test(`${name} keeps its layout without the settings shell rules`, async ({
    page,
  }) => {
    // Outside the demo, so Add service is not locked.
    await withStatus(page, (status) => {
      status.demo = false;
    });
    for (const size of [desktop, phone]) {
      await start(page, size, hash);
      await open(page);
      const box = dialog(page, name);
      await expect(box).toBeVisible();
      await settle(page);
      await axeDialog(page, `${name} at ${size.width}`);
      const before = await dialogBoxes(page);
      expect(await dropShellRules(page)).toBeGreaterThan(0);
      expect(await dialogBoxes(page), `${name} at ${size.width}`).toEqual(
        before,
      );
    }
  });
