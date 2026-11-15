// The dialogs of Phase 5d (docs/STYLEGUIDE.md, Part 1, 10.9 and 13; Task
// 14): every v2 modal of DIALOGS opened like a user (DIALOG_OPENERS), its
// geometry from the first paint on with its data 300 ms late, its fit in
// four languages, focus and keyboard, and the overlays inside it.
// Tolerance 0.5 px; nothing here keeps a change in the demo database.
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  dialog,
  DIALOG_OPENERS,
  expectSame,
  inLanguage,
  LANGUAGES,
  openDialog,
  openDialogFrom,
  openRoute,
  quickSearch,
  settle,
  sizeLabel as label,
  sizeOf,
  TOLERANCE,
  WIDTHS,
  withSeasonMode,
  withStatus,
  type DialogId,
} from "./app";
import { placementItems, withPlacement } from "./tool-fixtures";

const IDS = Object.keys(DIALOG_OPENERS) as DialogId[];
type Box = [number, number, number, number];
type Read = { fixed: boolean; boxes: Record<string, Box> };

// Records, from the first script of every load on and while armed, the
// boxes of the newest open v2 modal (one that was not open when the
// recording was armed) in every animation frame, before its paint: the
// dialog, its head, title and Close, the tabs row, the foot and the foot's
// buttons counted from the right (a button that does not apply is not
// rendered but stands on the left, so nothing right of it moves).
async function recordDialogs(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __dialogBefore: Element[];
      __dialogFrames: unknown[] | null;
      __dialogRead: () => unknown;
    };
    w.__dialogBefore = [];
    w.__dialogFrames = null;
    w.__dialogRead = () => {
      const open = [
        ...document.querySelectorAll<HTMLDialogElement>(
          "dialog.v2-modal[open]",
        ),
      ].filter((d) => !w.__dialogBefore.includes(d));
      const d = open[open.length - 1];
      if (!d) return null;
      const boxes: Record<string, number[]> = {};
      const add = (key: string, el: Element | null) => {
        if (!el || !el.getClientRects().length) return;
        const { x, y, width, height } = el.getBoundingClientRect();
        boxes[key] = [x, y, width, height];
      };
      add("dialog", d);
      add("head", d.querySelector(":scope > .v2-modal-head"));
      add("title", d.querySelector(":scope > .v2-modal-head > h2"));
      add(
        "close",
        d.querySelector(
          ":scope > .v2-modal-head > .v2-modal-tools > button:last-child",
        ),
      );
      add("tabs", d.querySelector(".v2-tabs"));
      add("foot", d.querySelector(":scope > .v2-modal-foot"));
      [...d.querySelectorAll(":scope > .v2-modal-foot button")]
        .filter((b) => b.getClientRects().length)
        .reverse()
        .forEach((b, i) => add(`foot button ${i + 1} from the right`, b));
      return { fixed: d.dataset.height === "fixed", boxes };
    };
    const frame = () => {
      if (w.__dialogFrames) {
        const read = w.__dialogRead();
        if (read) w.__dialogFrames.push(read);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
const arm = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as {
      __dialogBefore: Element[];
      __dialogFrames: unknown[] | null;
    };
    w.__dialogBefore = [...document.querySelectorAll("dialog.v2-modal[open]")];
    w.__dialogFrames = [];
  });
const recorded = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as {
      __dialogFrames: unknown[] | null;
      __dialogRead: () => unknown;
    };
    const frames = w.__dialogFrames ?? [];
    w.__dialogFrames = [];
    return { frames, now: w.__dialogRead() };
  }) as Promise<{ frames: Read[]; now: Read | null }>;

// Every recorded frame against the settled dialog: each part keeps its box
// from its first frame on (a fixed dialog also its height; an auto one
// grows downward only, so its top, left and width hold), and no part
// leaves after it appeared.
function moves({ frames, now }: { frames: Read[]; now: Read | null }) {
  if (!now) return ["the dialog is not open"];
  const out: string[] = [];
  frames.forEach((frame, index) => {
    for (const [key, box] of Object.entries(frame.boxes)) {
      const settled = now.boxes[key];
      if (!settled) {
        out.push(`frame ${index}: ${key} leaves`);
        continue;
      }
      const edges = key === "dialog" && !now.fixed ? [0, 1, 2] : [0, 1, 2, 3];
      for (const i of edges)
        if (Math.abs(box[i] - settled[i]) > TOLERANCE)
          out.push(
            `frame ${index}: ${key} ${"xywh"[i]} ${box[i]} → ${settled[i]}`,
          );
    }
  });
  return out;
}

// The dialog has settled: requests and fonts are done. A log dialog polls
// its log while it is open, so the network never goes quiet there: it has
// settled once its terminal shows the log and a second has passed.
const POLLING: DialogId[] = ["muxLog", "placementLog"];
async function settled(page: Page, id: DialogId, shown: Locator) {
  if (!POLLING.includes(id)) return settle(page);
  await expect(shown.locator("pre.v2-code")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
}

// A fresh page records from its first script on.
test.beforeEach(async ({ page }) => {
  await recordDialogs(page);
});

test.describe("dialogs do not move after they open", () => {
  for (const id of IDS)
    test(id, async ({ page }) => {
      test.setTimeout(240_000);
      for (const width of WIDTHS) {
        const size = sizeOf(width);
        await page.setViewportSize(size);
        const shown = await openDialog(page, id, {
          delay: 300,
          armed: () => arm(page),
        });
        await settled(page, id, shown);
        const record = await recorded(page);
        expect(
          record.frames.length,
          `${id} at ${label(size)}: frames`,
        ).toBeGreaterThan(0);
        expect(moves(record), `${id} at ${label(size)}`).toEqual([]);
      }
    });
});

// Restarts the recording of the dialog that is recorded (a step inside it).
const restart = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __dialogFrames: unknown[] }).__dialogFrames = [];
  });
// The frames since the last start and the settled dialog against `base`.
async function expectFrame(
  page: Page,
  base: Read,
  where: string,
  { quiet = true }: { quiet?: boolean } = {},
) {
  // While a request is held on purpose the network is not quiet: a few
  // frames are recorded instead.
  if (quiet) await settle(page);
  else await page.waitForTimeout(500);
  const { frames, now } = await recorded(page);
  expect(
    moves({ frames: now ? [...frames, now] : frames, now: base }),
    where,
  ).toEqual([]);
}

// The file dialog outside the demo: renaming, muxing and MediaInfo reads
// are on, so every control of its head and foot is there.
async function withFileTools(page: Page) {
  await withStatus(page, (status) => {
    const s = status as Record<string, unknown> & {
      mux?: object;
      mediaInfo?: object;
    };
    s.demo = false;
    s.mux = { ...s.mux, enabled: true, installed: true };
    s.mediaInfo = { ...s.mediaInfo, enabled: true, installed: true };
  });
}

test("the file dialog keeps its frame through renaming, menus and tabs", async ({
  page,
}) => {
  await withFileTools(page);
  // A MediaInfo read waits for `release`, then fails (the demo reads none).
  let release = () => {};
  await page.route(/\/api\/files\/mediainfo$/, async (route) => {
    await new Promise<void>((done) => (release = done));
    await route.fulfill({ status: 500, json: { error: "MediaInfo failed" } });
  });
  for (const width of [1440, 375]) {
    const size = sizeOf(width);
    const at = label(size);
    await page.setViewportSize(size);
    const shown = await openDialog(page, "file", { armed: () => arm(page) });
    await settle(page);
    const base = (await recorded(page)).now!;
    await restart(page);
    const rename = shown.getByRole("button", {
      name: "Rename file",
      exact: true,
    });
    await rename.click();
    await expect(
      shown.getByRole("textbox", { name: "Filename" }),
    ).toBeFocused();
    await expectFrame(page, base, `renaming on at ${at}`);
    await shown
      .getByRole("button", { name: "Cancel renaming", exact: true })
      .click();
    await expect(shown.getByRole("textbox", { name: "Filename" })).toHaveCount(
      0,
    );
    await expectFrame(page, base, `renaming off at ${at}`);
    const source = shown
      .getByRole("button", { name: /^Choose source for / })
      .first();
    await source.click();
    const menu = page.getByRole("menu", { name: /^Choose source for / });
    await expect(menu).toBeVisible();
    await expectFrame(page, base, `evidence menu open at ${at}`);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(shown).toBeVisible();
    await expectFrame(page, base, `evidence menu closed at ${at}`);
    const tab = (name: string) =>
      shown
        .getByRole("tablist", { name: "File details" })
        .getByRole("tab", { name, exact: true });
    await tab("MediaInfo").click();
    await expect(tab("MediaInfo")).toHaveAttribute("aria-selected", "true");
    await expectFrame(page, base, `MediaInfo tab at ${at}`);
    await tab("Overview").click();
    await expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
    await expectFrame(page, base, `Overview tab at ${at}`);
    const read = shown.getByRole("button", {
      name: /^(Read with MediaInfo|Read again)$/,
    });
    await read.click();
    await expect(shown.locator(".v2-modal-foot .v2-spin")).toBeVisible();
    await expectFrame(page, base, `MediaInfo read running at ${at}`, {
      quiet: false,
    });
    release();
    await expect(shown.locator(".v2-modal-foot .v2-spin")).toHaveCount(0);
    await expectFrame(page, base, `MediaInfo read failed at ${at}`);
  }
});

// T9 (Task 9): the scan dialogs keep their foot in the viewport on a low
// desktop window and on a phone with its keyboard up (focus in the last
// field); the details of an item with many files keep their table head at
// the top of the scrolling body.
test("scan dialogs keep their footer in view", async ({ page }) => {
  for (const id of ["placementScan", "fileCheckScan"] as const)
    for (const size of [
      { width: 1440, height: 780 },
      { width: 1280, height: 720 },
      { width: 375, height: 667 },
    ]) {
      const at = `${id} at ${label(size)}`;
      await page.setViewportSize(size);
      const shown = await openDialog(page, id);
      await settle(page);
      if (size.width <= 739) {
        const last = shown
          .locator(".v2-modal-body")
          .locator(
            "input:not([type=checkbox]):not([type=radio]), select, textarea",
          )
          .last();
        await last.focus();
        await settle(page);
      }
      const foot = await shown.locator(".v2-modal-foot").boundingBox();
      expect(foot, at).not.toBeNull();
      expect(foot!.y, `${at}: the foot's top`).toBeGreaterThanOrEqual(0);
      expect(
        foot!.y + foot!.height,
        `${at}: the foot's bottom in the viewport`,
      ).toBeLessThanOrEqual(size.height + TOLERANCE);
      for (const button of await shown.locator(".v2-modal-foot button").all())
        await expect(button, at).toBeInViewport();
    }
});

test("the placement details keep their table head at the body's top", async ({
  page,
}) => {
  const files = Array.from({ length: 30 }, (_, i) => ({
    disk: "disk1",
    rel: `Season 1/Breaking Bad S01E${String(i + 1).padStart(2, "0")}.mkv`,
    size: 2 * 1024 ** 3,
    mtime: 1_760_000_000,
  }));
  await withPlacement(page, {
    items: () =>
      placementItems().map((item) =>
        item.title === "Breaking Bad" ? { ...item, files } : item,
      ),
  });
  await page.setViewportSize(sizeOf(1440));
  // Opened here, not by openDialog, whose own placement fixture (without
  // the files) would answer first.
  await page.goto("about:blank");
  await openRoute(page, "#/tools/placement");
  await page
    .getByRole("button", { name: "Details for Breaking Bad", exact: true })
    .click();
  const shown = dialog(page, "Breaking Bad");
  await expect(shown.locator("tbody tr")).toHaveCount(30);
  const body = shown.locator(".v2-modal-body");
  await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await settle(page);
  // Sticky holds at the top of the body's content box (inside its padding).
  const top = await body.evaluate(
    (el) =>
      el.getBoundingClientRect().top +
      parseFloat(getComputedStyle(el).paddingTop),
  );
  const head = (await shown.locator("thead th").first().boundingBox())!.y;
  expectSame(head, top, "the table head at the body's top");
});

// Each dialog fits its viewport in each language: nothing in it scrolls
// sideways, no foot button cuts its text, and from 740 on the foot is one
// line (File & metadata's two fixed lines below).
test.describe("dialogs fit at 1440 and 375 in four languages", () => {
  for (const id of IDS)
    test(id, async ({ page }) => {
      test.setTimeout(240_000);
      for (const language of LANGUAGES) {
        await inLanguage(page, language);
        for (const width of [1440, 375]) {
          const size = sizeOf(width);
          const at = `${id} in ${language} at ${label(size)}`;
          await page.setViewportSize(size);
          const shown = await openDialog(page, id);
          await settled(page, id, shown);
          const fit = await shown.evaluate((d, phone) => {
            const out: string[] = [];
            const over = (el: Element | null, what: string) => {
              if (el && el.scrollWidth > el.clientWidth + 0.5)
                out.push(`${what}: ${el.scrollWidth} > ${el.clientWidth}`);
            };
            over(d, "dialog");
            over(d.querySelector(":scope > .v2-modal-head"), "head");
            over(d.querySelector(":scope > .v2-modal-body"), "body");
            const foot = d.querySelector(":scope > .v2-modal-foot");
            if (foot) {
              const scrolls = getComputedStyle(foot).overflowX === "auto";
              if (!scrolls) over(foot, "foot");
              const box = foot.getBoundingClientRect();
              for (const button of foot.querySelectorAll("button")) {
                if (!button.getClientRects().length) continue;
                const name = `foot button ${button.textContent?.trim()}`;
                over(button, name);
                // A foot that scrolls sideways shows the rest on a swipe;
                // any other keeps every button inside it.
                const own = button.getBoundingClientRect();
                if (
                  !button.closest(".v2-file-actions") &&
                  (own.left < box.left - 0.5 || own.right > box.right + 0.5)
                )
                  out.push(
                    `${name} outside the foot: ${own.left}–${own.right}`,
                  );
              }
              const rows: { top: number; bottom: number }[] = [];
              for (const child of foot.querySelectorAll(
                ":scope > *, :scope > * > button",
              )) {
                if (!child.getClientRects().length) continue;
                const { top, bottom } = child.getBoundingClientRect();
                if (bottom - top < 1) continue;
                if (!rows.some((r) => top < r.bottom && bottom > r.top)) {
                  rows.push({ top, bottom });
                }
              }
              const file = d.dataset.size === "file";
              if (phone && file) {
                const tracks = getComputedStyle(foot)
                  .gridTemplateRows.split(" ")
                  .filter(Boolean).length;
                if (tracks !== 2)
                  out.push(`foot: ${tracks} fixed lines, expected 2`);
              } else if (!phone && rows.length !== 1)
                out.push(`foot: ${rows.length} lines, expected 1`);
            }
            return out;
          }, width <= 739);
          expect(fit, at).toEqual([]);
        }
      }
    });
});

// Opened by keyboard, focus starts on the body's [autofocus] field, else
// on the title; Tab and Shift+Tab stay in the dialog through a whole round;
// Escape closes it, and focus returns to the trigger (R-D), else to the
// title of the dialog below, else to the page's h1, never to the body.
test.describe("every dialog traps focus, closes with Escape and returns focus", () => {
  for (const id of IDS)
    test(id, async ({ page }) => {
      test.setTimeout(120_000);
      for (const width of [1440, 375]) {
        const size = sizeOf(width);
        const at = `${id} at ${label(size)}`;
        await page.setViewportSize(size);
        const { dialog: shown, handle: opener } = await openDialogFrom(
          page,
          id,
          {
            keyboard: true,
          },
        );
        await settled(page, id, shown);
        expect(
          await shown.evaluate((d) => {
            const want =
              d.querySelector(":scope > .v2-modal-body [autofocus]") ??
              d.querySelector(":scope > .v2-modal-head > h2");
            return document.activeElement === want;
          }),
          `${at}: focus on [autofocus] or the title`,
        ).toBe(true);
        const stops = await shown.evaluate(
          (d) =>
            [
              ...d.querySelectorAll<HTMLElement>(
                "a[href], button, input, select, textarea, [tabindex]",
              ),
            ].filter(
              (el) =>
                el.tabIndex >= 0 &&
                !(el as HTMLButtonElement).disabled &&
                el.getClientRects().length > 0,
            ).length,
        );
        for (const key of ["Tab", "Shift+Tab"])
          for (let i = 0; i <= stops; i++) {
            await page.keyboard.press(key);
            expect(
              await shown.evaluate((d) => d.contains(document.activeElement)),
              `${at}: ${key} ${i + 1} of ${stops + 1} stays in the dialog`,
            ).toBe(true);
          }
        await page.keyboard.press("Escape");
        await expect(shown, `${at}: Escape closes it`).toHaveCount(0);
        const focus = await page.evaluate((node) => {
          const el = node as Element;
          const active = document.activeElement;
          const shown =
            !!el && el.isConnected && el.getClientRects().length > 0;
          const open = [
            ...document.querySelectorAll("dialog.v2-modal[open]"),
          ].pop();
          const fallback = open
            ? open.querySelector("h2")
            : document.querySelector("main h1");
          return {
            trigger: shown,
            onTrigger: active === el,
            onFallback: active === fallback,
            placed:
              !!active &&
              active !== document.body &&
              (active as HTMLElement).getClientRects().length > 0,
            what: active?.tagName ?? "none",
          };
        }, opener);
        if (focus.trigger)
          expect(focus.onTrigger, `${at}: focus back on the trigger`).toBe(
            true,
          );
        else
          // The trigger left (a phone's log opens in place of the dialog
          // that held it): returnFocus or the fallback takes focus, never
          // the body.
          expect(
            focus.onFallback || focus.placed,
            `${at}: focus on returnFocus or the fallback, not ${focus.what}`,
          ).toBe(true);
      }
    });
});

// E5: a confirmation over a dialog (the discard question of Mux options
// with a draft) closes only itself on Escape; focus stays in the dialog.
test("a confirmation over a dialog closes only itself", async ({ page }) => {
  await page.setViewportSize(sizeOf(1440));
  const options = await openDialog(page, "muxOptions");
  await settle(page);
  await options.getByRole("textbox").first().fill("E2E draft");
  await options
    .locator(".v2-modal-head")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  const ask = dialog(page, "Really cancel?");
  await expect(ask).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ask).toHaveCount(0);
  await expect(options).toBeVisible();
  expect(
    await options.evaluate((d) => d.contains(document.activeElement)),
    "focus in Mux options",
  ).toBe(true);
});

// T5 M-1: a confirmation over Custom tags, whose Apply is locked while it
// asks: after Escape focus is back in Custom tags (its Apply, or its
// title), not on the page's inert h1 or the body.
test("a confirmation over a dialog with a locked opener keeps focus in the dialog", async ({
  page,
}) => {
  await page.setViewportSize(sizeOf(1440));
  const tags = await openDialog(page, "customTags");
  await settle(page);
  await tags.getByRole("checkbox", { name: /^Favourite/ }).click();
  await tags.getByRole("button", { name: "Apply", exact: true }).click();
  const ask = dialog(page, "Confirm deletion");
  await expect(ask).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ask).toHaveCount(0);
  await expect(tags).toBeVisible();
  expect(
    await tags.evaluate((d) => d.contains(document.activeElement)),
    "focus in Custom tags",
  ).toBe(true);
});

const toastPress = async (page: Page) => {
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("scopearr-notification", {
        detail: { message: "Filter view saved.", kind: "success" },
      }),
    ),
  );
  const toast = page.locator(".v2-toast-text").last();
  await expect(toast).toBeVisible();
  await toast.click();
};

// E14, D20: a press on a toast over a dialog closes neither the evidence
// menu in it nor the dialog.
test("a toast press keeps the evidence menu and the dialog open", async ({
  page,
}) => {
  await page.setViewportSize(sizeOf(1440));
  const shown = await openDialog(page, "file");
  await settle(page);
  await shown
    .getByRole("button", { name: /^Choose source for / })
    .first()
    .click();
  const menu = page.getByRole("menu", { name: /^Choose source for / });
  await expect(menu).toBeVisible();
  await toastPress(page);
  await expect(menu).toBeVisible();
  await expect(shown).toBeVisible();
});

// E5: ⌘K (Ctrl+K) opens nothing while a dialog is open, and quick search
// once it has closed.
test("quick search waits while a dialog is open", async ({ page }) => {
  await page.setViewportSize(sizeOf(1440));
  const shown = await openDialog(page, "file");
  await settle(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(quickSearch(page)).toHaveCount(0);
  await expect(shown).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(shown).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(quickSearch(page)).toBeVisible();
});

// E5: Escape closes a popover in a dialog (a HelpTip in the scan dialog)
// first, then the dialog.
test("escape closes a popover in a dialog first", async ({ page }) => {
  await page.setViewportSize(sizeOf(1440));
  const shown = await openDialog(page, "fileCheckScan");
  await settle(page);
  await shown
    .getByRole("button", {
      name: "Report any deviation from the target permissions",
      exact: true,
    })
    .click();
  const pop = shown.locator(".v2-pop");
  await expect(pop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(shown).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(shown).toHaveCount(0);
});

// Q2 (I2): a toast with a link (8 s) starts below a large dialog's head and
// leaves its buttons free: File & metadata after Mark for muxing at 1440
// and 1119, and a large tool dialog (the placement details).
async function expectHeadFree(page: Page, shown: Locator, where: string) {
  const toast = page.locator(".v2-toast").last();
  await expect(toast).toBeVisible();
  const head = (await shown.locator(".v2-modal-head").boundingBox())!;
  const own = (await toast.boundingBox())!;
  expect(own.y, `${where}: the toast starts below the head`).toBeGreaterThan(
    head.y + head.height,
  );
  for (const button of await shown
    .locator(".v2-modal-head")
    .getByRole("button")
    .all())
    expect(
      await button.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return !!hit && el.contains(hit);
      }),
      `${where}: ${await button.getAttribute("aria-label")} is free`,
    ).toBe(true);
}
test("toasts keep clear of a dialog's head", async ({ page }) => {
  await withFileTools(page);
  // The demo creates no mux job: the marking is answered here.
  await page.route(/\/api\/mux\/jobs$/, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          json: { id: 1, service: "radarr", fileId: 1, status: "draft" },
        })
      : route.fallback(),
  );
  for (const width of [1440, 1119]) {
    await page.setViewportSize(sizeOf(width));
    const shown = await openDialog(page, "file");
    await settle(page);
    await shown
      .getByRole("button", { name: "Mark for muxing", exact: true })
      .click();
    await expect(
      page.locator(".v2-toast").filter({ hasText: "Marked for muxing." }),
    ).toBeVisible();
    await expectHeadFree(page, shown, `File & metadata at ${width}`);
  }
  await page.setViewportSize(sizeOf(1440));
  const details = await openDialog(page, "placementDetails");
  await settle(page);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("scopearr-notification", {
        detail: {
          message: "Marked for muxing.",
          kind: "success",
          action: { label: "Open Muxing", hash: "#/tools/mux" },
        },
      }),
    ),
  );
  await expectHeadFree(page, details, "the placement details at 1440");
});

// T7 m5 (R-G, F2): paging crosses a page boundary of the list (the list
// behind follows to the next page, the count runs over all pages, the
// dialog keeps its frame) and stays inside a loaded season page.
test("paging crosses a page boundary and stays in a season page", async ({
  page,
}) => {
  await page.setViewportSize(sizeOf(1440));
  await page.goto("about:blank");
  await openRoute(page, "#/series");
  const rows = page.getByRole("button", { name: /^Filename and metadata: / });
  await expect(rows.first()).toBeVisible();
  await settle(page);
  const total = await rows.count();
  await arm(page);
  await rows.last().click();
  const shown = dialog(page, "File & metadata");
  await expect(shown).toBeVisible();
  await settle(page);
  const base = (await recorded(page)).now!;
  await restart(page);
  const count = shown.locator(".v2-modal-foot [aria-live=polite]");
  await expect(count).toHaveText(new RegExp(`^${total} of \\d+$`));
  const all = Number((await count.textContent())!.split(" of ")[1]);
  expect(all, "the list has a second page").toBeGreaterThan(total);
  await shown.getByRole("button", { name: "Next file" }).click();
  await expect(count).toHaveText(`${total + 1} of ${all}`);
  await expect(
    page.getByRole("navigation", { name: /^Page 2 \// }),
  ).toBeVisible();
  await expectFrame(page, base, "after Next file across the page boundary");
  await shown.getByRole("button", { name: "Previous file" }).click();
  await expect(count).toHaveText(`${total} of ${all}`);
  await expect(
    page.getByRole("navigation", { name: /^Page 1 \// }),
  ).toBeVisible();
  await expectFrame(page, base, "after Previous file back to page 1");
  await page.keyboard.press("Escape");
  await expect(shown).toHaveCount(0);
});
test("paging stays inside a loaded season page", async ({ page }) => {
  await withSeasonMode(page, "season");
  await page.setViewportSize(sizeOf(1440));
  await page.goto("about:blank");
  await openRoute(page, "#/series");
  const rows = page.getByRole("button", { name: /^Filename and metadata: / });
  await expect(rows.first()).toBeVisible();
  await settle(page);
  const total = await rows.count();
  await rows.last().click();
  const shown = dialog(page, "File & metadata");
  await expect(shown).toBeVisible();
  const count = shown.locator(".v2-modal-foot [aria-live=polite]");
  await expect(count).toHaveText(`${total} of ${total}`);
  await expect(shown.getByRole("button", { name: "Next file" })).toBeDisabled();
  await shown.getByRole("button", { name: "Previous file" }).click();
  await expect(count).toHaveText(`${total - 1} of ${total}`);
});
