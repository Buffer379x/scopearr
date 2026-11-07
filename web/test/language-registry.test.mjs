import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSource } from "./helpers/component-harness.mjs";
import { src, squash } from "./helpers/sources.mjs";

// The interface ships the ISO 639-1 core of the language registry and loads
// the full registry (about 8000 rows) only when a value misses the core.
const registryUrl = new URL(
  "../../internal/langdata/registry.json",
  import.meta.url,
);
const registry = JSON.parse(readFileSync(registryUrl, "utf8"));
const coreUrl = new URL("../src/language-core.json", import.meta.url);
const special = ["mis", "mul", "und", "zxx"];

// A load that never comes fails its test instead of hanging the run.
const timed = { timeout: 10_000 };

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

// languages.ts with a controlled registry import and clock. Each call of
// importLanguageRegistry is recorded and settles when the test says so.
function controlled() {
  const core = JSON.parse(readFileSync(coreUrl, "utf8"));
  const imports = [];
  const clock = { now: 0 };
  const languages = loadSource("languages.ts", {
    modules: {
      "./language-core.json": { default: core },
      "./language-registry.ts": {
        importLanguageRegistry: () =>
          new Promise((resolve, reject) => imports.push({ resolve, reject })),
      },
    },
    browser: { Date: { now: () => clock.now } },
  });
  return { languages, imports, clock };
}
const turn = () => new Promise((resolve) => setImmediate(resolve));

// Every key of the full registry: the core either names the language the
// full registry names or reports a miss (starts the load), so a later load
// never changes a label or flag already shown. A regional fallback such as
// "oji-cree" (core: oji, registry: ojs) is such a miss.
test(
  "core lookups agree with the full registry or load it",
  timed,
  async () => {
    const keys = [
      ...new Set(
        registry.flatMap(([, , , canonical, codes, aliases]) => [
          canonical,
          ...codes,
          ...aliases,
        ]),
      ),
    ];
    const full = await fresh();
    await full.loadLanguageRegistry();
    const { languages, imports, clock } = controlled();
    const disagree = [];
    let misses = 0;
    for (const key of keys) {
      const started = imports.length;
      const core = languages.audioLanguage(key)?.id;
      if (imports.length > started) {
        misses++;
        // Fail the load and pass its wait, so the next miss shows again.
        imports.at(-1).reject(new Error("offline"));
        await turn();
        clock.now += 10 * 60_000;
      } else if (core !== full.audioLanguage(key)?.id) disagree.push(key);
    }
    assert.deepEqual(disagree, []);
    assert.ok(misses > 7000, String(misses));
    for (const key of ["oji-cree", "lo-toga", "aka-bo"]) {
      const started = imports.length;
      languages.audioLanguage(key);
      assert.equal(imports.length, started + 1, key);
      imports.at(-1).reject(new Error("offline"));
      await turn();
      clock.now += 10 * 60_000;
    }
  },
);

// After a failure no new import starts for 30 s; each further failure
// doubles the wait up to 480 s. A success clears it.
test("a failed load waits before the next attempt", timed, async () => {
  const { languages, imports, clock } = controlled();
  const attempts = () => imports.length;
  let notified = 0;
  languages.onLanguageRegistry(() => notified++);
  languages.audioLanguage("aaa");
  languages.audioLanguage("aab");
  assert.equal(attempts(), 1, "one import while it runs");
  for (const wait of [30, 60, 120, 240, 480, 480]) {
    imports.at(-1).reject(new Error("404"));
    await turn();
    const before = attempts();
    clock.now += wait * 1000 - 1;
    languages.audioLanguage("aaa");
    languages.audioLanguage("oji-cree");
    void languages.loadLanguageRegistry();
    assert.equal(attempts(), before, `no import inside ${wait} s`);
    clock.now += 1;
    languages.audioLanguage("aaa");
    languages.audioLanguage("aab");
    assert.equal(attempts(), before + 1, `one import after ${wait} s`);
  }
  imports.at(-1).resolve({ default: registry });
  await turn();
  assert.equal(languages.languageRegistryLoaded(), true);
  assert.equal(languages.audioLanguage("aaa").name, "Ghotuo");
  assert.equal(notified, 1);
  const before = attempts();
  languages.audioLanguage("Klingonisch");
  void languages.loadLanguageRegistry();
  assert.equal(attempts(), before);
});

// Vite's preload helper wraps the expression it finds at import(). With a
// .then chain inside, the chain would handle a failed chunk load before the
// helper sees it, and preload-recovery.ts would never reload an old tab.
test("the registry import stands alone", () => {
  assert.match(
    squash(src("language-registry.ts")),
    /return import\(\s*"\.\.\/\.\.\/internal\/langdata\/registry\.json", \{ with: \{ type: "json" \},?\s*\},?\s*\);/,
  );
  assert.ok(!src("languages.ts").includes("import("), "languages.ts");
});

test("common languages resolve without the registry", timed, async () => {
  const languages = await fresh();
  assert.equal(languages.audioLanguage("ger").id, "deu");
  assert.equal(languages.audioLanguageLabel("Englisch", "en"), "English");
  assert.equal(languages.audioLanguageList().length, 190);
  await drain();
  assert.equal(languages.languageRegistryLoaded(), false);
});

// A regional tag resolves through its language at once and still asks the
// full registry, which may know the whole tag as a language of its own.
test(
  "a regional fallback answers until the registry decides",
  timed,
  async () => {
    const languages = await fresh();
    const loaded = new Promise((resolve) =>
      languages.onLanguageRegistry(resolve),
    );
    assert.equal(languages.audioLanguage("en_US").id, "eng");
    assert.equal(languages.audioLanguage("oji-cree").id, "oji");
    await loaded;
    assert.equal(languages.audioLanguage("en_US").id, "eng");
    assert.equal(languages.audioLanguage("oji-cree").id, "ojs");
  },
);

test("a miss loads the registry once and notifies", timed, async () => {
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
});

test("a listener can unsubscribe", timed, async () => {
  const languages = await fresh();
  let notified = 0;
  const stop = languages.onLanguageRegistry(() => notified++);
  stop();
  await languages.loadLanguageRegistry();
  assert.equal(notified, 0);
});

test("unknown values never load the registry", timed, async () => {
  const languages = await fresh();
  for (const value of ["und", "", "unbekannt", "und-DE", "__unknown__"]) {
    assert.equal(languages.audioLanguage(value), undefined, value);
    assert.equal(languages.audioLanguageLabel(value, "en"), "Unknown", value);
  }
  await drain();
  assert.equal(languages.languageRegistryLoaded(), false);
});
