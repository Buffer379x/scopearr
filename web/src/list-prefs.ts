import {
  readPreference,
  removePreference,
  writePreference,
} from "./browser-storage";

// Row density and stacked audio tracks (docs/STYLEGUIDE.md, Part 1, 10.1):
// browser preferences in localStorage only, never a server setting, read and
// written through browser-storage.ts. The default removes its key; unknown
// values and blocked storage give the defaults.

export type Density = "comfortable" | "compact";
export type ListPrefs = { density: Density; stacked: boolean };
export const DENSITY_KEY = "scopearr-density",
  STACKED_KEY = "scopearr-tracks-stacked",
  LIST_PREFS_EVENT = "scopearr-list-prefs";

export function readListPrefs(): ListPrefs {
  return {
    density:
      readPreference(DENSITY_KEY) === "compact" ? "compact" : "comfortable",
    stacked: readPreference(STACKED_KEY) === "true",
  };
}
// Stores the choice and tells the shown lists (LIST_PREFS_EVENT), once.
export function writeListPrefs(prefs: ListPrefs): void {
  if (prefs.density === "compact") writePreference(DENSITY_KEY, "compact");
  else removePreference(DENSITY_KEY);
  if (prefs.stacked) writePreference(STACKED_KEY, "true");
  else removePreference(STACKED_KEY);
  window.dispatchEvent(new Event(LIST_PREFS_EVENT));
}
