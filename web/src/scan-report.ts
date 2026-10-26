/** Completed report timestamps shared by the scan report dialogs. */
export function scanReportTime(
  scan: { startedAt?: string; finishedAt?: string } | undefined,
  locale: string,
): { date: string; iso: string; duration: string } | undefined {
  if (!scan?.finishedAt) return;
  const finished = new Date(scan.finishedAt);
  if (!Number.isFinite(finished.getTime())) return;
  const started = scan.startedAt ? Date.parse(scan.startedAt) : NaN;
  const seconds = Math.round((finished.getTime() - started) / 1000);
  const number = new Intl.NumberFormat(locale);
  return {
    date: finished.toLocaleString(locale),
    iso: finished.toISOString(),
    duration:
      Number.isFinite(seconds) && seconds >= 0
        ? `${number.format(Math.floor(seconds / 60))} min ${number.format(seconds % 60)} s`
        : "",
  };
}
