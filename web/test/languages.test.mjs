import test from "node:test";
import assert from "node:assert/strict";
import {
  audioLanguage,
  audioLanguageLabel,
  sameAudioLanguage,
  audioLanguageList,
  loadLanguageRegistry,
} from "../src/languages.ts";
import { readFileSync, existsSync } from "node:fs";
// These cases name languages outside the core ("aaa", "epo"), so the full
// registry loads first.
test("ISO language metadata aliases have one identity and localized readable labels", async () => {
  await loadLanguageRegistry();
  for (const [values, id, flag] of [
    [["cs", "ces", "cze"], "ces", "cz"],
    [["zh", "chi", "zho"], "zho", "cn"],
    [["ko", "kor"], "kor", "kr"],
    [["tr", "tur"], "tur", "tr"],
    [["el", "gre", "ell"], "ell", "gr"],
  ])
    for (const value of values) {
      assert.equal(audioLanguage(value).id, id);
      assert.equal(audioLanguage(value).flag, flag);
      assert.ok(sameAudioLanguage(value, values[0]));
    }
  assert.equal(audioLanguageLabel("kor", "de"), "Koreanisch");
  assert.equal(audioLanguageLabel("ces", "en"), "Czech");
  assert.equal(audioLanguage("en_US").id, "eng");
  assert.equal(audioLanguage("aaa").name, "Ghotuo");
  assert.equal(audioLanguage("epo").flag, undefined);
  assert.equal(audioLanguage("US"), undefined);
  assert.equal(audioLanguage("und"), undefined);
});
test("the full registry and every referenced flag are bundled locally", async () => {
  await loadLanguageRegistry();
  assert.ok(audioLanguageList().length > 7900);
  for (const flag of new Set(
    audioLanguageList()
      .map((l) => l.flag)
      .filter(Boolean),
  )) {
    const path = new URL("../public/flags/" + flag + ".svg", import.meta.url);
    assert.ok(existsSync(path), flag);
    const svg = readFileSync(path, "utf8");
    assert.ok(
      !/<script|\bon\w+\s*=|(?:href|src)\s*=\s*["']https?:/i.test(svg),
      flag,
    );
  }
});

test("registered codes win over colliding names and every ISO alias keeps its identity", async () => {
  await loadLanguageRegistry();
  assert.equal(audioLanguage("ko").id, "kor");
  assert.equal(audioLanguage("ga").id, "gle");
  assert.equal(audioLanguage("Ga (gaa)").id, "gaa");
  for (const language of audioLanguageList())
    for (const code of language.codes)
      if (code !== "und")
        assert.equal(audioLanguage(code)?.id, language.id, code);
});
