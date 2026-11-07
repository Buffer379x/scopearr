import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { audioChannelLayout } from "../src/audio-channels.ts";
import { src } from "./helpers/sources.mjs";

// 2.0.0 adds 1.0 and 6.1 filename defaults, not mono/stereo tokens. Track
// layouts keep the names 1.7.0 already showed (Go: mediaChannelLayout).
test("track layouts keep the 1.7.0 channel names", () => {
  assert.equal(audioChannelLayout({ channelLayout: "mono" }), "1.0");
  assert.equal(audioChannelLayout({ channelLayout: "stereo" }), "2.0");
  assert.equal(audioChannelLayout({ channelLayout: "6.1" }), "6.1");
  assert.equal(audioChannelLayout({ channels: 6 }), "6 ch");
});

// The start-up step that adds the 2.0.0 default tag rules reports a failure
// with a warning of its own (store_open.go), translated in every catalog.
test("the default rule step warns with its own translated text", () => {
  const key = "Could not add the new default tag rules: {error}";
  const go = readFileSync(
    new URL("../../internal/app/store_open.go", import.meta.url),
    "utf8",
  );
  assert.match(
    go,
    /ensureDefaultRules200\(context\.Background\(\)\); err != nil \{\s*s\.Events\.Add\("warning", "system", "", "Could not add the new default tag rules: \{error\}"/,
  );
  const english = JSON.parse(src("locales/en.json")).messages;
  assert.equal(english[key], key);
  for (const locale of ["de", "es", "it"]) {
    const value = JSON.parse(src("locales/" + locale + ".json")).messages[key];
    assert.ok(value && value !== key, locale + " translates " + key);
    assert.match(value, /\{error\}/, locale);
  }
});
