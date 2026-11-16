import {
  readPreference,
  removePreference,
  writePreference,
} from "./browser-storage";

// Row density, stacked audio tracks and the filename under the title (docs/STYLEGUIDE.md, Part 1, 10.1):
// browser preferences in localStorage only, never a server setting, read and
// written through browser-storage.ts. The default removes its key; unknown
// values and blocked storage give the defaults. The last choice written
// holds for the session (`written`), as i18n holds the interface language,
// so Display and the lists agree after a save even when storage is blocked.

export type Density = "comfortable" | "compact";
export type ListPrefs = {
  density: Density;
  stacked: boolean;
  filename: boolean;
};
export const DENSITY_KEY = "scopearr-density",
  STACKED_KEY = "scopearr-tracks-stacked",
  FILENAME_KEY = "scopearr-title-filename",
  LIST_PREFS_EVENT = "scopearr-list-prefs";

let written: ListPrefs | undefined;

export function readListPrefs(): ListPrefs {
  return written
    ? { ...written }
    : {
        density:
          readPreference(DENSITY_KEY) === "compact" ? "compact" : "comfortable",
        stacked: readPreference(STACKED_KEY) === "true",
        // On unless the key says "hidden".
        filename: readPreference(FILENAME_KEY) !== "hidden",
      };
}
// Stores the choice and tells the shown lists (LIST_PREFS_EVENT), once.
export function writeListPrefs(prefs: ListPrefs): void {
  written = {
    density: prefs.density,
    stacked: prefs.stacked,
    filename: prefs.filename,
  };
  if (prefs.density === "compact") writePreference(DENSITY_KEY, "compact");
  else removePreference(DENSITY_KEY);
  if (prefs.stacked) writePreference(STACKED_KEY, "true");
  else removePreference(STACKED_KEY);
  if (prefs.filename) removePreference(FILENAME_KEY);
  else writePreference(FILENAME_KEY, "hidden");
  window.dispatchEvent(new Event(LIST_PREFS_EVENT));
}
