// Legacy UI (1.7.0 look) – replaced in Phase 4, 5a, 5b and 5d by the v2 shell, library, mux selection and token tests.
import test from "node:test";
import assert from "node:assert/strict";
import { cssRules } from "../helpers/css-rules.mjs";
import { legacyCss } from "../helpers/legacy-styles.mjs";
import { src } from "../helpers/sources.mjs";

test("filter panel padding never depends on collapsed state", () => {
  for (const name of ["library", "placement"]) {
    for (const rule of cssRules(legacyCss(name + ".css"))) {
      if (
        /\.(?:filter-panel(?:-v2)?|placement-panel)[^ ,]*\.collapsed|\.placement-panel:not\(\.collapsed\)/.test(
          rule.header,
        ) &&
        !/[ >]/.test(rule.header)
      )
        assert.doesNotMatch(
          rule.body,
          /(?:^|;)\s*padding(?:-[\w-]+)?\s*:/,
          rule.header,
        );
    }
  }
});
test("header is extracted and navigation counters cannot change button width (1.7.0 look)", () => {
  const rules = cssRules(legacyCss("navigation.css"));
  assert.match(
    rules.find((r) => r.header === ".header").body,
    /grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/,
  );
  assert.match(
    rules.find((r) => r.header.includes(".nav-counter")).body,
    /position:\s*absolute/,
  );
  assert.match(
    src("components/NavMenu.tsx"),
    /class="filter-count nav-counter"/,
  );
});
test("state filter labels keep the operator beside the help icon", () => {
  const rule = cssRules(legacyCss("library.css")).find(
    (r) => r.header === ".state-filter-label",
  );
  assert.doesNotMatch(rule.body, /flex:\s*1\s*;/);
  assert.match(rule.body, /gap:\s*var\(--space-2\)/);
});
test("phone library selection actions have count badges and complete accessible names (1.7.0 look)", () => {
  const library = src("components/LibraryPage.tsx"),
    mux = src("components/MuxSelectionActions.tsx");
  assert.match(library, /library-results-heading/);
  assert.match(library, /selection-action-count/);
  assert.match(mux, /selection-action-count/);
  const mobile = cssRules(legacyCss("library.css")).filter((r) =>
    r.context.includes("@media (max-width: 600px)"),
  );
  assert.ok(
    mobile.some(
      (r) =>
        r.header.includes(".library-results-heading") &&
        /flex-direction:\s*row/.test(r.body),
    ),
  );
});
test("dead structural tokens are removed", () => {
  assert.doesNotMatch(
    legacyCss("base.css"),
    /--layout-(10|21|46|53|59|64|68|80|88|96|150|170|440|520):/,
  );
});

test("header exposes the current page and forwards navigation actions (1.7.0 look)", async () => {
  const { componentHarness, loadSource, nodes } =
    await import("../helpers/component-harness.mjs");
  const instances = await import("../../src/instances.ts");
  const props = {
    page: "settings",
    service: "radarr",
    settings: {
      instances: [
        { id: "radarr", type: "radarr", enabled: true, name: "Movies" },
      ],
    },
    filters: { radarr: "", sonarr: "" },
    toolItems: [],
    theme: "dark",
    openLink() {},
    openSettings() {},
    toggleTheme() {},
    signOut() {},
  };
  const h = componentHarness("AppHeader", props, {
    modules: {
      "../instances": instances,
      "../nav-link": loadSource("nav-link.ts"),
      "./NavMenu": { NavMenu: "NavMenu" },
    },
  });
  const settings = nodes(h.render()).find(
    (n) => n.props?.["aria-label"] === "Settings",
  );
  assert.match(settings.props.class, /active/);
});

test("a plain click on the brand opens the dashboard in the app (1.7.0 look)", async () => {
  const { componentHarness, loadSource, nodes } =
    await import("../helpers/component-harness.mjs");
  const instances = await import("../../src/instances.ts");
  const h = componentHarness(
    "AppHeader",
    {
      page: "library",
      service: "radarr",
      settings: { instances: [] },
      filters: { radarr: "", sonarr: "" },
      toolItems: [],
      theme: "dark",
      openLink() {},
      openSettings() {},
      toggleTheme() {},
      signOut() {},
    },
    {
      modules: {
        "../instances": instances,
        "../nav-link": loadSource("nav-link.ts"),
        "./NavMenu": { NavMenu: "NavMenu" },
      },
    },
  );
  const brand = nodes(h.render()).find((n) => n.type === "a");
  assert.equal(brand.props.class, "brand");
});

test("phone demo banner follows the measured header and badges clear compact navigation text", () => {
  const rules = cssRules(legacyCss("responsive.css")).filter((r) =>
    r.context.includes("@media (max-width: 740px)"),
  );
  const banner = rules.find((r) => r.header === ".demo-bar");
  assert.match(banner.body, /position:\s*sticky/);
  assert.match(banner.body, /top:\s*var\(--app-header-height\)/);
  const header = cssRules(legacyCss("navigation.css")).find(
    (r) => r.header === ".header",
  );
  assert.ok(
    Number(banner.body.match(/z-index:\s*(\d+)/)[1]) <
      Number(header.body.match(/z-index:\s*(\d+)/)[1]),
    "the demo banner must stay below header menus",
  );
  const badge = rules.find((r) => r.header.includes(".nav-counter"));
  assert.match(badge.body, /transform:\s*translateY\(-100%\)/);
  const coarse = cssRules(legacyCss("base.css")).filter((r) =>
    r.context.includes("@media (pointer: coarse)"),
  );
  assert.ok(
    coarse.some(
      (r) =>
        r.header.includes(".compact-selection-action::after") &&
        /width:\s*var\(--touch-target\)/.test(r.body),
    ),
  );
});
