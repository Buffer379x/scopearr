// Preferences remain optional when browser storage is blocked or full.
export function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export type ToolFilters = {
  statuses: string[];
  targets: string[];
  kinds: string[];
  q: string;
};
export function parseToolFilters(value: string | null): ToolFilters {
  const empty: ToolFilters = { statuses: [], targets: [], kinds: [], q: "" };
  try {
    const parsed: unknown = JSON.parse(value || "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return empty;
    const data = parsed as Record<string, unknown>;
    for (const key of ["statuses", "targets", "kinds"] as const) {
      const values = data[key];
      if (
        values !== undefined &&
        (!Array.isArray(values) || values.some((v) => typeof v !== "string"))
      )
        return { statuses: [], targets: [], kinds: [], q: "" };
      empty[key] = [...new Set((values || []) as string[])];
    }
    empty.q = typeof data.q === "string" ? data.q : "";
  } catch {
    return { statuses: [], targets: [], kinds: [], q: "" };
  }
  return empty;
}
export function readToolFilters(key: string) {
  return parseToolFilters(readPreference(key));
}
