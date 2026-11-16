// Render time of large library pages (Phase 6.2, project `perf`, local only,
// not in e2e or CI): /api/files answers 1000 files cloned from the demo's
// own (route mock), and the page counts from the answer's arrival until the
// table holds them and two frames painted. Long tasks after the answer are
// summed. Runs: movies and expanded series at 1440 (table) and 375 (phone
// cards). Prints one line per case; it fails only when drawing takes longer
// than LIMIT_MS (a regression guard well above the measured times).
//   flock …/e2e.lock npx -y pnpm@11.25.0 --dir web exec playwright test --project=perf --reporter=line
import { expect, test, type Page } from "@playwright/test";
import { openRoute } from "./app";

const ROWS = 1000;
const LIMIT_MS = 4000;

type Mark = { answer: number; drawn: number; longTasks: number[] };

// Answers the library's page request with ROWS files built from the demo's
// answer: movies get their own media IDs, episodes 25 series of 40 (four
// seasons of ten).
async function mockLibrary(page: Page) {
  await page.route(/\/api\/files\?/, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("limit")) return route.continue();
    const real = await (await route.fetch()).json();
    const series = url.searchParams.get("service") === "sonarr";
    const template = real.files.filter(
      (f: { episodes: unknown[] }) => !series || f.episodes.length === 1,
    );
    const files = Array.from({ length: ROWS }, (_, i) => {
      const f = structuredClone(template[i % template.length]);
      f.id = 100000 + i;
      if (series) {
        const show = Math.floor(i / 40);
        f.mediaId = 5000 + show;
        f.series = `Load Series ${String(show).padStart(3, "0")}`;
        f.season = 1 + Math.floor((i % 40) / 10);
        f.episodes = [{ ...f.episodes[0], id: f.id, number: (i % 10) + 1 }];
        f.title = `E${String((i % 10) + 1).padStart(2, "0")} · Episode ${i}`;
      } else {
        f.mediaId = 100000 + i;
        f.title = `${f.title} ${i}`;
      }
      return f;
    });
    await route.fulfill({
      json: {
        ...real,
        files,
        total: ROWS,
        displayTotal: ROWS,
        page: 1,
        pageSize: ROWS,
      },
    });
  });
}

// Before the app starts: the time the page answer arrives (fetch wrapper),
// long tasks, and the time the table first holds `rows` body rows plus two
// animation frames.
async function instrument(page: Page, rows: number) {
  await page.addInitScript((rows) => {
    const w = window as unknown as {
      __mark: Partial<Mark> & { longTasks: number[] };
    };
    w.__mark = { longTasks: [] };
    const fetch0 = window.fetch;
    window.fetch = async (...args) => {
      const response = await fetch0(...args);
      const url = String(args[0] instanceof Request ? args[0].url : args[0]);
      if (/\/api\/files\?/.test(url) && !/[?&]limit=/.test(url))
        w.__mark.answer = performance.now();
      return response;
    };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        if (w.__mark.answer && e.startTime >= w.__mark.answer)
          w.__mark.longTasks.push(e.duration);
    }).observe({ type: "longtask", buffered: true });
    const check = () => {
      if (w.__mark.drawn || !w.__mark.answer) return;
      if (document.querySelectorAll("table.v2-table tbody tr").length < rows)
        return;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => (w.__mark.drawn = performance.now())),
      );
    };
    new MutationObserver(check).observe(document, {
      childList: true,
      subtree: true,
    });
  }, rows);
}

for (const view of ["movies", "series"] as const)
  for (const width of [1440, 375])
    test(`${ROWS} ${view} at ${width}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: width > 400 ? 900 : 812 });
      await mockLibrary(page);
      await instrument(page, ROWS);
      // SCOPEARR_PERF_PROFILE=<dir> writes a CPU profile per case there.
      const profileDir = process.env.SCOPEARR_PERF_PROFILE;
      const cdp = profileDir ? await page.context().newCDPSession(page) : null;
      if (cdp) {
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
        await cdp.send("Profiler.start");
      }
      await openRoute(page, "#/" + view);
      await expect
        .poll(
          () =>
            page.evaluate(
              () => (window as unknown as { __mark: Mark }).__mark.drawn,
            ),
          {
            timeout: 60_000,
          },
        )
        .toBeGreaterThan(0);
      if (cdp) {
        const { profile } = await cdp.send("Profiler.stop");
        const { writeFileSync } = await import("node:fs");
        writeFileSync(
          `${profileDir}/${view}-${width}.cpuprofile`,
          JSON.stringify(profile),
        );
      }
      const mark = await page.evaluate(
        () => (window as unknown as { __mark: Mark }).__mark,
      );
      const rows = await page.locator("table.v2-table tbody tr").count();
      const drawn = Math.round(mark.drawn - mark.answer);
      const long = mark.longTasks.map(Math.round);
      console.log(
        `perf ${view} ${width}: ${rows} rows drawn ${drawn} ms after the answer; ` +
          `long tasks ${long.length} (sum ${long.reduce((a, b) => a + b, 0)} ms, max ${Math.max(0, ...long)} ms)`,
      );
      expect(drawn).toBeLessThan(LIMIT_MS);
    });
