// Legacy UI (1.7.0 look) – replaced in Phase 5d by the v2 stylesheet guards (stylesheet-guards.test.mjs); deleted with the last 1.7.0 stylesheet.
import test from "node:test";
import assert from "node:assert/strict";
import { cssRules, selectors } from "../helpers/css-rules.mjs";
import { LEGACY_STYLESHEETS, legacyCss } from "../helpers/legacy-styles.mjs";

// Media queries may adapt a component at a breakpoint. Base recipes have one
// owner, so importing another area cannot silently reverse their cascade.
const exceptions = new Map();
test("each non-media selector belongs to one stylesheet", () => {
  const owners = new Map();
  for (const file of LEGACY_STYLESHEETS) {
    const source = legacyCss(file);
    for (const rule of cssRules(source).filter(
      (r) => !r.context.some((c) => c.startsWith("@media")),
    )) {
      for (const selector of selectors(rule.header)) {
        const files = owners.get(selector) || new Set();
        files.add(file);
        owners.set(selector, files);
      }
    }
  }
  const duplicates = [...owners]
    .filter(([s, files]) => files.size > 1 && !exceptions.has(s))
    .map(([s, files]) => `${s}: ${[...files].join(", ")}`);
  assert.deepEqual(duplicates, [], "Shared recipes must have one owner");
  for (const [selector, reason] of exceptions) {
    assert.ok(reason.length > 20, selector + " needs a justification");
    assert.ok(
      owners.get(selector)?.size > 1,
      "Remove obsolete exception " + selector,
    );
  }
});

test("viewport breakpoints share the documented thresholds without duplicate blocks", () => {
  for (const file of LEGACY_STYLESHEETS) {
    const source = legacyCss(file),
      seen = new Set();
    for (const [, kind, width] of source.matchAll(
      /@media\s*\((max|min)-width:\s*(\d+)px\)/g,
    )) {
      const key = kind + width;
      assert.ok(!seen.has(key), file + ": duplicate " + key);
      seen.add(key);
      assert.ok(
        kind === "min"
          ? ["1120", "1440", "1600"].includes(width)
          : ["1120", "900", "740", "600"].includes(width),
        file + ": undocumented " + key,
      );
    }
  }
});

// Base form resets and the shared button geometry intentionally participate in
// several reset groups; merging these would duplicate their shared declarations.
const resetGroups = new Set([
  "button",
  "input",
  "select",
  "a",
  ".primary",
  ".button",
]);
test("each non-media selector has only one rule in its stylesheet", () => {
  for (const file of LEGACY_STYLESHEETS) {
    const seen = new Set(),
      duplicates = new Set();
    for (const rule of cssRules(legacyCss(file)).filter(
      (r) =>
        !r.context.some((c) => c.startsWith("@media") || /keyframes/.test(c)),
    )) {
      for (const selector of selectors(rule.header)) {
        if (
          seen.has(selector) &&
          !(file === "base.css" && resetGroups.has(selector))
        )
          duplicates.add(selector);
        seen.add(selector);
      }
    }
    assert.deepEqual(
      [...duplicates],
      [],
      file + ": consolidate duplicate selectors while preserving their cascade",
    );
  }
});
