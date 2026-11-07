import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

// Tests that pin the 1.7.0 look live in legacy-ui/ until the phase that
// replaces their area deletes them; everything else tests behavior.
const testDir = new URL("./", import.meta.url);
const legacyDir = new URL("./legacy-ui/", import.meta.url);
const read = (url) => readFileSync(url, "utf8");
const testFiles = (dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort();
const self = new URL(import.meta.url).pathname.split("/").at(-1);
const readsStylesheets = (code) =>
  /styles\/|\.css\b|css-rules|legacy-styles|legacyCss|LEGACY_STYLESHEETS/.test(
    code,
  );

test("only listed tests read stylesheets", () => {
  const allowed = [
    "contrast.test.mjs",
    "stylesheet-guards.test.mjs",
    "themes.test.mjs",
  ];
  const readers = testFiles(testDir).filter(
    (name) => name !== self && readsStylesheets(read(new URL(name, testDir))),
  );
  assert.deepEqual(
    readers.filter((name) => !allowed.includes(name)),
    [],
    "move 1.7.0 appearance tests to legacy-ui/",
  );
  assert.ok(readers.includes("themes.test.mjs"), "the check finds readers");
});

// Helpers count too, so a test cannot read stylesheets through a helper
// that the check above does not see. Exemptions: legacy-styles.mjs is the
// one reader of the 1.7.0 sheets, and every test that imports it is found
// above by name; color.mjs parses CSS text that its caller passes in
// (through css-rules.mjs) and reads no file itself.
test("only listed helpers read stylesheets", () => {
  const helperDir = new URL("./helpers/", testDir);
  const helpers = readdirSync(helperDir)
    .filter((name) => name.endsWith(".mjs"))
    .sort();
  assert.ok(helpers.includes("legacy-styles.mjs"), "reads helpers/");
  const readers = helpers.filter((name) =>
    readsStylesheets(read(new URL(name, helperDir))),
  );
  assert.deepEqual(readers, ["color.mjs", "legacy-styles.mjs"]);
  assert.doesNotMatch(
    read(new URL("color.mjs", helperDir)),
    /node:fs|readFileSync|readdirSync/,
    "color.mjs reads no file",
  );
  // As for legacy UI tests: only the fixed list names a path into styles/.
  for (const name of helpers.filter((n) => n !== "legacy-styles.mjs"))
    assert.doesNotMatch(read(new URL(name, helperDir)), /["'`/]styles\b/, name);
});

test("legacy UI tests name their replacement", () => {
  assert.ok(existsSync(legacyDir), "legacy-ui/ exists");
  const files = testFiles(legacyDir);
  assert.ok(files.length > 0, "legacy-ui/ holds tests");
  for (const name of files)
    assert.match(
      read(new URL(name, legacyDir)).split("\n")[0],
      /^\/\/ Legacy UI \(1\.7\.0 look\) – replaced in Phase (?:4|5[a-d])(?:(?:, | and )(?:4|5[a-d]))* by \S/,
      name,
    );
});

test("legacy UI tests read stylesheets only through LEGACY_STYLESHEETS", () => {
  const helper = read(new URL("./helpers/legacy-styles.mjs", testDir));
  assert.doesNotMatch(helper, /readdirSync/);
  assert.match(helper, /export const LEGACY_STYLESHEETS = /);
  for (const name of testFiles(legacyDir)) {
    const code = read(new URL(name, legacyDir));
    // No path into styles/ (and so no readdirSync on it): every sheet comes
    // from the fixed list.
    assert.doesNotMatch(code, /["'`/]styles\b/, name);
    if (readsStylesheets(code))
      assert.match(code, /from "\.\.\/helpers\/legacy-styles\.mjs"/, name);
  }
});

test("the test script runs the legacy UI tests", () => {
  const { scripts } = JSON.parse(read(new URL("../package.json", testDir)));
  assert.equal(
    scripts.test,
    "node --test test/*.test.mjs test/legacy-ui/*.test.mjs",
  );
});
