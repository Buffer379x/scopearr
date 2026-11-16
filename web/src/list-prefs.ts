import {
  readPreference,
  removePreference,
  writePreference,
} from "./browser-storage";
import type { Service } from "./types";

// Row density (one for every list), stacked audio tracks and the filename
// under the title (each per list, movies and TV series apart; STYLEGUIDE
// Part 1, 10.1): browser preferences in localStorage only, never a server
// setting, read and written through browser-storage.ts. 1.7.0 knows none of
// these keys, so a downgrade ignores them. The per-list keys carry the
// service ("scopearr-tracks-stacked:radarr") and hold an explicit value; a
// list without its own key starts from the shared key of 2.0.0 release
// candidates (kept readable, never written again). Unknown values and
// blocked storage give the defaults. The last choice written holds for the
// session (`written`), as i18n holds the interface language, so Display and
// the lists agree after a save even when storage is blocked.

export type Density = "comfortable" | "compact";
export type PerList<T> = Record<Service, T>;
export type ListPrefs = {
  density: Density;
  stacked: PerList<boolean>;
  filename: PerList<boolean>;
};
export const DENSITY_KEY = "scopearr-density",
  STACKED_KEY = "scopearr-tracks-stacked",
  FILENAME_KEY = "scopearr-title-filename",
  LIST_PREFS_EVENT = "scopearr-list-prefs";
const SERVICES: readonly Service[] = ["radarr", "sonarr"];

let written: ListPrefs | undefined;

function readStacked(service: Service): boolean {
  const own = readPreference(`${STACKED_KEY}:${service}`);
  if (own === "true" || own === "false") return own === "true";
  return readPreference(STACKED_KEY) === "true";
}
function readFilename(service: Service): boolean {
  const own = readPreference(`${FILENAME_KEY}:${service}`);
  if (own === "hidden" || own === "shown") return own === "shown";
  // On unless the key says "hidden".
  return readPreference(FILENAME_KEY) !== "hidden";
}
function copy(prefs: ListPrefs): ListPrefs {
  return {
    density: prefs.density,
    stacked: { radarr: prefs.stacked.radarr, sonarr: prefs.stacked.sonarr },
    filename: { radarr: prefs.filename.radarr, sonarr: prefs.filename.sonarr },
  };
}

export function readListPrefs(): ListPrefs {
  return written
    ? copy(written)
    : {
        density:
          readPreference(DENSITY_KEY) === "compact" ? "compact" : "comfortable",
        stacked: {
          radarr: readStacked("radarr"),
          sonarr: readStacked("sonarr"),
        },
        filename: {
          radarr: readFilename("radarr"),
          sonarr: readFilename("sonarr"),
        },
      };
}
// Stores the choice and tells the shown lists (LIST_PREFS_EVENT), once.
export function writeListPrefs(prefs: ListPrefs): void {
  written = copy(prefs);
  if (prefs.density === "compact") writePreference(DENSITY_KEY, "compact");
  else removePreference(DENSITY_KEY);
  for (const service of SERVICES) {
    writePreference(
      `${STACKED_KEY}:${service}`,
      prefs.stacked[service] ? "true" : "false",
    );
    writePreference(
      `${FILENAME_KEY}:${service}`,
      prefs.filename[service] ? "shown" : "hidden",
    );
  }
  window.dispatchEvent(new Event(LIST_PREFS_EVENT));
}

// Whether the per-list choices (stacked tracks, filename) differ.
export function listPrefsDiffer(a: ListPrefs, b: ListPrefs): boolean {
  return SERVICES.some(
    (service) =>
      a.stacked[service] !== b.stacked[service] ||
      a.filename[service] !== b.filename[service],
  );
}
