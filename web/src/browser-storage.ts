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

export function removePreference(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {}
}

export type ToolFilters = {
  statuses: string[];
  targets: string[];
  kinds: string[];
  q: string;
};
type ToolFilterOptions = {
  statuses: readonly string[];
  kinds?: readonly string[];
};

export function parseToolFilters(
  value: string | null,
  allowed?: ToolFilterOptions,
): ToolFilters {
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
  if (allowed) {
    empty.statuses = empty.statuses.filter((value) =>
      allowed.statuses.includes(value),
    );
    if (allowed.kinds)
      empty.kinds = empty.kinds.filter((value) =>
        allowed.kinds!.includes(value),
      );
  }
  return empty;
}
export function readToolFilters(key: string, allowed?: ToolFilterOptions) {
  return parseToolFilters(readPreference(key), allowed);
}

export function readSessionPreference(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeSessionPreference(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {}
}
export type NavigationState = {
  view: "library" | "statistics" | "mux" | "disks" | "files";
  service: "radarr" | "sonarr";
  page: number;
  filters: Record<"radarr" | "sonarr", string>;
  settingsOpen: boolean;
  settingsSection: string;
};
export function readNavigation(): NavigationState {
  const fallback: NavigationState = {
    view: "statistics",
    service: "radarr",
    page: 1,
    filters: { radarr: "", sonarr: "" },
    settingsOpen: false,
    settingsSection: "connections",
  };
  try {
    const value = JSON.parse(
      readSessionPreference("scopearr-navigation") || "null",
    );
    if (
      !value ||
      !["library", "statistics", "mux", "disks", "files"].includes(
        value.view,
      ) ||
      !["radarr", "sonarr"].includes(value.service)
    )
      return fallback;
    return {
      ...fallback,
      view: value.view,
      service: value.service,
      page: Number.isInteger(value.page) && value.page > 0 ? value.page : 1,
      filters: {
        radarr:
          typeof value.filters?.radarr === "string" ? value.filters.radarr : "",
        sonarr:
          typeof value.filters?.sonarr === "string" ? value.filters.sonarr : "",
      },
      settingsOpen: value.settingsOpen === true,
      settingsSection:
        typeof value.settingsSection === "string"
          ? value.settingsSection
          : "connections",
    };
  } catch {
    return fallback;
  }
}
