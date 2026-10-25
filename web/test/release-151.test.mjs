import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LOG_PAGE_SIZE, eventQuery } from "../src/event-log.ts";
import { cssRules, selectors } from "./helpers/css-rules.mjs";

const src = (path) =>
  readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
const rule = (file, selector) =>
  cssRules(src("styles/" + file)).find(
    (r) => !r.context.length && selectors(r.header).includes(selector),
  )?.body || "";

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
  assert.match(code, /class=\{e\.conflict \? "evidence-conflict" : ""\}/);
  assert.match(code, /class=\{[^}]*"ordered-label evidence-api-info"/);
  assert.match(code, /<Info[\s\S]*?size=\{ICON\.label\}/);
  assert.match(
    code,
    /<span\s+role="img"\s+title=\{t\([\s\S]*?aria-label=\{t\(/,
  );
  assert.match(code, /!e\.apiDiffers[\s\S]*e\.filename !== e\.api/);
  const row = src("components/RowInfo.tsx");
  assert.match(row, /file\.conflict/);
  assert.doesNotMatch(row, /apiDiffers/);
  assert.match(
    rule("dialogs.css", ".evidence-api-info"),
    /color:\s*var\(--muted\)/,
  );
  assert.match(
    rule("dialogs.css", ".evidence-api-info svg"),
    /vertical-align:\s*middle/,
  );
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
  assert.match(
    code,
    /<div class="modal-actions">[\s\S]*t\("Cancel"\)[\s\S]*class="primary"/,
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

test("System cards stretch equally and password field styling belongs to dialogs", () => {
  assert.match(
    rule("settings-and-filters.css", ".system-overview"),
    /align-items:\s*stretch/,
  );
  const cards = rule(
    "settings-and-filters.css",
    ".system-overview .settings-card",
  );
  assert.match(cards, /display:\s*flex/);
  assert.match(cards, /flex-direction:\s*column/);
  const heading = rule(
    "settings-and-filters.css",
    ".system-overview .card-heading",
  );
  assert.match(heading, /flex-wrap:\s*wrap/);
  assert.match(heading, /row-gap:\s*var\(--space-2\)/);
  assert.doesNotMatch(
    src("styles/settings-and-filters.css"),
    /\.password-card-fields/,
  );
  assert.match(
    rule("dialogs.css", ".password-dialog-fields"),
    /display:\s*grid/,
  );
});

test("all four locales explain measured disagreements and both Arr information cases", () => {
  const help =
    "The filename and the media server's measured metadata disagree on a known value. Radarr/Sonarr differences are shown in file details only. Excluding this finds files without that disagreement.";
  assert.ok(src("components/FilterPanel.tsx").includes(help));
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
