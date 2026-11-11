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
