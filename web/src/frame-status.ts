import { filesTabVisible } from "./filecheck";
import { instanceLabel, instancesOf, isMediaType } from "./instances";
import { muxTabVisible } from "./mux-spec";
import { disksTabVisible } from "./placement";
import type { ToolView } from "./router";
import { openJobCount } from "./tool-table";
import { TOOLS } from "./tool-route";
import type { Settings, Status } from "./types";

// What the frame shows of the status: open jobs for the bell and the Tools
// plaques, and the sync state for the sync card, chip and drawer row. Pure
// functions of the status (and the settings for sync), so they add no
// request at startup. The bell's job lists load only when it opens
// (hooks/useOpenJobs.ts), from the requests and into the rows below.

type JobTool = ReturnType<typeof jobsSummary>["tools"][number];

// The bell shows at most this many jobs per tool; the tool's row counts all.
export const JOBS_SHOWN = 3;

// The open items of a tool page (Disk placement, Files & permissions) in
// the given states: running and waiting ones (running first) and failed
// ones apart, at most JOBS_SHOWN each, only for the states the tool has.
function itemRequests(
  path: string,
  tool: JobTool,
  active: string[],
  failed: string[],
) {
  return [tool.running + tool.pending ? active : [], tool.failed ? failed : []]
    .filter((states) => states.length)
    .map((states) => {
      const query = new URLSearchParams(
        states.map((state) => ["status", state]),
      );
      query.set("sort", "status");
      query.set("dir", "desc");
      query.set("limit", String(JOBS_SHOWN));
      return path + "?" + query;
    });
}

// Each tool's visibility, job counts, event-log source and the requests of
// its open jobs on the endpoints of its page. The tools and their order
// come from TOOLS.
const TOOL_STATUS: Record<
  ToolView,
  {
    visible: (status: Status) => boolean;
    jobs: (status: Status) =>
      | {
          pending?: number;
          running?: number;
          failed?: number;
        }
      | undefined;
    source: string;
    requests: (tool: JobTool) => string[];
  }
> = {
  mux: {
    visible: muxTabVisible,
    jobs: (status) => status.mux,
    source: "mux",
    requests: () => ["mux/jobs"],
  },
  disks: {
    visible: disksTabVisible,
    jobs: (status) => status.unraid,
    source: "placement",
    requests: (tool) =>
      itemRequests(
        "placement/items",
        tool,
        ["running", "queued"],
        ["failed", "needs_review", "needs_attention"],
      ),
  },
  files: {
    visible: filesTabVisible,
    jobs: (status) => status.files,
    source: "filecheck",
    requests: (tool) =>
      itemRequests("filecheck/items", tool, ["active"], ["failed"]),
  },
};

// Every visible tool with its jobs; count is the sum of their open jobs (the
// 1.7.0 Tools badge), failed the sum of their failed jobs. Hidden tools count
// nowhere.
export function jobsSummary(status: Status): {
  count: number;
  failed: number;
  tools: {
    view: ToolView;
    open: number;
    running: number;
    pending: number;
    failed: number;
  }[];
} {
  const tools = (Object.keys(TOOLS) as ToolView[])
    .filter((view) => TOOL_STATUS[view].visible(status))
    .map((view) => {
      const jobs = TOOL_STATUS[view].jobs(status);
      return {
        view,
        open: openJobCount(jobs),
        running: jobs?.running || 0,
        pending: jobs?.pending || 0,
        failed: jobs?.failed || 0,
      };
    });
  return {
    count: tools.reduce((sum, tool) => sum + tool.open, 0),
    failed: tools.reduce((sum, tool) => sum + tool.failed, 0),
    tools,
  };
}

// The event-log sources of the tools with failed jobs, for the bell's
// "Show in log".
export function logSources(summary: ReturnType<typeof jobsSummary>) {
  return summary.tools
    .filter((tool) => tool.failed)
    .map((tool) => TOOL_STATUS[tool.view].source);
}

// The requests of a tool's open jobs.
export function jobRequests(tool: JobTool): string[] {
  return TOOL_STATUS[tool.view].requests(tool);
}

// An open job's state as the status counts it: mux drafts and ready jobs
// wait, jobs that need attention or review count as failed; finished and
// cancelled ones are not open.
export type JobState = "running" | "waiting" | "failed";
const JOB_STATES: Record<string, JobState> = {
  running: "running",
  draft: "waiting",
  ready: "waiting",
  queued: "waiting",
  failed: "failed",
  needs_attention: "failed",
  needs_review: "failed",
};
const JOB_ORDER: JobState[] = ["running", "failed", "waiting"];
export type JobRow = {
  id: number;
  name: string;
  detail: string;
  state: JobState;
};
// A mux job (status, sourceName) or a tool page's item (jobStatus, rel).
type JobItem = {
  id: number;
  title?: string;
  status?: string;
  jobStatus?: string;
  sourceName?: string;
  rel?: string;
};

// The rows of a tool's open jobs from the answers to its requests (a list
// of mux jobs or a page of items): each job once, running first, then
// failed, then waiting, at most JOBS_SHOWN. A job is named by its title
// with its file (the last part of its path) as the detail, or by its file.
export function jobRows(payloads: unknown[]): JobRow[] {
  const seen = new Set<number>(),
    rows: JobRow[] = [];
  for (const payload of payloads) {
    const items = (
      Array.isArray(payload)
        ? payload
        : ((payload as { items?: unknown } | null)?.items ?? [])
    ) as JobItem[];
    for (const item of items) {
      const key = item.status ?? item.jobStatus ?? "";
      const state = Object.hasOwn(JOB_STATES, key) ? JOB_STATES[key] : null;
      if (!state || seen.has(item.id)) continue;
      seen.add(item.id);
      const file = (item.sourceName || item.rel || "").split("/").pop() || "";
      rows.push({
        id: item.id,
        name: item.title || file,
        detail: item.title ? file : "",
        state,
      });
    }
  }
  return rows
    .sort((a, b) => JOB_ORDER.indexOf(a.state) - JOB_ORDER.indexOf(b.state))
    .slice(0, JOBS_SHOWN);
}

export type SyncState = "ok" | "running" | "error" | "off";

// The sync state of every enabled instance, with the status line of
// System → Info (same catalog keys and parameters, dates through
// formatDate), and one state for the frame: a running sync first, then the
// first error, then the newest successful sync (its time through
// formatTime); off when nothing has synced.
export function syncSummary(
  status: Status,
  settings: Settings | null,
  translate: (k: string, p?: Record<string, string | number>) => string,
  formatDate: (iso?: string | null) => string,
  formatTime: (iso?: string | null) => string,
): {
  state: SyncState;
  text: string;
  services: {
    id: string;
    label: string;
    media: boolean;
    enabled: boolean;
    state: SyncState;
    text: string;
  }[];
} {
  const rows = instancesOf(settings, true).map((instance) => {
    const media = isMediaType(instance.type),
      sync = status.sync?.[instance.id];
    const state: SyncState = !instance.enabled
      ? "off"
      : sync?.running
        ? "running"
        : sync?.error
          ? "error"
          : sync?.lastSuccess
            ? "ok"
            : "off";
    const text = !instance.enabled
      ? translate("Disabled")
      : sync?.running
        ? sync.queued
          ? translate("Sync waiting for a slot …")
          : translate("Sync in progress …")
        : sync?.error
          ? translate("Sync failed · {error}", { error: translate(sync.error) })
          : translate(media ? "Last match: {date}" : "Last sync: {date}", {
              date: formatDate(sync?.lastSuccess),
            });
    return {
      sync,
      service: {
        id: instance.id,
        label: instanceLabel(instance),
        media,
        enabled: instance.enabled,
        state,
        text,
      },
    };
  });
  const services = rows.map((row) => row.service);
  const running = rows.filter((row) => row.service.state === "running");
  if (running.length)
    return {
      state: "running",
      text: running.every((row) => row.sync?.queued)
        ? translate("Sync waiting for a slot …")
        : translate("Sync in progress …"),
      services,
    };
  const failed = services.find((service) => service.state === "error");
  if (failed) return { state: "error", text: failed.text, services };
  const time = (iso: string) => Date.parse(iso) || 0;
  const newest = rows.reduce<string | null>((latest, row) => {
    const success = row.service.state === "ok" ? row.sync?.lastSuccess : null;
    return success && (!latest || time(success) > time(latest))
      ? success
      : latest;
  }, null);
  return {
    state: newest ? "ok" : "off",
    text: translate("Last sync: {date}", { date: formatTime(newest) }),
    services,
  };
}
