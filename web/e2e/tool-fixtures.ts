// Tool page fixtures (Phase 5b): the job and finding factories the frame's
// bell and the tool pages share, and the tool rows the demo does not have.
// The factories are function declarations, so app.ts, which imports them,
// can be loaded before or after this module.
import type { Page } from "@playwright/test";
import { withStatus } from "./app";

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

// A Files & permissions finding of the API (FileCheckItem).
export function finding(
  id: number,
  jobStatus: string,
  title: string,
  rel: string,
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
    finishedAt: null,
  };
}

// The C+ mux jobs: one per status the page shows, sizes from 1 to 6 GiB.
const GIB = 1024 ** 3;
export function muxJobs(): MuxJobFixture[] {
  return [
    muxJob(1, "running", "Arrival", "Arrival (2016).mkv", { progress: 64 }),
    muxJob(2, "queued", "Blade Runner 2049", "Blade Runner 2049 (2017).mkv"),
    muxJob(3, "ready", "Dune", "Dune (2021).mkv"),
    muxJob(4, "failed", "Tenet", "Tenet (2020).mkv"),
    muxJob(5, "succeeded", "Parasite", "Parasite (2019).mkv"),
    muxJob(6, "draft", "Her", "Her (2013).mkv"),
  ].map((job, i) => ({
    ...job,
    source: { ...job.source, size: (i + 1) * GIB },
  }));
}

// The Muxing page with jobs (ruling I13): the status says MKVToolNix is
// installed, so the page shows no setup notice, and mux/jobs answers
// `jobs` (a function is asked on every request, so a test can change the
// jobs between polls). Other mux requests reach the demo server.
export async function withMuxJobs(
  page: Page,
  jobs: MuxJobFixture[] | (() => MuxJobFixture[]) = muxJobs,
) {
  await withStatus(page, (status) => {
    const shown = status as { mux?: Record<string, unknown> };
    shown.mux = { ...shown.mux, enabled: true, installed: true };
  });
  await page.route(/\/api\/mux\/jobs$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
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
// scan (running with `scanning`) and the moves the rows hold, unraid/status
// the disks (ready, with `standby` two of them spun down), placement/items
// the rows page by page with their total and startable ids (a function is
// asked on every request, so a test can change the rows between polls).
// Other placement requests reach the demo server.
export async function withPlacement(
  page: Page,
  {
    standby = false,
    scanning = false,
    items = () => placementItems(),
  }: {
    standby?: boolean;
    scanning?: boolean;
    items?: PlacementItemFixture[] | (() => PlacementItemFixture[]);
  } = {},
) {
  const rows = () => (typeof items === "function" ? items() : items);
  const finishedAt = "2026-11-01T09:30:00Z";
  await page.route(/\/api\/placement\/scan$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
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
      roots: [],
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
  await page.route(/\/api\/unraid\/status$/, (route) =>
    route.fulfill({
      json: {
        enabled: true,
        ready: true,
        disks: unraidDisks(standby),
        state: { known: true, mover: false, parity: false },
        fileWork: "",
      },
    }),
  );
  await page.route(/\/api\/placement\/items\?/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const query = new URL(route.request().url()).searchParams;
    const list = rows();
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
}
