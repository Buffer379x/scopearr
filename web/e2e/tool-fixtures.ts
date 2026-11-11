// Tool page fixtures (Phase 5b): the job and finding factories the frame's
// bell and the tool pages share, and the tool rows the demo does not have.
// The factories are function declarations, so app.ts, which imports them,
// can be loaded before or after this module.
import type { Page } from "@playwright/test";
import { withStatus } from "./app";

// A fixture answer `ms` late (Phase 5b, Task 10: the first paint with a
// slow server); 0 answers at once.
const late = (ms: number) =>
  ms > 0 ? new Promise((done) => setTimeout(done, ms)) : undefined;
// A fixture switch: a fixed value, or a function asked on every request.
type Switch = boolean | (() => boolean);
const on = (value: Switch) => (typeof value === "function" ? value() : value);

export type MuxJobFixture = ReturnType<typeof muxJob>;

// A mux job of the API (MuxJob) with passing checks; `extra` sets any
// other field, such as progress, backupName or check.
export function muxJob(
  id: number,
  status: string,
  title: string,
  file: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    service: "radarr",
    // No demo file has these ids, so the library marks none of its rows.
    fileId: 900_000 + id,
    mediaId: 900_000 + id,
    title,
    sourceName: file,
    status,
    revision: 1,
    spec: {
      outputName: title,
      deleteOriginal: false,
      tracks: {},
      chapters: true,
      attachments: true,
    },
    source: {
      container: "matroska",
      durationNs: 0,
      tracks: [],
      chapters: 0,
      attachments: 0,
      size: 0,
      modTime: "",
    },
    check: {
      workWritable: true,
      workFreeSpace: true,
      exists: true,
      readable: true,
      writable: true,
      freeSpace: true,
      sizeMatches: true,
      unchanged: true,
    },
    progress: status === "running" ? 40 : 0,
    message: "",
    log: "",
    backupName: "",
    createdAt: "",
    updatedAt: "",
    ...extra,
  };
}

export type FindingFixture = ReturnType<typeof finding>;

// A Files & permissions finding of the API (FileCheckItem); `extra` sets
// any other field, such as dir, kind, fix, mode or progress.
export function finding(
  id: number,
  jobStatus: string,
  title: string,
  rel: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    service: "radarr",
    instance: "radarr",
    mediaId: 900_000 + id,
    title,
    rel,
    dir: false,
    kind: "permissions",
    fix: "chmod",
    size: 0,
    mode: 420,
    uid: 99,
    gid: 100,
    mtime: 0,
    note: "",
    jobStatus,
    queuePos: null,
    progress: 0,
    message: "",
    updatedAt: "",
    finishedAt: null as string | null,
    ...extra,
  };
}

// The C+ mux jobs: one per status the page shows, sizes from 1 to 6 GiB;
// with `count` more ready jobs follow (Task 10: a selection of 12, and the
// sticky header needs at least 25 rows, ruling I13).
const GIB = 1024 ** 3;
export function muxJobs(count = 6): MuxJobFixture[] {
  const more = Array.from({ length: Math.max(0, count - 6) }, (_, i) =>
    muxJob(7 + i, "ready", "Film " + (7 + i), `Film ${7 + i} (2020).mkv`),
  );
  return [
    muxJob(1, "running", "Arrival", "Arrival (2016).mkv", { progress: 64 }),
    muxJob(2, "queued", "Blade Runner 2049", "Blade Runner 2049 (2017).mkv"),
    muxJob(3, "ready", "Dune", "Dune (2021).mkv"),
    muxJob(4, "failed", "Tenet", "Tenet (2020).mkv"),
    muxJob(5, "succeeded", "Parasite", "Parasite (2019).mkv"),
    muxJob(6, "draft", "Her", "Her (2013).mkv"),
    ...more,
  ].map((job, i) => ({
    ...job,
    source: { ...job.source, size: (i + 1) * GIB },
  }));
}

// The Muxing page with jobs (ruling I13): the status says MKVToolNix is
// installed, so the page shows no setup notice, and mux/jobs answers
// `jobs` (a function is asked on every request, so a test can change the
// jobs between polls), `delay` ms late. Other mux requests reach the demo
// server.
export async function withMuxJobs(
  page: Page,
  jobs: MuxJobFixture[] | (() => MuxJobFixture[]) = () => muxJobs(),
  { delay = 0 }: { delay?: number } = {},
) {
  await withStatus(page, (status) => {
    const shown = status as { mux?: Record<string, unknown> };
    shown.mux = { ...shown.mux, enabled: true, installed: true };
  });
  await page.route(/\/api\/mux\/jobs$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await late(delay);
    await route.fulfill({
      json: typeof jobs === "function" ? jobs() : jobs,
    });
  });
}

export type PlacementItemFixture = ReturnType<typeof placementItem>;

// A Disk placement item of the API (PlacementItem): by default split over
// its disks with a target, so it can start; `extra` sets any other field,
// such as jobStatus, message, progress or disks.
export function placementItem(
  id: number,
  title: string,
  disks: Record<string, number>,
  extra: Record<string, unknown> = {},
) {
  const sizes = Object.values(disks);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return {
    id,
    itemKey: "sonarr:" + id,
    service: "sonarr",
    instance: "Sonarr",
    // No demo file has these ids.
    mediaId: 900_000 + id,
    season: 0,
    title,
    rel: "shows/" + title,
    share: "shows",
    devices: sizes.length,
    scanStatus: "split",
    kind: "media_files",
    target: Object.keys(disks)[0] || "",
    totalBytes: total,
    moveBytes: total - (sizes[0] || 0),
    moveFiles: 12,
    disks: Object.fromEntries(
      Object.entries(disks).map(([disk, bytes]) => [
        disk,
        { bytes, files: 6, dirs: 2 },
      ]),
    ),
    warnings: [],
    jobStatus: "",
    progress: 0,
    bytesDone: 0,
    message: "",
    updatedAt: "",
    ...extra,
  };
}

// The C+ rows of Disk placement: a show split over two disks, one on a
// single disk, a waiting move over three disks, a moved film without an
// Arr entry and a split show with the cache pool; with `count` more rows
// (ruling I13: the sticky header needs at least 25), further split shows
// follow.
export function placementItems(count = 5): PlacementItemFixture[] {
  const more = Array.from({ length: Math.max(0, count - 5) }, (_, i) =>
    placementItem(6 + i, "Show " + (6 + i), {
      disk1: (10 + i) * GIB,
      disk2: 2 * GIB,
    }),
  );
  return [
    placementItem(1, "Breaking Bad", { disk1: 41 * GIB, disk3: 9 * GIB }),
    placementItem(
      2,
      "Dark",
      { disk2: 36 * GIB },
      { scanStatus: "ok", target: "", moveBytes: 0, moveFiles: 0 },
    ),
    placementItem(
      3,
      "Severance",
      { disk1: 22 * GIB, disk2: 10 * GIB, disk4: 8 * GIB },
      { jobStatus: "queued" },
    ),
    placementItem(
      4,
      "Dune: Part Two",
      { disk3: 6 * GIB },
      {
        service: "",
        instance: "",
        rel: "movies/Dune Part Two (2024)",
        share: "movies",
        scanStatus: "ok",
        jobStatus: "succeeded",
        target: "disk3",
      },
    ),
    placementItem(5, "The Bear", { disk2: 30 * GIB, cache: 3 * GIB }),
    ...more,
  ];
}

const TIB = 1024 * GIB;
// Four array disks and the cache pool, as C+ shows them; with standby
// disk2 and disk4 are spun down (ruling R-B).
function unraidDisks(standby: boolean) {
  return [
    ["disk1", 8 * TIB, 0.9 * TIB, false],
    ["disk2", 8 * TIB, 2.6 * TIB, true],
    ["disk3", 8 * TIB, 1.8 * TIB, false],
    ["disk4", 8 * TIB, 5.7 * TIB, true],
  ]
    .map(([name, total, free, sleeping]) => ({
      name,
      kind: "array",
      total,
      free,
      writable: true,
      excluded: false,
      standby: standby && !!sleeping,
    }))
    .concat({
      name: "cache",
      kind: "pool",
      total: TIB,
      free: 0.69 * TIB,
      writable: true,
      excluded: false,
      standby: false,
    });
}

// Disk placement with a finished scan and rows: placement/scan answers a
// scan (running with `scanning`; its report with an unmapped root, the
// report button's dot, with `notices`) and the moves the rows hold,
// unraid/status the disks (ready, with `standby` two of them spun down),
// placement/items the rows page by page with their total and startable
// ids (a function is asked on every request, so a test can change the rows
// and the switches between polls), each `delay` ms late. Other placement
// requests reach the demo server.
export async function withPlacement(
  page: Page,
  {
    standby = false,
    scanning: scanSwitch = false,
    notices = false,
    items = () => placementItems(),
    delay = 0,
  }: {
    standby?: boolean;
    scanning?: Switch;
    notices?: Switch;
    items?: PlacementItemFixture[] | (() => PlacementItemFixture[]);
    delay?: number;
  } = {},
) {
  const rows = () => (typeof items === "function" ? items() : items);
  const finishedAt = "2026-11-01T09:30:00Z";
  await page.route(/\/api\/placement\/scan$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await late(delay);
    const scanning = on(scanSwitch);
    const list = rows();
    const count = (status: string) =>
      list.filter((item) => item.jobStatus === status).length;
    const several = list.filter((item) => item.devices > 1).length;
    const counts = {
      all: list.length,
      several,
      one_disk: list.length - several,
      open: several,
    };
    const scan = {
      running: scanning,
      startedAt: "2026-11-01T09:29:48Z",
      finishedAt: scanning ? "" : finishedAt,
      duration: 12,
      checked: scanning ? 2 : list.length,
      total: list.length,
      several,
      unstartable: 0,
      disk: scanning ? "disk3" : "",
      counts,
      options: { shareDirs: {} },
      roots: on(notices)
        ? [
            {
              arrPath: "/movies",
              instances: ["Radarr"],
              mapped: false,
              localPath: "",
              suggestion: "",
              share: "",
              items: 0,
              skipped: 0,
            },
          ]
        : [],
    };
    await route.fulfill({
      json: {
        scan,
        report: { ...scan, running: false, finishedAt },
        queued: count("queued"),
        running: count("running"),
        moved: count("succeeded"),
        bytesDone: 0,
        totalBytes: 0,
        fileWork: "",
        counts,
      },
    });
  });
  await page.route(/\/api\/unraid\/status$/, async (route) => {
    await late(delay);
    await route.fulfill({
      json: {
        enabled: true,
        ready: true,
        disks: unraidDisks(standby),
        state: { known: true, mover: false, parity: false },
        fileWork: "",
      },
    });
  });
  await page.route(/\/api\/placement\/items\?/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await late(delay);
    const query = new URL(route.request().url()).searchParams;
    // The status filters of the scan counts (Task 10, the drawer's live
    // count): several disks, on one disk, completed; others match none.
    const statuses = query.getAll("status");
    const matches = (item: PlacementItemFixture, status: string) =>
      status === "all" ||
      (status === "several" && item.devices > 1) ||
      (status === "one_disk" && item.devices === 1) ||
      (status === "moved" && item.jobStatus === "succeeded");
    const list = rows().filter(
      (item) =>
        !statuses.length || statuses.some((status) => matches(item, status)),
    );
    const offset = Number(query.get("offset")) || 0;
    const limit = Number(query.get("limit")) || list.length;
    await route.fulfill({
      json: {
        items: list.slice(offset, offset + limit),
        total: list.length,
        selectableIds: list
          .filter(
            (item) =>
              ["split", "empty_folders"].includes(item.scanStatus) &&
              !!item.target &&
              ["", "failed"].includes(item.jobStatus),
          )
          .map((item) => item.id),
        shares: { shows: list.length - 1, movies: 1 },
        ownerChanges: {},
        hiddenOK: 0,
      },
    });
  });
  // One item, as Details and Status load it (Task 10).
  await page.route(/\/api\/placement\/items\/\d+$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const id = Number(new URL(route.request().url()).pathname.split("/").pop());
    const item = rows().find((row) => row.id === id);
    if (!item) return route.continue();
    await route.fulfill({ json: item });
  });
}

// The C+ findings of Files & permissions: an owner to take on a folder, a
// mode to set on a file, a fixed folder and a manual one (1.7.0 has no
// “ignored” finding, ruling R-G); with `count` more modes to set on files
// follow (Task 10: a selection of 12, the sticky header's 25 rows).
export function findings(count = 4): FindingFixture[] {
  const more = Array.from({ length: Math.max(0, count - 4) }, (_, i) =>
    finding(5 + i, "", "Film " + (5 + i), `movies/Film ${5 + i}/film.nfo`, {
      mode: 0o600,
      size: 1024,
    }),
  );
  return [
    finding(1, "", "Tenet", "movies/Tenet (2020)", {
      dir: true,
      kind: "owner",
      fix: "take_ownership",
      mode: 0o755,
      uid: 0,
      gid: 0,
    }),
    finding(2, "", "Her", "movies/Her (2013)/Her.2013.nfo", {
      mode: 0o600,
      size: 2048,
    }),
    finding(3, "succeeded", "Dark", "shows/Dark/Season 2", {
      service: "sonarr",
      instance: "sonarr",
      dir: true,
      mode: 0o777,
    }),
    finding(4, "", "Alien", "movies/Alien (1979)/Thumbs.db", {
      kind: "other",
      fix: "manual",
      size: 4096,
    }),
    ...more,
  ];
}

// The status filter of filecheck/items (filecheck_http.go): open and
// manual findings have no job, fixed ones succeeded, failed ones failed,
// needs review or were cancelled, active ones wait or run.
function findingStatus(item: FindingFixture): string {
  if (item.jobStatus === "succeeded") return "fixed";
  if (["failed", "needs_review", "cancelled"].includes(item.jobStatus))
    return "failed";
  if (["queued", "running"].includes(item.jobStatus)) return "active";
  return item.fix === "manual" ? "manual" : "open";
}

// Files & permissions with a finished scan and findings (Task 8): the
// scan answers ready with the report of 1,284 checked items (running with
// `scanning`) and the counts and fixes of the findings; filecheck/items
// the findings of the status and kind filters, page by page, with their
// total, fixable ids and shares (a function is asked on every request, so
// a test can change the findings and the switch between polls), each
// `delay` ms late. Other file check requests reach the demo server.
export async function withFindings(
  page: Page,
  {
    scanning: scanSwitch = false,
    items = () => findings(),
    delay = 0,
  }: {
    scanning?: Switch;
    items?: FindingFixture[] | (() => FindingFixture[]);
    delay?: number;
  } = {},
) {
  const rows = () => (typeof items === "function" ? items() : items);
  const finishedAt = "2026-11-01T09:32:00Z";
  await page.route(/\/api\/filecheck\/scan$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await late(delay);
    const scanning = on(scanSwitch);
    const list = rows();
    const counts: Record<string, number> = {};
    for (const item of list) {
      const status = findingStatus(item);
      if (status !== "active") counts[status] = (counts[status] || 0) + 1;
      counts["kind:" + item.kind] = (counts["kind:" + item.kind] || 0) + 1;
    }
    const jobs = (status: string) =>
      list.filter((item) => item.jobStatus === status).length;
    const scan = {
      running: scanning,
      startedAt: "2026-11-01T09:31:48Z",
      finishedAt: scanning ? "" : finishedAt,
      duration: 12,
      checked: scanning ? 600 : 1284,
      total: 1284,
      files: 5120,
      findings: list.length,
      bytes: 6144,
      kinds: Object.fromEntries(
        Object.entries(counts)
          .filter(([key]) => key.startsWith("kind:"))
          .map(([key, n]) => [key.slice(5), n]),
      ),
      fixes: { manual: counts.manual || 0 },
      items: list.length,
      error: "",
      roots: [],
    };
    await route.fulfill({
      json: {
        ready: true,
        error: "",
        physical: true,
        scan,
        report: { ...scan, running: false, finishedAt, checked: 1284 },
        counts,
        queued: jobs("queued"),
        running: jobs("running"),
        fixed: jobs("succeeded"),
        fileWork: "",
      },
    });
  });
  await page.route(/\/api\/filecheck\/items\?/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await late(delay);
    const query = new URL(route.request().url()).searchParams;
    const statuses = query.getAll("status");
    const kinds = query.getAll("kind");
    const list = rows().filter(
      (item) =>
        (!statuses.length || statuses.includes(findingStatus(item))) &&
        (!kinds.length || kinds.includes(item.kind)),
    );
    const offset = Number(query.get("offset")) || 0;
    const limit = Number(query.get("limit")) || list.length;
    await route.fulfill({
      json: {
        items: list.slice(offset, offset + limit),
        total: list.length,
        selectableIds: list
          .filter(
            (item) =>
              item.fix !== "manual" && ["", "failed"].includes(item.jobStatus),
          )
          .map((item) => item.id),
        shares: {
          movies: list.filter((item) => item.rel.startsWith("movies/")).length,
          shows: list.filter((item) => item.rel.startsWith("shows/")).length,
        },
      },
    });
  });
}
