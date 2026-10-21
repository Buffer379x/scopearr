import type { Settings } from "./types";
// GET retains legacy fields for older clients. Never echo these obsolete controls back.
export function settingsPayload(settings: Settings): Settings {
  return Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) => key !== "muxColumnOrder" && key !== "muxVisibleColumns",
    ),
  ) as Settings;
}
