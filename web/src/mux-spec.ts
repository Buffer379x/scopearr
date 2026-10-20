import type {
  MuxSettings,
  MuxSpec,
  MuxTrack,
  MuxJob,
  Settings,
  MuxRootFolder,
  Status,
} from "./types";
import { audioLanguage } from "./languages.ts";
export const defaultMuxSettings = (): MuxSettings => ({
  workDir: "",
  enabled: false,
  channel: "stable" as const,
  mappings: "",
  deleteOriginal: true,
  notifyMedia: true,
  keepFinished: 7,
});
export function cleanMuxName(name: string) {
  return name.replace(/\.mkv$/i, "");
}
export function muxTabVisible(status: Pick<Status, "mux">) {
  const m = status.mux;
  return !!m?.enabled && m.pending + m.running + m.failed > 0;
}
export function validateMuxSpec(tracks: MuxTrack[], spec: MuxSpec): string {
  const name = cleanMuxName(spec.outputName);
  if (
    !name ||
    new TextEncoder().encode(name).length > 200 ||
    /^\./.test(name) ||
    /[/\\\p{Cc}]/u.test(name) ||
    /\.partial$|\.scopearr-backup/i.test(name)
  )
    return "Invalid output filename";
  const kept = tracks.filter((t) => spec.tracks[t.id]?.keep);
  if (
    !kept.length ||
    (tracks.some((t) => t.type === "video") &&
      !kept.some((t) => t.type === "video"))
  )
    return "Keep at least one track and one video track when present";
  const defaults: Record<string, number> = {};
  for (const t of kept) {
    const p = spec.tracks[t.id];
    if (p.default && (defaults[t.type] = (defaults[t.type] || 0) + 1) > 1)
      return "Only one default track per type is allowed";
    if ([...p.name].length > 256 || /\p{Cc}/u.test(p.name))
      return "Invalid track name";
    if (
      p.language.length > 63 ||
      !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(p.language) ||
      (p.language.split("-")[0].toLowerCase() !== "und" &&
        !audioLanguage(p.language.split("-")[0]))
    )
      return "Invalid track language";
  }
  return "";
}

export const muxColumns = [
  "select",
  "buttons",
  "filename",
  "size",
  "origin",
  "status",
  "progress",
  "actions",
];
export const muxColumnLabels: Record<string, string> = {
  select: "Selection (always first)",
  buttons: "Buttons",
  filename: "Filename",
  size: "Size",
  origin: "Source service",
  status: "Status",
  progress: "Progress",
  actions: "Actions",
};
export const muxStatusLabels: Record<string, string> = {
  warning: "Warning",
  draft: "Not configured",
  ready: "Ready",
  queued: "Waiting",
  running: "Running",
  succeeded: "Successful",
  failed: "Failed",
  cancelled: "Cancelled",
  needs_review: "Review needed",
  needs_attention: "Action needed",
};
export function effectiveMuxStatus(job: Pick<MuxJob, "status" | "check">) {
  return ["draft", "ready", "failed", "cancelled"].includes(job.status) &&
    Object.values(job.check).some((v) => !v)
    ? "warning"
    : job.status;
}
export function muxStartable(job: Pick<MuxJob, "status">) {
  return ["ready", "failed", "cancelled"].includes(job.status);
}
export function muxSelection(jobs: MuxJob[], selected: number[]) {
  const ids = jobs.filter(muxStartable).map((j) => j.id);
  const count = ids.filter((id) => selected.includes(id)).length;
  return {
    ids,
    all: ids.length > 0 && count === ids.length,
    partial: count > 0 && count < ids.length,
  };
}
export function displayMuxColumns(
  settings: Pick<Settings, "muxColumnOrder" | "muxVisibleColumns"> | null,
  showAll = false,
) {
  const order = settings?.muxColumnOrder || muxColumns;
  const visible = settings?.muxVisibleColumns || muxColumns;
  return [
    "select",
    ...order.filter(
      (k) =>
        k !== "select" &&
        muxColumns.includes(k) &&
        (showAll || k === "filename" || visible.includes(k)),
    ),
  ];
}
export function importMuxRoots(draft: string, roots: MuxRootFolder[]) {
  const seen = new Set(
    draft
      .split("\n")
      .map((line) => line.split("=>")[0].trim().replace(/\/+$/, "")),
  );
  const lines: string[] = [];
  const missing: MuxRootFolder[] = [];
  for (const root of roots) {
    if (root.mapped || seen.has(root.arrPath)) continue;
    if (root.suggestion) {
      lines.push(root.arrPath + " => " + root.suggestion);
      seen.add(root.arrPath);
    } else missing.push(root);
  }
  return {
    mappings: [draft.trim(), ...lines].filter(Boolean).join("\n"),
    added: lines.length,
    missing,
  };
}
export function muxLogClass(line: string) {
  return line.startsWith("Warning:")
    ? "terminal-warning"
    : line.startsWith("Error:")
      ? "terminal-error"
      : line.startsWith("Finished:")
        ? "terminal-success"
        : "";
}

export const routineMuxMessages = new Set([
  "Ready",
  "Queued",
  "Checking media file",
  "Muxing",
  "Verifying",
  "Moving output",
  "Replacing",
  "Rescanning",
  "Mux completed",
]);
