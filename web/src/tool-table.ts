// Column geometry stays independent of the rows currently on screen.
export const toolColumnWidths: Record<string, number> = {
  select: 40,
  actions: 124,
  title: 200,
  service: 120,
  size: 88,
  disks: 156,
  target: 88,
  move: 120,
  kind: 120,
  status: 120,
  progress: 120,
  remove: 52,
  path: 260,
  current: 120,
  fix: 112,
  filename: 200,
  origin: 120,
  buttons: 88,
};
export function toolColumn(field: string, kind: string) {
  return kind === "mux"
    ? {
        filename: "title",
        origin: "service",
        buttons: "actions",
        actions: "remove",
      }[field] || field
    : field;
}
export function measuredHeaderWidth(label: string, sorted = true) {
  if (!label) return 0;
  if (typeof document === "undefined") return 0;
  const root = getComputedStyle(document.documentElement),
    body = getComputedStyle(document.body);
  const font = Number.parseFloat(root.getPropertyValue("--font-2xs")) || 10;
  const spacing =
    Number.parseFloat(root.getPropertyValue("--letter-spacing")) || 0;
  const weight = root.getPropertyValue("--weight-medium").trim() || "500";
  const text = label.toLocaleUpperCase(
    document.documentElement.lang || undefined,
  );
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return 0;
  ctx.font = weight + " " + font + "px " + body.fontFamily;
  const pad = Number.parseFloat(root.getPropertyValue("--space-3")) || 12;
  const gap = Number.parseFloat(root.getPropertyValue("--space-2")) || 8;
  return (
    Math.ceil(
      ctx.measureText(text).width +
        text.length * spacing +
        pad * 2 +
        (sorted ? 13 + gap : 0),
    ) + 1
  );
}
export function toolTableStyle(
  columns: readonly string[],
  kind: string,
  labels: Record<string, string> = {},
) {
  const actions = kind === "placement" ? 124 : 88;
  const widths: Record<string, number> = {};
  const vars: Record<string, string> = {};
  for (const field of columns) {
    const column = toolColumn(field, kind);
    const minimum =
      column === "actions" ? actions : toolColumnWidths[column] || 120;
    widths[column] = Math.max(
      minimum,
      ["select", "actions", "remove"].includes(column)
        ? 0
        : measuredHeaderWidth(labels[field] || ""),
    );
    if (column !== "title")
      vars["--tool-col-" + column] = widths[column] + "px";
  }
  const total = Object.values(widths).reduce((sum, n) => sum + n, 0);
  return {
    ...vars,
    "--table-min": total + "px",
    "--table-min-mobile": total - (widths.actions ? actions - 52 : 0) + "px",
  };
}
export function openJobCount(value?: {
  pending?: number;
  running?: number;
  failed?: number;
}) {
  return (value?.pending || 0) + (value?.running || 0) + (value?.failed || 0);
}
export function muxOpenJobs(jobs: readonly { status: string }[]) {
  return jobs.filter((job) =>
    [
      "draft",
      "ready",
      "queued",
      "running",
      "failed",
      "needs_attention",
      "needs_review",
    ].includes(job.status),
  ).length;
}
