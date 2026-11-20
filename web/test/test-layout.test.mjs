import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Tests test behavior; only the listed tests read stylesheets. The 1.7.0
// look tests of legacy-ui/ left with the last 1.7.0 stylesheets (Phase 5d,
// Task 13), each replaced by a named v2 test.
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
    "a test that reads stylesheets is listed",
  );
  assert.ok(readers.includes("themes.test.mjs"), "the check finds readers");
});

// Every file below a folder URL (ending in "/"), in any subfolder and with
// any extension, as "/"-separated paths relative to it.
const filesUnder = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(fileURLToPath(dir).length)
        .split(sep)
        .join("/"),
    )
    .sort();
// File access in a helper: an fs module in any form, or a reading call.
const FILE_ACCESS =
  /node:fs|["']fs(?:\/promises)?["']|\b(?:readFile|readdir|opendir)(?:Sync)?\b|\b(?:createReadStream|openSync)\b/;

// Helpers count too, so a test cannot read stylesheets through a helper
// that the check above does not see. The exemption: color.mjs parses CSS
// text that its caller passes in (through css-rules.mjs) and reads no file
// itself. Every file below helpers/ counts, in any folder and with any
// extension.
test("only listed helpers read stylesheets", () => {
  const sample = mkdtempSync(join(tmpdir(), "scopearr-helpers-"));
  try {
    mkdirSync(join(sample, "sub", "deeper"), { recursive: true });
    for (const path of ["a.mjs", "sub/b.js", "sub/deeper/c.json"])
      writeFileSync(join(sample, path), "");
    assert.deepEqual(filesUnder(pathToFileURL(sample + "/")), [
      "a.mjs",
      "sub/b.js",
      "sub/deeper/c.json",
    ]);
  } finally {
    rmSync(sample, { recursive: true, force: true });
  }

  for (const probe of [
    'import { readFileSync } from "fs";',
    'import { readFile } from "node:fs/promises";',
    'const fs = require("fs");',
    'const fs = await import("node:fs");',
    "const text = await readFile(url);",
    "createReadStream(url).pipe(out);",
    "const fd = openSync(path);",
    "readdirSync(dir);",
  ])
    assert.match(probe, FILE_ACCESS, probe);
  for (const probe of [
    'import { cssRules } from "./css-rules.mjs";',
    'const offsets = "fs-sm"; // reads the text it is given',
  ])
    assert.doesNotMatch(probe, FILE_ACCESS, probe);

  const helperDir = new URL("./helpers/", testDir);
  const helpers = filesUnder(helperDir);
  assert.ok(helpers.includes("css-rules.mjs"), "reads helpers/");
  assert.ok(!helpers.includes("legacy-styles.mjs"), "legacy-styles.mjs left");
  const readers = helpers.filter((name) =>
    readsStylesheets(read(new URL(name, helperDir))),
  );
  assert.deepEqual(readers, ["color.mjs"]);
  assert.doesNotMatch(
    read(new URL("color.mjs", helperDir)),
    FILE_ACCESS,
    "color.mjs reads no file",
  );
  // No helper names a path into styles/.
  for (const name of helpers)
    assert.doesNotMatch(read(new URL(name, helperDir)), /["'`/]styles\b/, name);
});

// The 1.7.0 look tests left with the last 1.7.0 stylesheets (Phase 5d,
// Task 13): no legacy-ui/ folder and no test under any other folder.
test("no legacy UI test is left", () => {
  assert.ok(!existsSync(legacyDir), "legacy-ui/ is left");
  const folders = readdirSync(testDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(folders, ["goldens", "helpers"]);
  for (const folder of folders)
    assert.deepEqual(
      testFiles(new URL(folder + "/", testDir)),
      [],
      folder + "/ holds no test",
    );
  assert.ok(testFiles(testDir).length > 100, "the tests live in test/");
  // No test reads a 1.7.0 sheet through the retired helper any more.
  const helperUsers = testFiles(testDir).filter(
    (name) =>
      name !== self &&
      /legacy-styles|LEGACY_STYLESHEETS|legacyCss/.test(
        read(new URL(name, testDir)),
      ),
  );
  assert.deepEqual(helperUsers, ["stylesheet-guards.test.mjs"]);
  assert.doesNotMatch(
    read(new URL("stylesheet-guards.test.mjs", testDir)),
    /from "\.\/helpers\/legacy-styles\.mjs"/,
  );
});

test("the test script runs the tests", () => {
  const { scripts } = JSON.parse(read(new URL("../package.json", testDir)));
  assert.equal(scripts.test, "node --test test/*.test.mjs");
});
