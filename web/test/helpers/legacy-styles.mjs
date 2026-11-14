import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// The seven 1.7.0 stylesheets in style.css import order. Legacy UI tests read
// stylesheets only through this list, so new files under styles/ (such as
// styles/v2/) never reach them.
export const LEGACY_STYLESHEETS = Object.freeze([
  "base.css",
  "library.css",
  "dialogs.css",
  "settings-and-filters.css",
  "recognition.css",
  "placement.css",
  "responsive.css",
]);

const url = (name) => new URL("../../src/styles/" + name, import.meta.url);

export function legacyCss(name) {
  assert.ok(LEGACY_STYLESHEETS.includes(name), name + " is not a 1.7.0 sheet");
  return readFileSync(url(name), "utf8");
}

export function allLegacyCss() {
  return LEGACY_STYLESHEETS.map(legacyCss).join("\n");
}

// Whether a file exists in styles/, for checks that retired stylesheets
// stay deleted.
export const stylesheetExists = (name) => existsSync(url(name));
