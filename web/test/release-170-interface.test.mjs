import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const read = (name) =>
  readFileSync(new URL("../src/" + name, import.meta.url), "utf8");
// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));

test("the frame replaces the header", () => {
  const exists = (path) =>
    existsSync(new URL("../src/" + path, import.meta.url));
  for (const gone of ["components/AppHeader.tsx", "components/NavMenu.tsx"])
    assert.equal(exists(gone), false, gone);
  for (const part of ["Sidebar", "Topbar", "TabBar", "Popover", "SyncStatus"])
    assert.ok(exists("components/frame/" + part + ".tsx"), part);
  const shell = read("components/AppShell.tsx");
  for (const part of ["Sidebar", "Topbar", "TabBar"])
    assert.match(shell, new RegExp("<" + part + "\\b"), part);
  assert.doesNotMatch(shell, /AppHeader|NavMenu|demo-bar|toolItems/);
});
test("phone library selection actions have count badges and complete accessible names", () => {
  // The mux page's tools (Phase 5b) are count tools, named by what they
  // show (CountTool: label and count), as the library's selection tools;
  // mux-page.test.mjs renders them.
  const mux = read("components/MuxPage.tsx");
  assert.match(mux, /<CountTool\s[\s\S]{0,400}?text=\{t\("Start selected"\)\}/);
  assert.match(
    mux,
    /<CountTool\s[\s\S]{0,400}?text=\{t\("Remove mux marking \(\{count\}\)"\)\}/,
  );
});
test("demo library cache totals include disabled sample instances", () => {
  assert.match(
    read("hooks/useLibraryState.ts"),
    /instancesOf\(settings, !status\.demo\)/,
  );
});

// The sidebar of the frame with the real nav model; NavLink and BrandMark
// are stubbed presentation modules, so their props show.
async function frameSidebar() {
  const { componentHarness, loadSource } =
    await import("./helpers/component-harness.mjs");
  const { createHookRuntime } = await import("./helpers/hook-runtime.mjs");
  const storage = loadSource("browser-storage.ts");
  const toolRoute = loadSource("tool-route.ts", {
    modules: { "./browser-storage": storage },
  });
  const instances = loadSource("instances.ts");
  const router = loadSource("router.ts", {
    modules: {
      "./event-log": loadSource("event-log.ts"),
      "./tool-route": toolRoute,
    },
  });
  const navModel = loadSource("nav-model.ts", {
    modules: {
      "./instances": instances,
      "./frame-status": loadSource("frame-status.ts", {
        modules: {
          "./instances": instances,
          "./tool-route": toolRoute,
          "./tool-table": loadSource("tool-table.ts"),
          "./mux-spec": loadSource("mux-spec.ts", {
            modules: { "./languages.ts": { audioLanguage: () => "" } },
          }),
          "./placement": loadSource("placement.ts"),
          "./filecheck": loadSource("filecheck.ts"),
        },
      }),
      "./router": router,
      "./tool-route": toolRoute,
    },
  });
  const opened = [];
  const listeners = { addEventListener() {}, removeEventListener() {} };
  return {
    opened,
    render(hash, groups = { movies: true, series: true, settings: true }) {
      const runtime = createHookRuntime();
      const harness = componentHarness(
        "frame/Sidebar",
        {
          mode: "expanded",
          sections: navModel.navModel({
            route: router.parseRoute(hash),
            settings: {
              instances: [
                {
                  id: "radarr",
                  type: "radarr",
                  enabled: true,
                  name: "Movies",
                },
              ],
            },
            status: { demo: false, sync: {} },
            translate: (key) => key,
          }),
          groups,
          toggleGroup() {},
          toggleMode() {},
          drawerOpen: false,
          closeDrawer() {},
          // linkHref for the dashboard; other targets by their view.
          hrefOf: (target) =>
            target.view === "statistics"
              ? router.formatRoute({ view: "statistics" })
              : "#/" + target.view,
          open: (target) => opened.push(plain(target)),
          version: "2.0.0",
        },
        {
          exportName: "Sidebar",
          modules: {
            "preact/hooks": runtime.hooks,
            "../../i18n": { t: (key) => key },
            "../../ui": { ICON: { button: 16, label: 15 }, count: String },
            "../../flyout": loadSource("flyout.ts"),
            "../../notifications": loadSource("notifications.ts"),
            "./SidebarFlyout": {
              SidebarFlyout: "SidebarFlyout",
              FLYOUT_ID: "v2-fly",
            },
          },
          browser: { window: listeners, document: listeners },
        },
      );
      return runtime.settle(harness.render);
    },
  };
}

test("the frame marks the current page and forwards navigation actions", async () => {
  const { nodes, text } = await import("./helpers/component-harness.mjs");
  const frame = await frameSidebar();
  const entry = (tree, name) =>
    nodes(tree).find(
      (n) =>
        (n.type === "NavLink" || n.type === "button") &&
        nodes(n.props.children).some(
          (child) =>
            String(child.props?.class).includes("v2-nav-text") &&
            text(child) === name,
        ),
    );
  // Settings: its group is the parent of the shown area; no other page is
  // current.
  let tree = frame.render("#/settings/connections");
  const settings = entry(tree, "Settings");
  assert.equal(settings.props["data-parent"], "");
  assert.equal(entry(tree, "Dashboard").props.current, false);
  assert.ok(
    ["Movies", "TV series"].every((name) => !entry(tree, name).props.current),
  );
  const services = entry(tree, "Services");
  assert.equal(services.props.current, true);
  services.props.open();
  tree = frame.render("#/dashboard");
  const dashboard = entry(tree, "Dashboard");
  assert.equal(dashboard.props.current, true);
  dashboard.props.open();
  tree = frame.render("#/movies");
  const movies = entry(tree, "Movies");
  assert.equal(movies.props.current, true);
  movies.props.open();
  assert.deepEqual(frame.opened, [
    { view: "settings", section: "connections" },
    { view: "statistics" },
    { view: "library", service: "radarr", instance: "" },
  ]);
});

test("a plain click on the sidebar brand opens the dashboard in the app", async () => {
  const { loadSource, nodes } = await import("./helpers/component-harness.mjs");
  const frame = await frameSidebar();
  const brand = nodes(frame.render("#/movies")).find(
    (n) => n.type === "NavLink" && n.props.class === "v2-brand-home",
  );
  // The markup is the frame's link to the dashboard route.
  assert.equal(brand.props.href, "#/dashboard");
  assert.equal(brand.props.label, "Scopearr home");
  const link = loadSource("components/frame/NavLink.tsx", {
    modules: { "../../nav-link": loadSource("nav-link.ts") },
  }).NavLink(brand.props);
  assert.deepEqual(Object.keys(link.props).sort(), [
    "aria-current",
    "aria-label",
    "children",
    "class",
    "href",
    "onClick",
    "title",
  ]);
  const click = (event = {}) => {
    const prevented = [];
    link.props.onClick({
      button: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...event,
      preventDefault: () => prevented.push(true),
    });
    return prevented.length;
  };
  // Modified and other-button clicks keep the browser's link (a new tab or
  // window loads the dashboard route there).
  for (const event of [
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ]) {
    assert.equal(click(event), 0, JSON.stringify(event));
    assert.deepEqual(frame.opened, [], JSON.stringify(event));
  }
  // A plain click (also Enter on the link) stays in the app.
  assert.equal(click(), 1);
  assert.deepEqual(frame.opened, [{ view: "statistics" }]);
});

test("compact mux actions announce complete localized counts without changing disabled rules", async () => {
  // The library's compact selection actions are SelectionTools' count
  // tools (Phase 5a): the real tools, hook and count tool render here.
  const { loadSource, nodes, text } =
    await import("./helpers/component-harness.mjs");
  const { createHookRuntime } = await import("./helpers/hook-runtime.mjs");
  const selection = await import("../src/file-selection.ts");
  const muxSelection = await import("../src/mux-selection.ts");
  const runtime = createHookRuntime();
  const i18n = {
    t: (key, values = {}) =>
      key.replace(/\{(\w+)\}/g, (match, name) =>
        name in values ? String(values[name]) : match,
      ),
    useI18n: () => ({ locale: "en" }),
  };
  const ui = { ICON: { label: 15 }, count: (n) => String(n) };
  const { SelectionTools } = loadSource(
    "components/library/SelectionTools.tsx",
    {
      modules: {
        "../../i18n": i18n,
        "../../ui": ui,
        "../../hooks/useMuxSelection": loadSource("hooks/useMuxSelection.ts", {
          modules: {
            "preact/hooks": runtime.hooks,
            "../api": {},
            "../confirmation": {},
            "../notifications": {},
            "../i18n": i18n,
            "../file-selection": selection,
            "../mux-selection": muxSelection,
          },
        }),
        "../list/TableCard": loadSource("components/list/TableCard.tsx", {
          modules: {
            "preact/hooks": runtime.hooks,
            "../../hooks/useTableOverflow": {},
            "../../ui": ui,
          },
        }),
      },
    },
  );
  const tree = runtime.render(() =>
    SelectionTools({
      selection: { keys: [] },
      muxJobs: [],
      installed: true,
      changed: async () => {},
      busyChanged: () => {},
      editTags: () => {},
      working: false,
      capacity: 100,
    }),
  );
  // The tools; the live region of a mux run is not rendered while idle.
  const buttons = [tree.props.children]
    .flat()
    .filter(Boolean)
    .map((tool) => tool.type(tool.props));
  assert.equal(buttons.length, 3);
  // Named by what they show, label and count (Task 9 ruling D, WCAG
  // 2.5.3); the title keeps the catalog text with the count and reason.
  for (const button of buttons) {
    assert.equal(button.type, "button");
    assert.equal(button.props.disabled, true);
    assert.equal(button.props["aria-label"], undefined);
    const label = nodes(button).find((n) => n.props?.class === "v2-tc-label");
    const badge = nodes(button).find((n) => n.props?.class === "v2-count");
    const number = text(
      nodes(badge).find((n) => n.props?.class === "v2-count-num"),
    );
    assert.equal(number, "0");
    assert.ok(button.props.title.startsWith(text(label) + " (0) · "));
    assert.equal(badge.props["aria-hidden"], undefined);
  }
});
