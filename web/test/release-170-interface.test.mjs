import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { cssRules } from "./helpers/css-rules.mjs";
const read = (name) =>
  readFileSync(new URL("../src/" + name, import.meta.url), "utf8");

test("filter panel padding never depends on collapsed state", () => {
  for (const name of ["library", "placement"]) {
    for (const rule of cssRules(read("styles/" + name + ".css"))) {
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
test("header is extracted and navigation counters cannot change button width", () => {
  assert.ok(
    existsSync(new URL("../src/components/AppHeader.tsx", import.meta.url)),
  );
  const rules = cssRules(read("styles/navigation.css"));
  assert.match(
    rules.find((r) => r.header === ".header").body,
    /grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/,
  );
  assert.match(
    rules.find((r) => r.header.includes(".nav-counter")).body,
    /position:\s*absolute/,
  );
  assert.match(
    read("components/NavMenu.tsx"),
    /class="filter-count nav-counter"/,
  );
});
test("state filter labels keep the operator beside the help icon", () => {
  const rule = cssRules(read("styles/library.css")).find(
    (r) => r.header === ".state-filter-label",
  );
  assert.doesNotMatch(rule.body, /flex:\s*1\s*;/);
  assert.match(rule.body, /gap:\s*var\(--space-2\)/);
});
test("phone library selection actions have count badges and complete accessible names", () => {
  const library = read("components/Library.tsx"),
    mux = read("components/MuxSelectionActions.tsx");
  assert.match(library, /library-results-heading/);
  assert.match(library, /selection-action-count/);
  assert.match(mux, /aria-label=\{markLabel\}/);
  assert.match(mux, /aria-label=\{removeLabel\}/);
  assert.match(mux, /selection-action-count/);
  const mobile = cssRules(read("styles/library.css")).filter((r) =>
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
test("demo library cache totals include disabled sample instances", () => {
  assert.match(
    read("components/Library.tsx"),
    /instancesOf\(settings, !status\.demo\)/,
  );
});
test("dead structural tokens are removed", () => {
  assert.doesNotMatch(
    read("styles/base.css"),
    /--layout-(10|21|46|53|59|64|68|80|88|96|150|170|440|520):/,
  );
});

test("header exposes the current page and forwards navigation actions", async () => {
  const { componentHarness, nodes, text } =
    await import("./helpers/component-harness.mjs");
  const instances = await import("../src/instances.ts");
  const selected = [];
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
    openDashboard: () => selected.push("statistics"),
    openLibrary: (type, instance) => selected.push([type, instance]),
    openSettings: () => selected.push("settings"),
    toggleTheme: () => selected.push("theme"),
    signOut: () => selected.push("logout"),
  };
  const h = componentHarness("AppHeader", props, {
    modules: { "../instances": instances, "./NavMenu": { NavMenu: "NavMenu" } },
  });
  let tree = h.render();
  const settings = nodes(tree).find(
    (n) => n.props?.["aria-label"] === "Settings",
  );
  assert.equal(settings.props["aria-current"], "page");
  assert.match(settings.props.class, /active/);
  assert.equal(
    nodes(tree).find((n) => n.type === "button" && text(n) === "Dashboard")
      .props["aria-current"],
    undefined,
  );
  assert.ok(
    nodes(tree)
      .filter((n) => n.type === "NavMenu")
      .every((n) => n.props.items.every((i) => !i.active)),
  );
  settings.props.onClick();
  props.page = "statistics";
  tree = h.render();
  const dashboard = nodes(tree).find(
    (n) => n.type === "button" && text(n) === "Dashboard",
  );
  assert.equal(dashboard.props["aria-current"], "page");
  dashboard.props.onClick();
  props.page = "library";
  tree = h.render();
  const movies = nodes(tree).find((n) => n.type === "NavMenu");
  assert.equal(movies.props.items[0].active, true);
  movies.props.items[0].select();
  assert.deepEqual(selected, ["settings", "statistics", ["radarr", ""]]);
});

test("compact mux actions announce complete localized counts without changing disabled rules", async () => {
  const { componentHarness, nodes, text } =
    await import("./helpers/component-harness.mjs");
  const selection = await import("../src/file-selection.ts");
  const muxSelection = await import("../src/mux-selection.ts");
  const ui = { ICON: { label: 15 }, count: (n) => String(n) };
  const h = componentHarness(
    "MuxSelectionActions",
    {
      files: [],
      jobs: [],
      installed: true,
      compact: true,
      changed: async () => {},
      busyChanged: () => {},
    },
    {
      modules: {
        "../ui": ui,
        "../api": {},
        "../confirmation": {},
        "../notifications": {},
        "../file-selection": selection,
        "../mux-selection": muxSelection,
      },
    },
  );
  const buttons = nodes(h.render()).filter((n) => n.type === "button");
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    assert.equal(button.props.disabled, true);
    assert.match(button.props["aria-label"], /\(0\)/);
    assert.ok(button.props.title.startsWith(button.props["aria-label"]));
    const badge = nodes(button).find(
      (n) => n.props?.class === "selection-action-count",
    );
    assert.equal(text(badge), "0");
    assert.equal(badge.props["aria-hidden"], "true");
  }
});

test("phone demo banner follows the measured header and badges clear compact navigation text", () => {
  const rules = cssRules(read("styles/responsive.css")).filter((r) =>
    r.context.includes("@media (max-width: 740px)"),
  );
  const banner = rules.find((r) => r.header === ".demo-bar");
  assert.match(banner.body, /position:\s*sticky/);
  assert.match(banner.body, /top:\s*var\(--app-header-height\)/);
  const header = cssRules(read("styles/navigation.css")).find(
    (r) => r.header === ".header",
  );
  assert.ok(
    Number(banner.body.match(/z-index:\s*(\d+)/)[1]) <
      Number(header.body.match(/z-index:\s*(\d+)/)[1]),
    "the demo banner must stay below header menus",
  );
  const badge = rules.find((r) => r.header.includes(".nav-counter"));
  assert.match(badge.body, /transform:\s*translateY\(-100%\)/);
  const coarse = cssRules(read("styles/base.css")).filter((r) =>
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
