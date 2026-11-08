import test from "node:test";
import assert from "node:assert/strict";
import * as icons from "lucide-preact";
import {
  componentHarness,
  loadSource,
  nodes,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { src } from "./helpers/sources.mjs";

// Quick search (Task 13, V11, E18 with ruling R-C): a native modal dialog
// with a combobox. Pages come from the nav model and are filtered here;
// titles come from /api/files (FTS, limit=6) from two letters on, 180ms
// after the last keystroke, one request per library and pause, the one
// before cancelled (hooks/useTitleSearch.ts). A title opens its library
// filtered by it (components/frame/QuickSearch.tsx).

// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");

const storage = loadSource("browser-storage.ts");
const toolRoute = loadSource("tool-route.ts", {
  modules: { "./browser-storage": storage },
});
const instances = loadSource("instances.ts");
const frameStatus = loadSource("frame-status.ts", {
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
});
const router = loadSource("router.ts", {
  modules: {
    "./event-log": loadSource("event-log.ts"),
    "./tool-route": toolRoute,
  },
});
const navModel = loadSource("nav-model.ts", {
  modules: {
    "./instances": instances,
    "./frame-status": frameStatus,
    "./router": router,
    "./tool-route": toolRoute,
  },
});
const navLink = loadSource("nav-link.ts");

const instance = (id, type, name = "") => ({
  id,
  type,
  name,
  enabled: true,
  url: "http://" + id,
  hasKey: true,
  interval: 60,
});
// Two movie instances (sub-entries), Disk placement hidden.
const settings = {
  instances: [
    instance("radarr", "radarr"),
    instance("radarr-4k", "radarr", "Radarr 4K"),
    instance("sonarr", "sonarr"),
  ],
};
const status = {
  demo: false,
  mux: { enabled: true, installed: true, pending: 0, running: 0, failed: 0 },
  unraid: { enabled: false },
  files: { available: true, pending: 0, running: 0, failed: 0 },
};
const pages = navModel.searchPages(
  navModel.navModel({
    route: router.parseRoute("#/dashboard"),
    settings,
    status,
    translate: t,
  }),
);

// Fake timers: setTimeout and clearTimeout, advanced by hand.
function fakeClock() {
  let now = 0,
    next = 0;
  const timers = new Map();
  return {
    setTimeout: (run, ms = 0) => {
      timers.set(++next, { at: now + ms, run });
      return next;
    },
    clearTimeout: (id) => timers.delete(id),
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at))
        if (timer.at <= now) {
          timers.delete(id);
          timer.run();
        }
    },
    get pending() {
      return timers.size;
    },
  };
}
// The library answers: each request waits until answered with its files
// (or fails).
function fakeApi() {
  const calls = [];
  return {
    calls,
    api: (path, method, body, signal, options) =>
      new Promise((resolve, reject) =>
        calls.push({
          path,
          method,
          body,
          signal,
          options: options && plain(options),
          answer: (files) => resolve({ files, total: files.length }),
          fail: () => reject(new Error("Request failed")),
        }),
      ),
  };
}
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const movie = (id, title, year, service = "radarr") => ({
  id,
  service,
  mediaId: id,
  title,
  series: "",
  years: [year],
});
const episode = (id, series, mediaId, service = "sonarr") => ({
  id,
  service,
  mediaId,
  title: "E0" + id + " · Episode " + id,
  series,
  years: [2020],
});

// The titles chunk imports nothing at run time (the bundler's chunks).
const titleSearch = loadSource("title-search.ts");
// Without `chunk` the titles chunk cannot load (its import rejects).
function loadTitleSearch(runtime, clock, api, chunk = titleSearch) {
  return loadSource("hooks/useTitleSearch.ts", {
    browser: {
      AbortController,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    },
    modules: {
      "preact/hooks": runtime.hooks,
      "../api": { api: api.api },
      ...(chunk ? { "../title-search": chunk } : {}),
    },
  });
}

const hrefOf = (target) => router.formatRoute(linkRoute(target));
function linkRoute(target) {
  if (target.view === "library")
    return {
      view: "library",
      service: target.service,
      filters:
        "query" in target
          ? target.query
          : target.instance
            ? "instance=" + target.instance
            : "",
      page: 1,
      sort: "",
      dir: "",
    };
  if (target.view === "settings")
    return { view: "settings", section: target.section, tab: "", query: "" };
  if (target.view === "statistics") return { view: "statistics" };
  return { view: target.view, query: "" };
}

const classes = (node) => String(node?.props?.class ?? "").split(/\s+/);
const hasClass = (node, name) => classes(node).includes(name);
const byClass = (tree, name) => nodes(tree).filter((n) => hasClass(n, name));

// The quick search dialog with the real title search on fake timers and a
// fake library; the dialog and the anchor are fakes that record.
function search({ list = pages, chunk = titleSearch } = {}) {
  const runtime = createHookRuntime(),
    clock = fakeClock(),
    api = fakeApi();
  const calls = [],
    dialogs = [],
    overlays = [];
  const dialog = {
    open: false,
    showModal() {
      this.open = true;
      calls.push("showModal");
    },
    close() {
      this.open = false;
      calls.push("close dialog");
    },
    scrolled: [],
    querySelector(selector) {
      return {
        scrollIntoView: (options) =>
          dialog.scrolled.push([selector, plain(options)]),
      };
    },
  };
  const anchor = { focus: (options) => calls.push(["focus", plain(options)]) };
  const hook = loadTitleSearch(runtime, clock, api, chunk);
  const props = {
    pages: list,
    hrefOf,
    anchor,
    open: (target) => calls.push(["open", plain(target)]),
    close: () => calls.push("close"),
  };
  const harness = componentHarness("frame/QuickSearch", props, {
    exportName: "QuickSearch",
    modules: {
      "preact/hooks": runtime.hooks,
      "../../dialog-stack": {
        pushDialog: (element) => dialogs.push(["push", element]),
        removeDialog: (element) => dialogs.push(["remove", element]),
      },
      "../../hooks/useTitleSearch": hook,
      "../../i18n": { t },
      "../../nav-link": navLink,
      "../../ui": { ICON: { button: 16 } },
      "./Popover": {
        useOneOverlay: (close) => overlays.push(close),
      },
      "./Sidebar": {
        NAV_ICONS: {
          dashboard: icons.LayoutDashboard,
          movies: icons.Film,
          series: icons.Tv,
          mux: icons.Scissors,
          disks: icons.HardDrive,
          files: icons.FolderCheck,
          settings: icons.Settings,
        },
      },
    },
  });
  // As Preact would, attach the dialog before the layout effects run.
  let tree = runtime.render(harness.render);
  nodes(tree).find((n) => n.type === "dialog").ref.current = dialog;
  runtime.flush();
  tree = runtime.settle(harness.render);
  const view = {
    runtime,
    clock,
    api,
    calls,
    dialogs,
    overlays,
    dialog,
    anchor,
    props,
    get tree() {
      return tree;
    },
    render() {
      tree = runtime.settle(harness.render);
      return tree;
    },
    input: () => nodes(tree).find((n) => n.type === "input"),
    listbox: () => nodes(tree).find((n) => n.props?.role === "listbox"),
    options: () => nodes(tree).filter((n) => n.props?.role === "option"),
    // [group label, [option label, meta]…] in order.
    groups: () =>
      nodes(tree)
        .filter((n) => n.props?.role === "group")
        .map((group) => [
          text(byClass(group, "v2-pop-title")[0]),
          nodes(group)
            .filter((n) => n.props?.role === "option")
            .map((option) => [
              text(byClass(option, "v2-menu-text")[0]),
              text(byClass(option, "v2-qs-meta")[0]),
            ]),
        ]),
    empty: () => byClass(tree, "v2-pop-text").map((n) => text(n)),
    // The field's dot: running while titles are on their way, else idle
    // (hidden in its place).
    dot: () => {
      const field = byClass(tree, "v2-qs-field")[0];
      const [dot, ...more] = byClass(field, "v2-dot");
      assert.equal(more.length, 0);
      assert.equal(dot.props["aria-hidden"], "true");
      return classes(dot).filter((name) => name !== "v2-dot");
    },
    type(value) {
      view.input().props.onInput({ currentTarget: { value } });
      return view.render();
    },
    key(key, extra = {}) {
      let prevented = false;
      view.input().props.onKeyDown({
        key,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        isComposing: false,
        ...extra,
        preventDefault: () => (prevented = true),
      });
      view.render();
      return prevented;
    },
    // Lets `ms` pass; the titles chunk then loads and asks the libraries.
    async pause(ms) {
      clock.advance(ms);
      await flushPromises();
      return view.render();
    },
    // Answers the open requests of the libraries and renders the result.
    async answer(byService) {
      for (const call of api.calls.filter((call) => !call.done)) {
        call.done = true;
        const service = new URLSearchParams(call.path.split("?")[1]).get(
          "service",
        );
        call.answer(byService[service] ?? []);
      }
      await flushPromises();
      return view.render();
    },
  };
  return view;
}

test("quick search lists pages first and finds titles after two letters", async () => {
  // The nav model's entries in their order with their context (section,
  // or the group of a sub-entry); Settings by its areas, hidden tools left
  // out.
  assert.deepEqual(
    plain(pages.map((page) => [page.label, page.meta, page.icon])),
    [
      ["Dashboard", "Library", "dashboard"],
      ["Movies", "Library", "movies"],
      ["Radarr", "Movies", "movies"],
      ["Radarr 4K", "Movies", "movies"],
      ["TV series", "Library", "series"],
      ["Muxing", "Tools", "mux"],
      ["Files & permissions", "Tools", "files"],
      ["Services", "Settings", "settings"],
      ["Display", "Settings", "settings"],
      ["Widgets", "Settings", "settings"],
      ["Custom tags", "Settings", "settings"],
      ["Tag rules", "Settings", "settings"],
      ["System", "Settings", "settings"],
    ],
  );
  assert.deepEqual(plain(pages[3].target), {
    view: "library",
    service: "radarr",
    instance: "radarr-4k",
  });
  assert.deepEqual(plain(pages.at(-1).target), {
    view: "settings",
    section: "system",
  });

  const h = search();
  // A native modal dialog named "Quick search", on the dialog stack, in
  // the frame's one-overlay registry.
  const dialog = nodes(h.tree).find((n) => n.type === "dialog");
  assert.ok(hasClass(dialog, "v2-qs"));
  assert.equal(dialog.props["aria-label"], "Quick search");
  assert.deepEqual(h.calls, ["showModal"]);
  assert.deepEqual(h.dialogs, [["push", h.dialog]]);
  assert.equal(h.overlays.length > 0, true);
  // The combobox controls the listbox, both named; the placeholder.
  const input = h.input();
  assert.equal(input.props.role, "combobox");
  assert.equal(input.props.type, "text");
  assert.equal(input.props["aria-controls"], h.listbox().props.id);
  assert.equal(input.props["aria-autocomplete"], "list");
  assert.equal(input.props["aria-label"], "Quick search");
  assert.equal(input.props.placeholder, "Search pages, movies and TV series …");
  assert.equal(h.listbox().props["aria-label"], "Quick search");

  // Without a query: every page, nothing asked.
  assert.deepEqual(h.groups(), [
    ["Pages", plain(pages.map((page) => [page.label, page.meta]))],
  ]);
  assert.equal(h.clock.pending, 0);
  assert.equal(h.api.calls.length, 0);

  // Pages match when each word of the query starts one of their words.
  h.type("se");
  assert.deepEqual(h.groups()[0], [
    "Pages",
    [
      ["TV series", "Library"],
      ["Services", "Settings"],
      ["Display", "Settings"],
      ["Widgets", "Settings"],
      ["Custom tags", "Settings"],
      ["Tag rules", "Settings"],
      ["System", "Settings"],
    ],
  ]);
  h.type("tag ru");
  assert.deepEqual(h.groups()[0][1], [["Tag rules", "Settings"]]);
  h.type("  4K ");
  assert.deepEqual(h.groups()[0][1], [["Radarr 4K", "Movies"]]);
  h.type("arr");
  assert.equal(h.groups().length, 0, "no word starts with arr");

  // One letter: no titles, no request, no wait: no match is final.
  h.type("a");
  await h.pause(1000);
  assert.equal(h.api.calls.length, 0);
  assert.equal(h.listbox().props["aria-busy"], undefined);
  assert.deepEqual(h.dot(), ["v2-qs-idle"]);
  assert.deepEqual(h.empty(), ["No matches."]);

  // Two letters: 180ms after the last keystroke, one request per library,
  // quiet. Until the answer the list is busy and "No matches." waits.
  h.type("ar");
  assert.equal(h.listbox().props["aria-busy"], "true");
  assert.deepEqual(h.dot(), ["v2-dot--running"]);
  assert.deepEqual(h.empty(), []);
  await h.pause(179);
  assert.equal(h.api.calls.length, 0);
  // Another keystroke within the pause starts it again.
  h.type("arr");
  await h.pause(179);
  h.type("arri");
  await h.pause(179);
  assert.equal(h.api.calls.length, 0);
  await h.pause(1);
  assert.deepEqual(
    h.api.calls.map((call) => [call.path, call.method, call.options]),
    [
      [
        "files?service=radarr&mode=matches&q=arri&limit=6",
        "GET",
        { notifyErrors: false },
      ],
      [
        "files?service=sonarr&mode=matches&q=arri&limit=6",
        "GET",
        { notifyErrors: false },
      ],
    ],
  );
  // A new query cancels what is on its way; its late answer shows nothing.
  const old = h.api.calls.slice();
  h.type("arrival");
  assert.ok(old.every((call) => call.signal.aborted));
  for (const call of old) {
    call.done = true;
    call.answer([movie(9, "Heat", 1995)]);
  }
  await flushPromises();
  h.render();
  assert.equal(h.listbox().props["aria-busy"], "true");
  assert.equal(h.groups().length, 0);
  await h.pause(180);
  assert.deepEqual(
    h.api.calls.slice(2).map((call) => call.path),
    [
      "files?service=radarr&mode=matches&q=arrival&limit=6",
      "files?service=sonarr&mode=matches&q=arrival&limit=6",
    ],
  );
  assert.ok(h.api.calls.slice(2).every((call) => !call.signal.aborted));
  await h.answer({ radarr: [movie(1, "Arrival", 2016)] });
  // Pages first, then Movies, then TV series; a title has its year.
  assert.deepEqual(h.groups(), [["Movies", [["Arrival", "2016"]]]]);
  assert.equal(h.listbox().props["aria-busy"], undefined);
  assert.deepEqual(h.dot(), ["v2-qs-idle"]);
  assert.deepEqual(h.empty(), []);

  // A longer query keeps the titles shown until its own answer arrives.
  h.type("arrival 2");
  assert.equal(h.listbox().props["aria-busy"], "true");
  assert.deepEqual(h.groups(), [["Movies", [["Arrival", "2016"]]]]);
  await h.pause(180);
  await h.answer({});
  assert.deepEqual(h.groups(), []);
  assert.deepEqual(h.empty(), ["No matches."]);

  // Pages and titles together, in this order; a failed library finds
  // nothing, without a notice.
  h.type("da");
  await h.pause(180);
  const [films, shows] = h.api.calls.slice(-2);
  films.done = shows.done = true;
  films.answer([movie(101, "Perfect Days", 2023)]);
  shows.fail();
  await flushPromises();
  h.render();
  assert.deepEqual(h.groups(), [
    ["Pages", [["Dashboard", "Library"]]],
    ["Movies", [["Perfect Days", "2023"]]],
  ]);
  assert.equal(h.listbox().props["aria-busy"], undefined);

  // Below two letters again, the titles go at once, and a new query
  // shows none of the earlier one's while it waits.
  h.type("d");
  assert.deepEqual(h.groups(), [
    [
      "Pages",
      [
        ["Dashboard", "Library"],
        ["Display", "Settings"],
      ],
    ],
  ]);
  h.type("di");
  assert.equal(h.listbox().props["aria-busy"], "true");
  assert.deepEqual(h.groups(), [["Pages", [["Display", "Settings"]]]]);

  // Closing cancels what is on its way: a request, or a pending pause.
  await h.pause(180);
  const open = h.api.calls.slice(-2);
  assert.ok(open.every((call) => !call.signal.aborted));
  h.runtime.unmount();
  assert.ok(open.every((call) => call.signal.aborted));
  const later = search();
  later.type("ab");
  assert.equal(later.clock.pending, 1);
  later.runtime.unmount();
  assert.equal(later.clock.pending, 0);
  assert.equal(later.api.calls.length, 0);
});

test("arrows move the active option and Enter opens it", async () => {
  const h = search();
  h.type("da");
  await h.pause(180);
  await h.answer({
    radarr: [movie(101, "Perfect Days", 2023)],
    sonarr: [episode(5, "Dark", 4), episode(6, "Dark", 4)],
  });
  assert.deepEqual(h.groups(), [
    ["Pages", [["Dashboard", "Library"]]],
    ["Movies", [["Perfect Days", "2023"]]],
    ["TV series", [["Dark", ""]]],
  ]);
  const active = () => {
    const options = h.options();
    const selected = options.filter(
      (option) => option.props["aria-selected"] === true,
    );
    assert.equal(selected.length, 1, "one selected option");
    assert.equal(
      h.input().props["aria-activedescendant"],
      selected[0].props.id,
      "the combobox points at it",
    );
    return text(byClass(selected[0], "v2-menu-text")[0]);
  };
  // Every option has its own id in the listbox; the first is active.
  const ids = h.options().map((option) => option.props.id);
  assert.equal(new Set(ids).size, 3);
  assert.equal(active(), "Dashboard");
  // ↓ and ↑ move and wrap; the caret stays in the field.
  assert.equal(h.key("ArrowDown"), true);
  assert.equal(active(), "Perfect Days");
  h.key("ArrowDown");
  assert.equal(active(), "Dark");
  h.key("ArrowDown");
  assert.equal(active(), "Dashboard");
  h.key("ArrowUp");
  assert.equal(active(), "Dark");
  // The active option is scrolled into view.
  assert.deepEqual(h.dialog.scrolled.at(-1), [
    "#" + h.input().props["aria-activedescendant"],
    { block: "nearest" },
  ]);
  // Enter opens it: a title opens its library filtered by it (R-C).
  assert.equal(h.key("Enter"), true);
  assert.deepEqual(h.calls.at(-1), [
    "open",
    { view: "library", service: "sonarr", query: "q=Dark" },
  ]);
  // Not while an input method composes.
  const before = h.calls.length;
  assert.equal(h.key("Enter", { isComposing: true }), false);
  assert.equal(h.calls.length, before);
  // The pointer makes the option under it active.
  h.options()[1].props.onMouseMove();
  h.render();
  assert.equal(active(), "Perfect Days");
  h.key("Enter");
  assert.deepEqual(h.calls.at(-1), [
    "open",
    { view: "library", service: "radarr", query: "q=Perfect+Days" },
  ]);
  // Typing starts at the first option again.
  h.type("dash");
  assert.equal(active(), "Dashboard");
  h.key("Enter");
  assert.deepEqual(h.calls.at(-1), ["open", { view: "statistics" }]);

  // Options are links to their route that never take focus: a plain
  // click opens the target, a modified one keeps the browser's link.
  await h.pause(180);
  await h.answer({ radarr: [movie(1, "Dash", 2020)] });
  const [page, title] = h.options();
  assert.equal(page.type, "a");
  assert.equal(page.props.href, "#/dashboard");
  assert.equal(title.props.href, "#/movies?q=Dash");
  assert.equal(title.props.tabIndex, -1);
  let kept = false;
  title.props.onMouseDown({ preventDefault: () => (kept = true) });
  assert.equal(kept, true, "focus stays in the field");
  const click = (extra) => {
    let prevented = false;
    const count = h.calls.length;
    title.props.onClick({
      button: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...extra,
      preventDefault: () => (prevented = true),
    });
    return [prevented, h.calls.slice(count)];
  };
  for (const extra of [
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])
    assert.deepEqual(click(extra), [false, []], JSON.stringify(extra));
  assert.deepEqual(click({}), [
    true,
    [["open", { view: "library", service: "radarr", query: "q=Dash" }]],
  ]);
  // Each option: a decorative tile, its name, its context.
  assert.deepEqual(
    byClass(title, "v2-tile").map((tile) => tile.props["aria-hidden"]),
    ["true"],
  );

  // Without an option Enter does nothing; ⌘K and Ctrl+K stay in the
  // dialog (no browser search), with Shift or Alt they are the browser's.
  h.type("zz");
  await h.pause(180);
  await h.answer({});
  const count = h.calls.length;
  assert.equal(h.input().props["aria-activedescendant"], undefined);
  assert.equal(h.key("Enter"), false);
  assert.equal(h.key("ArrowDown"), false);
  assert.equal(h.key("k", { ctrlKey: true }), true);
  assert.equal(h.key("K", { metaKey: true }), true);
  assert.equal(h.key("k", { ctrlKey: true, shiftKey: true }), false);
  assert.equal(h.key("k", { metaKey: true, altKey: true }), false);
  assert.equal(h.key("k"), false);
  assert.equal(h.calls.length, count);

  // Escape (the dialog's cancel) and a press on the backdrop close it.
  const dialog = nodes(h.tree).find((n) => n.type === "dialog");
  let cancelled = false;
  dialog.props.onCancel({ preventDefault: () => (cancelled = true) });
  assert.equal(cancelled, true, "the owner closes it, not the browser");
  assert.equal(h.calls.at(-1), "close");
  const self = {};
  dialog.props.onClick({ target: self, currentTarget: self });
  assert.equal(h.calls.at(-1), "close");
  dialog.props.onClick({ target: {}, currentTarget: self });
  assert.equal(h.calls.filter((call) => call === "close").length, 2);
  // The overlay registry closes it like any popover.
  h.overlays.at(-1)(false);
  assert.equal(h.calls.at(-1), "close");

  // Unmounted, it leaves the top layer and the stack, and focus returns to
  // its anchor.
  const calls = h.calls.length;
  h.runtime.unmount();
  assert.deepEqual(h.calls.slice(calls), [
    "close dialog",
    ["focus", { preventScroll: true }],
  ]);
  assert.deepEqual(h.dialogs, [
    ["push", h.dialog],
    ["remove", h.dialog],
  ]);
});

test("series results are folded per series", async () => {
  const { titleHits } = titleSearch;
  // The episodes of a series are one row, in the order of the answer; the
  // same series in another instance opens the same filtered list, so it is
  // one row too.
  assert.deepEqual(
    plain(
      titleHits("sonarr", [
        episode(1, "Dark", 4),
        episode(2, "Breaking Bad", 1),
        episode(3, "Dark", 4),
        episode(4, "Breaking Bad", 9, "sonarr-2"),
        episode(5, "Better Call Saul", 5),
      ]),
    ),
    [
      {
        key: "Dark\n",
        label: "Dark",
        meta: "",
        icon: "series",
        target: { view: "library", service: "sonarr", query: "q=Dark" },
      },
      {
        key: "Breaking Bad\n",
        label: "Breaking Bad",
        meta: "",
        icon: "series",
        target: {
          view: "library",
          service: "sonarr",
          query: "q=Breaking+Bad",
        },
      },
      {
        key: "Better Call Saul\n",
        label: "Better Call Saul",
        meta: "",
        icon: "series",
        target: {
          view: "library",
          service: "sonarr",
          query: "q=Better+Call+Saul",
        },
      },
    ],
  );
  // Movies: one row each with its year; the same movie in two instances
  // is one row, a remake of another year its own.
  assert.deepEqual(
    plain(
      titleHits("radarr", [
        movie(1, "Dune", 2021),
        movie(2, "Dune", 1984),
        movie(3, "Dune", 2021, "radarr-4k"),
        { ...movie(4, "Her", 2013), years: null },
        movie(5, "", 2000),
      ]),
    ).map((hit) => [hit.label, hit.meta, hit.icon, hit.target.query]),
    [
      ["Dune", "2021", "movies", "q=Dune"],
      ["Dune", "1984", "movies", "q=Dune"],
      ["Her", "", "movies", "q=Her"],
    ],
  );

  // The titles are a chunk of their own (E24): loaded only by the hook,
  // when it first asks, and importing nothing at run time, so the bundler
  // moves no shared module into a new startup chunk.
  assert.deepEqual(
    src("title-search.ts").match(/^import (?!type ).*$/gm),
    null,
  );
  assert.match(
    src("hooks/useTitleSearch.ts"),
    /import\("\.\.\/title-search"\)/,
  );
  assert.doesNotMatch(
    src("hooks/useTitleSearch.ts") + src("components/frame/QuickSearch.tsx"),
    /^import (?!type )[^;]*from "[./]*title-search"/m,
  );

  // Through the dialog: the episodes of six files are two series.
  const h = search();
  h.type("br");
  await h.pause(180);
  await h.answer({
    sonarr: [
      episode(1, "Breaking Bad", 1),
      episode(2, "Breaking Bad", 1),
      episode(3, "Breaking Bad", 1),
      episode(4, "Better Call Saul", 5),
      episode(5, "Breaking Bad", 1),
      episode(6, "Better Call Saul", 5),
    ],
  });
  assert.deepEqual(h.groups(), [
    [
      "TV series",
      [
        ["Breaking Bad", ""],
        ["Better Call Saul", ""],
      ],
    ],
  ]);
});

// One overlay at a time (Task 8 carry-forward): quick search takes part in
// the popovers' registry, so opening it (by ⌘K too) closes a shown
// popover, such as the tab bar's Tools menu, and a popover that opens
// closes it.
test("quick search and the popovers are one overlay at a time", () => {
  let current;
  const hooks = new Proxy({}, { get: (_, name) => current.hooks[name] });
  const { useOneOverlay } = loadSource("components/frame/Popover.tsx", {
    modules: {
      "preact/hooks": hooks,
      "preact/compat": {},
      "../../notifications": loadSource("notifications.ts"),
    },
  });
  const closed = [];
  const mount = (name) => {
    const runtime = createHookRuntime();
    current = runtime;
    runtime.render(() =>
      useOneOverlay((returnFocus) => closed.push([name, returnFocus])),
    );
    runtime.flush();
    return runtime;
  };
  const menu = mount("tools menu");
  const quick = mount("quick search");
  assert.deepEqual(closed, [["tools menu", false]]);
  // The latest close counts: a re-render with a new close keeps the slot.
  current = quick;
  quick.render(() =>
    useOneOverlay((returnFocus) =>
      closed.push(["quick search 2", returnFocus]),
    ),
  );
  quick.flush();
  mount("jobs menu");
  assert.deepEqual(closed, [
    ["tools menu", false],
    ["quick search 2", false],
  ]);
  // Unmounted overlays are never closed again; the shown one is.
  current = menu;
  menu.unmount();
  current = quick;
  quick.unmount();
  mount("sync popover");
  assert.deepEqual(closed.slice(2), [["jobs menu", false]]);
});

// Fix round 1: when the titles chunk cannot load (offline, a deployment in
// the middle of a session), the search ends quietly: no titles, the busy
// state and the running dot clear, and "No matches." is final.
test("a titles chunk that cannot load ends the search", async () => {
  const h = search({ chunk: null });
  h.type("ar");
  assert.equal(h.listbox().props["aria-busy"], "true");
  assert.deepEqual(h.dot(), ["v2-dot--running"]);
  await h.pause(180);
  assert.equal(h.api.calls.length, 0);
  assert.equal(h.listbox().props["aria-busy"], undefined);
  assert.deepEqual(h.dot(), ["v2-qs-idle"]);
  assert.deepEqual(h.groups(), []);
  assert.deepEqual(h.empty(), ["No matches."]);
  // Pages still filter without it.
  h.type("dash");
  await h.pause(180);
  assert.deepEqual(h.groups(), [["Pages", [["Dashboard", "Library"]]]]);
  assert.equal(h.listbox().props["aria-busy"], undefined);
  h.runtime.unmount();
});

// Fix round 1: limit belongs to quick search. A library route that carries
// one (a hand-edited #/movies?limit=x) asks /api/files without it, so the
// configured page size applies as in 1.7.0 and no 400 follows.
test("library routes never pass a limit to the files request", () => {
  const runtime = createHookRuntime(),
    clock = fakeClock(),
    api = fakeApi();
  const { useLibraryQuery } = loadSource("hooks/useLibraryQuery.ts", {
    browser: {
      AbortController,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    },
    modules: { "preact/hooks": runtime.hooks, "../api": { api: api.api } },
  });
  runtime.settle(() =>
    useLibraryQuery({
      view: "library",
      service: "radarr",
      filters: { radarr: "q=Arrival&limit=x&limit=6&codec=x265", sonarr: "" },
      page: 2,
      movieSort: { field: "year", direction: "desc" },
      lastSuccess: null,
      seasonMode: "matches",
      pageSize: 100,
      setResults() {},
      setBusy() {},
    }),
  );
  clock.advance(180);
  assert.deepEqual(
    api.calls.map((call) => call.path),
    ["files?q=Arrival&codec=x265&service=radarr&page=2&sort=year&dir=desc"],
  );
  runtime.unmount();
});
