// Legacy UI (1.7.0 look) – replaced in Phase 5c and 5d by the v2 settings card and dialog tests.
import test from "node:test";
import assert from "node:assert/strict";
import { cssRules, selectors } from "../helpers/css-rules.mjs";
import { legacyCss } from "../helpers/legacy-styles.mjs";
import { src } from "../helpers/sources.mjs";

const rule = (file, selector) =>
  cssRules(legacyCss(file)).find(
    (r) => !r.context.length && selectors(r.header).includes(selector),
  )?.body || "";

test("Arr differences are muted information while measured conflicts retain the warning (1.7.0 look)", () => {
  const code = src("components/FileDialog.tsx");
  assert.match(code, /class=\{e\.conflict \? "evidence-conflict" : ""\}/);
  assert.match(code, /class=\{[^}]*"ordered-label evidence-api-info"/);
  assert.match(
    rule("dialogs.css", ".evidence-api-info"),
    /color:\s*var\(--muted\)/,
  );
  assert.match(
    rule("dialogs.css", ".evidence-api-info svg"),
    /vertical-align:\s*middle/,
  );
});

test("password fields open in a Modal with reset, autofocus and only external form controls (1.7.0 look)", () => {
  const code = src("components/PasswordCard.tsx");
  assert.match(
    code,
    /<div class="modal-actions">[\s\S]*t\("Cancel"\)[\s\S]*class="primary"/,
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
    legacyCss("settings-and-filters.css"),
    /\.password-card-fields/,
  );
  assert.match(
    rule("dialogs.css", ".password-dialog-fields"),
    /display:\s*grid/,
  );
});
