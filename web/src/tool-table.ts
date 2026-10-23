// Column geometry stays independent of the rows currently on screen.
export const toolColumnWidths: Record<string, number> = {
  select: 48,
  actions: 132,
  title: 260,
  service: 150,
  size: 100,
  disks: 200,
  target: 100,
  move: 120,
  kind: 140,
  status: 160,
  progress: 150,
  remove: 64,
  path: 320,
  current: 140,
  fix: 140,
  filename: 260,
  origin: 150,
  buttons: 96,
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
export function toolTableStyle(columns: readonly string[], kind: string) {
  const total = columns.reduce(
    (sum, field) =>
      sum +
      (field === "actions" && kind === "files"
        ? 96
        : kind === "mux" && field === "actions"
          ? 64
          : toolColumnWidths[field] || 120),
    0,
  );
  const actions = kind === "placement" ? 132 : 96;
  return {
    "--table-min": total + "px",
    "--table-min-mobile":
      total -
      (columns.includes(kind === "mux" ? "buttons" : "actions")
        ? actions - 64
        : 0) +
      "px",
    "--tool-col-actions": actions + "px",
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
