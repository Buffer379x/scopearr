import test from "node:test";
import assert from "node:assert/strict";
import * as languages from "../src/languages.ts";
import { src, squash } from "./helpers/sources.mjs";

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
