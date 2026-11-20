import { readPreference, writePreference } from "./browser-storage";

// The sidebar's mode and its open groups. Both are UI preferences in
// localStorage only (never a server setting); every read and write goes
// through browser-storage.ts, so blocked or full storage leaves the defaults.

export type SidebarMode = "expanded" | "rail" | "drawer";
export type SidebarGroups = Record<"movies" | "series" | "settings", boolean>;

// "expanded" or "rail", chosen with the button at the bottom of the sidebar.
const MODE_KEY = "scopearr-sidebar";
// JSON {movies, series, settings}: which groups the expanded sidebar opens.
const GROUPS_KEY = "scopearr-sidebar-groups";
const DEFAULT_GROUPS: Readonly<SidebarGroups> = Object.freeze({
  movies: true,
  series: true,
  settings: false,
});

// Up to 739px the drawer, whatever was chosen; from 740px the stored choice;
// without one, expanded from 1600px and the rail below.
export function sidebarMode(
  width: number,
  preference: "expanded" | "rail" | null,
): SidebarMode {
  if (width <= 739) return "drawer";
  if (preference === "expanded" || preference === "rail") return preference;
  return width >= 1600 ? "expanded" : "rail";
}

export function readSidebarPreference(): "expanded" | "rail" | null {
  const value = readPreference(MODE_KEY);
  return value === "expanded" || value === "rail" ? value : null;
}

export function writeSidebarPreference(mode: "expanded" | "rail"): void {
  if (mode === "expanded" || mode === "rail") writePreference(MODE_KEY, mode);
}

// A new object on every read; each group without a stored boolean keeps its
// default.
export function readSidebarGroups(): SidebarGroups {
  const groups = { ...DEFAULT_GROUPS };
  let stored: unknown = null;
  try {
    stored = JSON.parse(readPreference(GROUPS_KEY) || "null");
  } catch {}
  if (stored && typeof stored === "object" && !Array.isArray(stored))
    for (const key of Object.keys(groups) as (keyof SidebarGroups)[]) {
      const value = (stored as Record<string, unknown>)[key];
      if (typeof value === "boolean") groups[key] = value;
    }
  return groups;
}

export function writeSidebarGroups(groups: SidebarGroups): void {
  writePreference(
    GROUPS_KEY,
    JSON.stringify({
      movies: !!groups.movies,
      series: !!groups.series,
      settings: !!groups.settings,
    }),
  );
}
