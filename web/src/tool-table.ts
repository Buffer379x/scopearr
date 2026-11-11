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
export function openJobCount(value?: {
  pending?: number;
  running?: number;
  failed?: number;
}) {
  return (value?.pending || 0) + (value?.running || 0) + (value?.failed || 0);
}
// The open mux jobs of the page header's "{count} open": the jobs the
// Open KPI card counts (tool-list MUX_OPEN_STATUSES, by the effective
// status), so the page shows one number. A cancelled job with a failed
// check is a warning, so it is open too; the other effective statuses
// follow their own status.
const MUX_OPEN = [
  "draft",
  "ready",
  "queued",
  "running",
  "failed",
  "needs_attention",
  "needs_review",
];
export function muxOpenJobs(
  jobs: readonly { status: string; check?: object }[],
) {
  return jobs.filter(
    (job) =>
      MUX_OPEN.includes(job.status) ||
      (job.status === "cancelled" &&
        Object.values(job.check ?? {}).some((value) => !value)),
  ).length;
}
