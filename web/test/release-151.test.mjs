import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LOG_PAGE_SIZE, eventQuery } from "../src/event-log.ts";

const src = (path) =>
  readFileSync(new URL("../src/" + path, import.meta.url), "utf8");

test("log pages request 25 rows and the third page starts at offset 50", () => {
  assert.equal(LOG_PAGE_SIZE, 25);
  const query = new URLSearchParams(eventQuery({}, null, 3));
  assert.equal(query.get("limit"), "25");
  assert.equal(query.get("offset"), "50");
});

test("Arr differences are muted information while measured conflicts retain the warning", () => {
  const code = src("components/FileDialog.tsx");
  assert.match(src("types.ts"), /apiDiffers\?: boolean/);
  assert.match(code, /e\.apiDiffers && !e\.conflict/);
  assert.match(code, /<Info[\s\S]*?size=\{ICON\.label\}/);
  assert.match(
    code,
    /<span\s+role="img"\s+title=\{t\([\s\S]*?aria-label=\{t\(/,
  );
  assert.match(code, /!e\.apiDiffers[\s\S]*e\.filename !== e\.api/);
  // The row's warning is a title mark of the v2 table (RowInfo before).
  const row = src("components/library/TitleMarks.tsx");
  assert.match(row, /file\.conflict/);
  assert.doesNotMatch(row, /apiDiffers/);
  assert.doesNotMatch(src("components/library/InfoButtons.tsx"), /apiDiffers/);
});

test("password fields open in a Modal with reset, autofocus and only external form controls", () => {
  const code = src("components/PasswordCard.tsx");
  assert.match(code, /<Modal[\s\S]*title=\{t\("Change password"\)\}/);
  assert.doesNotMatch(code, /<form/);
  assert.equal((code.match(/form="password-form"/g) || []).length, 3);
  assert.match(code, /autoFocus/);
  assert.match(
    code,
    /function close\(\)[\s\S]*setCurrent\(""\)[\s\S]*setPassword\(""\)/,
  );
  assert.match(code, /autoComplete="current-password"/);
  assert.match(code, /autoComplete="new-password"/);
  assert.match(code, /minLength=\{12\}/);
  assert.match(code, /disabled=\{demo\}/);
  assert.match(
    src("components/Modal.tsx"),
    /<button\s+type="button"[\s\S]*onClick=\{close\}/,
  );
});

test("all four locales explain measured disagreements and both Arr information cases", () => {
  const help =
    "The filename and the media server's measured metadata disagree on a known value. Radarr/Sonarr differences are shown in file details only. Excluding this finds files without that disagreement.";
  // The state field's help lives with the filter model (the 1.7.0 panel
  // held it inline).
  assert.ok(src("library-filters.ts").includes(help));
  for (const locale of ["en", "de", "es", "it"]) {
    const { messages } = JSON.parse(src("locales/" + locale + ".json"));
    for (const key of [
      help,
      "The file and media server agree. Radarr/Sonarr report a different value; shown for information only.",
      "Radarr/Sonarr report a different value; shown for information only.",
    ])
      assert.ok(messages[key], locale + ": " + key);
  }
});
