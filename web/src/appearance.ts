import {
  readPreference,
  removePreference,
  writePreference,
} from "./browser-storage";

// Theme and accent band on <html>, set before the first render (main.tsx)
// for sign-in, setup, the loading screen and the app. Both are UI
// preferences in localStorage only, read and written through
// browser-storage.ts:
// - scopearr-theme: "dark" | "light" as in 1.7.0; anything else is dark.
// - scopearr-band: "strong" | "muted"; without a valid value the default
//   applies: muted in dark mode, strong in light mode (D16). One choice holds
//   for both modes.
// data-theme and data-band are always set. This page's own choices hold
// while storage is blocked, until it reloads.

export type Theme = "dark" | "light";
export type BandStyle = "strong" | "muted";

const THEME_KEY = "scopearr-theme",
  BAND_KEY = "scopearr-band";
let chosenTheme: Theme | undefined, chosenBand: BandStyle | null | undefined;

const asTheme = (value: string | null): Theme | null =>
  value === "dark" || value === "light" ? value : null;
const asBand = (value: string | null): BandStyle | null =>
  value === "strong" || value === "muted" ? value : null;

export function storedTheme(): Theme {
  return chosenTheme ?? asTheme(readPreference(THEME_KEY)) ?? "dark";
}

export function storedBand(): BandStyle | null {
  return chosenBand !== undefined
    ? chosenBand
    : asBand(readPreference(BAND_KEY));
}

export function resolveBand(theme: Theme, stored: BandStyle | null): BandStyle {
  return stored ?? (theme === "light" ? "strong" : "muted");
}

// Sets data-theme and data-band; writes nothing.
export function applyAppearance(root: HTMLElement, theme: Theme): void {
  const mode: Theme = theme === "light" ? "light" : "dark";
  root.setAttribute("data-theme", mode);
  root.setAttribute("data-band", resolveBand(mode, storedBand()));
}

// Stores the theme, then applies it with the band.
export function setTheme(root: HTMLElement, theme: Theme): void {
  chosenTheme = theme === "light" ? "light" : "dark";
  writePreference(THEME_KEY, chosenTheme);
  applyAppearance(root, chosenTheme);
}

// Stores a band for both modes; null removes it ("use default"). Then
// applies it to the theme the root shows.
export function setBandPreference(
  root: HTMLElement,
  band: BandStyle | null,
): void {
  chosenBand = asBand(band);
  if (chosenBand) writePreference(BAND_KEY, chosenBand);
  else removePreference(BAND_KEY);
  applyAppearance(
    root,
    asTheme(root.getAttribute("data-theme")) ?? storedTheme(),
  );
}
