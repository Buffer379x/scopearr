import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The interface ships the ISO 639-1 core of the language registry and loads
// the full registry (about 8000 rows) only when a value misses the core.
const registryUrl = new URL(
  "../../internal/langdata/registry.json",
  import.meta.url,
);
const registry = JSON.parse(readFileSync(registryUrl, "utf8"));
const coreUrl = new URL("../src/language-core.json", import.meta.url);
const special = ["mis", "mul", "und", "zxx"];

// Each call gets its own module instance, so its registry starts unloaded.
let instance = 0;
const fresh = () => import("../src/languages.ts?fresh=" + ++instance);

// Lets a started dynamic import finish: the registry module is already
// cached, so a pending load settles within these turns.
async function drain() {
  await import(registryUrl, { with: { type: "json" } });
  for (let turn = 0; turn < 5; turn++)
    await new Promise((resolve) => setImmediate(resolve));
}

test("the language core is the ISO 639-1 part of the registry", () => {
  const core = JSON.parse(readFileSync(coreUrl, "utf8"));
  assert.deepEqual(
    core,
    registry.filter(([id, iso1]) => iso1 || special.includes(id)),
  );
  assert.equal(core.filter(([, iso1]) => iso1).length, 186);
  assert.deepEqual(
    core.filter(([, iso1]) => !iso1).map(([id]) => id),
    special,
  );
});

// Every alias the core knows names the language the full registry names, so
// a later load never changes a label or flag already shown.
test("core lookups agree with the full registry", async () => {
  const core = JSON.parse(readFileSync(coreUrl, "utf8"));
  const languages = await fresh();
  const keys = core.flatMap(([, , , canonical, codes, aliases]) => [
    canonical,
    ...codes,
    ...aliases,
  ]);
  const before = keys.map((key) => languages.audioLanguage(key)?.id);
  assert.equal(languages.languageRegistryLoaded(), false);
  await languages.loadLanguageRegistry();
  assert.deepEqual(
    keys.map((key) => languages.audioLanguage(key)?.id),
    before,
  );
});

test("common languages resolve without the registry", async () => {
  const languages = await fresh();
  assert.equal(languages.audioLanguage("ger").id, "deu");
  assert.equal(languages.audioLanguageLabel("Englisch", "en"), "English");
  assert.equal(languages.audioLanguage("en_US").id, "eng");
  assert.equal(languages.audioLanguageList().length, 190);
  await drain();
  assert.equal(languages.languageRegistryLoaded(), false);
});

// The timeout turns a miss that never loads into a failure, not a hang.
test(
  "a miss loads the registry once and notifies",
  { timeout: 5000 },
  async () => {
    const languages = await fresh();
    let notified = 0;
    languages.onLanguageRegistry(() => notified++);
    const loaded = new Promise((resolve) =>
      languages.onLanguageRegistry(resolve),
    );
    assert.equal(languages.audioLanguage("aaa"), undefined);
    await loaded;
    assert.equal(languages.languageRegistryLoaded(), true);
    assert.equal(languages.audioLanguage("aaa").name, "Ghotuo");
    assert.equal(notified, 1);
    assert.ok(languages.audioLanguageList().length > 7900);

    // Further misses and explicit loads use the loaded registry.
    assert.equal(languages.audioLanguage("Klingonisch"), undefined);
    await languages.loadLanguageRegistry();
    await drain();
    assert.equal(notified, 1);
  },
);

test("a listener can unsubscribe", async () => {
  const languages = await fresh();
  let notified = 0;
  const stop = languages.onLanguageRegistry(() => notified++);
  stop();
  await languages.loadLanguageRegistry();
  assert.equal(notified, 0);
});

test("unknown values never load the registry", async () => {
  const languages = await fresh();
  for (const value of ["und", "", "unbekannt", "und-DE", "__unknown__"]) {
    assert.equal(languages.audioLanguage(value), undefined, value);
    assert.equal(languages.audioLanguageLabel(value, "en"), "Unknown", value);
  }
  await drain();
  assert.equal(languages.languageRegistryLoaded(), false);
});
