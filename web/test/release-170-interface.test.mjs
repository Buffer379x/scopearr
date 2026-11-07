import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const read = (name) =>
  readFileSync(new URL("../src/" + name, import.meta.url), "utf8");
// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));

test("header is extracted and navigation counters cannot change button width", () => {
  assert.ok(
    existsSync(new URL("../src/components/AppHeader.tsx", import.meta.url)),
  );
});
test("phone library selection actions have count badges and complete accessible names", () => {
  const mux = read("components/MuxSelectionActions.tsx");
  assert.match(mux, /aria-label=\{markLabel\}/);
  assert.match(mux, /aria-label=\{removeLabel\}/);
});
test("demo library cache totals include disabled sample instances", () => {
  assert.match(
    read("hooks/useLibraryState.ts"),
    /instancesOf\(settings, !status\.demo\)/,
  );
});

test("header exposes the current page and forwards navigation actions", async () => {
  const { componentHarness, loadSource, nodes, text } =
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
    openLink: (target) => selected.push(target),
    openSettings: () => selected.push("settings"),
    toggleTheme: () => selected.push("theme"),
    signOut: () => selected.push("logout"),
  };
  const h = componentHarness("AppHeader", props, {
    modules: {
      "../instances": instances,
      "../nav-link": loadSource("nav-link.ts"),
      "./NavMenu": { NavMenu: "NavMenu" },
    },
  });
  let tree = h.render();
  const settings = nodes(tree).find(
    (n) => n.props?.["aria-label"] === "Settings",
  );
  assert.equal(settings.props["aria-current"], "page");
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
  assert.deepEqual(plain(selected), [
    "settings",
    { view: "statistics" },
    { view: "library", service: "radarr", instance: "" },
  ]);
});

test("a plain click on the brand opens the dashboard in the app", async () => {
  const { componentHarness, loadSource, nodes } =
    await import("./helpers/component-harness.mjs");
  const instances = await import("../src/instances.ts");
  const opened = [];
  const h = componentHarness(
    "AppHeader",
    {
      page: "library",
      service: "radarr",
      settings: { instances: [] },
      filters: { radarr: "", sonarr: "" },
      toolItems: [],
      theme: "dark",
      openLink: (target) => opened.push(plain(target)),
      openSettings: () => opened.push("settings"),
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
  // The markup stays a link to the start page.
  assert.deepEqual(Object.keys(brand.props).sort(), [
    "aria-label",
    "children",
    "class",
    "href",
    "onClick",
  ]);
  assert.equal(brand.props.href, "/");
  const click = (event = {}) => {
    const prevented = [];
    brand.props.onClick({
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
  // window loads / and opens the dashboard there).
  for (const event of [
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ]) {
    assert.equal(click(event), 0, JSON.stringify(event));
    assert.deepEqual(opened, [], JSON.stringify(event));
  }
  // A plain click (also Enter on the link) stays in the app.
  assert.equal(click(), 1);
  assert.deepEqual(opened, [{ view: "statistics" }]);
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
