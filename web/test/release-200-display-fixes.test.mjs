import test from "node:test";
import assert from "node:assert/strict";
import * as languages from "../src/languages.ts";
import { src, squash } from "./helpers/sources.mjs";
import { componentHarness, text } from "./helpers/component-harness.mjs";

// Stored language values stay canonical German (parser.go); the file dialog
// names them in the interface language, as the language flags already do.
test("languages name canonical values in the interface language", () => {
  const { audioLanguageListLabel } = languages;
  assert.equal(typeof audioLanguageListLabel, "function");
  const same = (key) => key;
  assert.equal(
    audioLanguageListLabel("Deutsch, Englisch", "en", same),
    "German, English",
  );
  assert.equal(
    audioLanguageListLabel("Deutsch, Englisch", "de", same),
    "Deutsch, Englisch",
  );
  assert.equal(audioLanguageListLabel("Englisch", "es", same), "inglés");
  assert.equal(
    audioLanguageListLabel("Klingonisch", "en", same),
    "Klingonisch",
  );
  assert.equal(audioLanguageListLabel("", "en", same), "");
  assert.equal(audioLanguageListLabel("und", "en", same), "Unknown");
});

test("file details route language evidence through the label", () => {
  const code = squash(src("components/FileDialog.tsx"));
  for (const call of [
    "shown(k, e.filename)",
    "shown(k, e.api)",
    "shown(k, e.emby)",
    "shown(k, e.mediainfo)",
    "formatValue=",
  ])
    assert.ok(code.includes(call), call);
  assert.ok(!code.includes('{e.api || "—"}'), "raw Radarr/Sonarr value");
});

// Setup is the same component with an uninitialized status.
test("login footer separates the version from the tagline", () => {
  for (const initialized of [true, false]) {
    const harness = componentHarness(
      "Login",
      { status: { version: "2.0.0", initialized }, done: async () => {} },
      { modules: { "../api": { api: async () => ({}) } } },
    );
    const shown = text(harness.render());
    assert.ok(
      shown.includes("Scopearr 2.0.0 · For your own server"),
      `${initialized ? "login" : "setup"}: ${shown}`,
    );
  }
});
