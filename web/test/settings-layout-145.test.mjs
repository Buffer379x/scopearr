import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cssRules, selectors } from "./helpers/css-rules.mjs";
const settingsCSS = () =>
  cssRules(
    readFileSync(
      new URL("../src/styles/settings-and-filters.css", import.meta.url),
      "utf8",
    ),
  );
test("service synchronization fields use equal halves like address and API key", () => {
  const rules = settingsCSS().filter((rule) =>
    selectors(rule.header).includes(".sync-clock-grid"),
  );
  assert.ok(rules.length);
  const last = rules
    .filter((rule) => /grid-template-columns/.test(rule.body))
    .at(-1);
  assert.match(
    last.body,
    /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  );
});
test("settings titles reserve the save control height even without an action", () => {
  const rule = settingsCSS().find((rule) =>
    selectors(rule.header).includes(".settings-section-heading h2"),
  );
  assert.match(rule.body, /min-height:\s*var\(--control-md\)/);
  assert.match(rule.body, /align-items:\s*center/);
});
