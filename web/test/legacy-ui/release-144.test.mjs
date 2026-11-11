// Legacy UI (1.7.0 look) – replaced in Phase 5b and 5c by the v2 tool page and settings recipe tests.
import test from "node:test";
import assert from "node:assert/strict";
import { src } from "../helpers/sources.mjs";
import { legacyCss } from "../helpers/legacy-styles.mjs";

test("tool pages render no result-dependent box between filters and results (1.7.0 look)", () => {
  for (const page of ["DiskPlacementPage", "FileCheckPage"]) {
    const code = src("components/" + page + ".tsx");
    const end = code.indexOf('<section class="library-section">');
    assert.ok(end > 0, "library-section");
    const sectionEnd = code.lastIndexOf("</section>", end);
    assert.ok(sectionEnd >= 0, "preceding </section>");
    const flow = code.slice(sectionEnd, end);
    assert.doesNotMatch(flow, /class="notice"/);
    assert.match(code, /notification-dot/);
  }
});

test("tool pages share one rhythm and card titles align", () => {
  for (const page of ["DiskPlacementPage", "FileCheckPage"])
    assert.doesNotMatch(src("components/" + page + ".tsx"), /control-lg/);
  // Muxing's setup notice is the v2 SetupNotice since Phase 5b.
  const library = legacyCss("library.css");
  assert.match(
    library,
    /\.results-heading \{[^}]*min-height: var\(--control-md\)/,
  );
  assert.match(library, /\.page-notice \{\s*margin: 0 0 var\(--space-6\)/);
  assert.match(
    library,
    /\.filter-always-visible \.preset-toolbar select \{[^}]*width: var\(--layout-200\)/,
  );
  assert.match(library, /\.results-tools \{[^}]*gap: var\(--space-2\)/);
  assert.match(
    legacyCss("base.css"),
    /\.card-heading \{[^}]*min-height: var\(--control-md\)/,
  );
  assert.match(
    legacyCss("settings-and-filters.css"),
    /\.settings-content \.card-title \{[^}]*min-height: var\(--control-md\)/,
  );
});
