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
// request at startup.

// Each tool's visibility and job counts in the status. The tools and their
// order come from TOOLS.
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
  }
> = {
  mux: { visible: muxTabVisible, jobs: (status) => status.mux },
  disks: { visible: disksTabVisible, jobs: (status) => status.unraid },
  files: { visible: filesTabVisible, jobs: (status) => status.files },
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
