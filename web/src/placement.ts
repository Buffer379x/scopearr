import type { PlacementItem, Settings, Status, UnraidSettings } from "./types";
export const defaultUnraidSettings: UnraidSettings = {
  enabled: false,
  diskRoot: "/unraid",
  shareRoot: "/media",
  stateDir: "",
  muxSameDisk: true,
  libraries: [],
  seriesGrouping: "series",
  excludedDisks: [],
  reserveGB: 20,
  verifyChecksum: false,
};
export const placementColumns = [
  "select",
  "actions",
  "title",
  "service",
  "size",
  "disks",
  "target",
  "move",
  "kind",
  "status",
  "progress",
  "remove",
];
export const placementSortable = new Set([
  "title",
  "service",
  "size",
  "disks",
  "target",
  "move",
  "kind",
  "status",
  "progress",
]);
export const placementColumnLabels: Record<string, string> = {
  select: "Selection (always first)",
  actions: "Actions",
  title: "Title",
  service: "Service",
  size: "Size",
  disks: "Disks",
  target: "Target",
  move: "Move",
  kind: "Kind",
  status: "Status",
  progress: "Progress",
  remove: "Remove",
};
export const placementStatusLabels: Record<string, string> = {
  ok: "On one disk",
  split: "Several disks",
  empty_folders: "Empty folders",
  waiting_for_mover: "Waiting for mover",
  conflict: "Conflict",
  no_space: "No space",
  foreign_owner: "Foreign owner",
  outside_share: "Outside user share",
  error: "Error",
  queued: "Waiting",
  running: "Moving",
  succeeded: "Moved",
  failed: "Failed",
  cancelled: "Cancelled",
  needs_review: "Review needed",
  needs_attention: "Action needed",
};
// Short tag texts for the table; placementStatusLabels stay as tooltips.
export const placementStatusShort: Record<string, string> = {
  ok: "One disk",
  split: "Split",
  empty_folders: "Empty",
  waiting_for_mover: "Mover",
  conflict: "Conflict",
  no_space: "No space",
  foreign_owner: "Owner",
  outside_share: "Outside",
  error: "Error",
  queued: "Queued",
  running: "Moving",
  succeeded: "Moved",
  failed: "Failed",
  cancelled: "Cancelled",
  needs_review: "Review",
  needs_attention: "Attention",
};
// Shared semantic status colors across all tools.
export const placementStatusTone: Record<string, string> = {
  ok: "ok",
  split: "info",
  empty_folders: "info",
  waiting_for_mover: "warn",
  conflict: "error",
  no_space: "warn",
  foreign_owner: "error",
  outside_share: "neutral",
  error: "error",
  queued: "wait",
  running: "running",
  succeeded: "ok",
  failed: "error",
  cancelled: "neutral",
  needs_review: "warn",
  needs_attention: "error",
};
export function placementItemStatus(
  item: Pick<PlacementItem, "scanStatus" | "jobStatus">,
) {
  return item.jobStatus || item.scanStatus;
}
// Green is the target; orange marks the disks the move empties.
export function placementDiskTone(
  item: Pick<PlacementItem, "disks" | "target">,
  disk: string,
): "target" | "source" | "" {
  if (!item.disks?.[disk]) return "";
  const target = item.target || placementDisksBySize(item)[0]?.[0] || "";
  return disk === target ? "target" : "source";
}
export function placementDisksBySize(item: Pick<PlacementItem, "disks">) {
  return Object.entries(item.disks || {}).sort(
    ([a, x], [b, y]) => y.bytes - x.bytes || a.localeCompare(b),
  );
}
export function disksTabVisible(status: Pick<Status, "unraid">) {
  return !!status.unraid?.enabled;
}
export function placementStartable(
  item: Pick<PlacementItem, "scanStatus" | "target" | "jobStatus">,
) {
  return (
    ["split", "empty_folders"].includes(item.scanStatus) &&
    !!item.target &&
    ["", "failed"].includes(item.jobStatus)
  );
}
// Marked or single starts may include mover items; "Start all" never does.
export function placementSelectable(
  item: Pick<PlacementItem, "scanStatus" | "target" | "jobStatus">,
) {
  return (
    placementStartable(item) ||
    (item.scanStatus === "waiting_for_mover" &&
      !!item.target &&
      ["", "failed"].includes(item.jobStatus))
  );
}
export function placementSelection(items: PlacementItem[], selected: number[]) {
  const ids = items.filter(placementStartable).map((i) => i.id);
  const count = ids.filter((id) => selected.includes(id)).length;
  return {
    ids,
    all: !!ids.length && count === ids.length,
    partial: count > 0 && count < ids.length,
  };
}
export function placementQueueIds(ordered: number[], selected?: number[]) {
  if (!selected) return ordered;
  const wanted = new Set(selected);
  return ordered.filter((id) => wanted.has(id));
}
export function placementOrderedColumns(settings: Settings | null) {
  const order = settings?.placementColumnOrder || placementColumns;
  const visible = settings?.placementVisibleColumns || placementColumns;
  return [
    "select",
    ...order.filter(
      (key) =>
        key !== "select" &&
        placementColumns.includes(key) &&
        visible.includes(key),
    ),
  ];
}
export function placementSort(a: PlacementItem, b: PlacementItem) {
  return (
    Number(!placementStartable(a)) - Number(!placementStartable(b)) ||
    Number(a.kind !== "small_files") - Number(b.kind !== "small_files") ||
    a.moveBytes - b.moveBytes ||
    a.id - b.id
  );
}
export function placementScanCompleted(
  previous: string | undefined,
  scan: { finishedAt: string; running: boolean },
) {
  return (
    previous !== undefined &&
    !scan.running &&
    !!scan.finishedAt &&
    scan.finishedAt !== previous
  );
}
export function placementDuration(seconds: number) {
  const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  if (value < 60) return `${Math.ceil(value)} s`;
  if (value < 3600) return `${Math.ceil(value / 60)} min`;
  return `${Math.ceil(value / 3600)} h`;
}
