export const SD_RESOLUTION = "__sd__";
export function isSDResolution(value: string): boolean {
  if (!/^\d+[pi]$/i.test(value)) return false;
  const lines = Number.parseInt(value, 10);
  return lines > 0 && lines < 720;
}
export function groupResolutionBuckets<
  T extends { value: string; count: number },
>(buckets: T[], enabled: boolean): { value: string; count: number }[] {
  if (!enabled) return buckets;
  const result: { value: string; count: number }[] = [];
  let sd = 0;
  for (const bucket of buckets) {
    if (isSDResolution(bucket.value) || bucket.value === SD_RESOLUTION)
      sd += bucket.count;
    else result.push(bucket);
  }
  if (sd) result.push({ value: SD_RESOLUTION, count: sd });
  return result;
}
export function resolutionFilterValues(
  values: string[],
  selected: string[],
  grouped: boolean,
): string[] {
  const result = values.map((value) =>
    grouped && isSDResolution(value) ? SD_RESOLUTION : value,
  );
  // Existing exact presets keep their meaning. A dashboard SD drilldown works in either mode.
  result.push(
    ...selected.filter(
      (value) => value === SD_RESOLUTION || (grouped && isSDResolution(value)),
    ),
  );
  return [...new Set(result)];
}
