import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { between, squash, src } from "./helpers/sources.mjs";

const tools = [
  ["mux", { resetPageOnSort: false }],
  ["placement", { resetPageOnSort: true }],
  ["filecheck", { resetPageOnSort: true }],
];
const allowed = {
  statuses: ["open", "ok"],
  kinds: ["small_files"],
  sorts: ["title", "size"],
};
// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));

function fakeStorage(entries, blocked) {
  const map = new Map(Object.entries(entries));
  const fail = () => {
    throw new Error("storage blocked");
  };
  return {
    map,
    storage: blocked
      ? { getItem: fail, setItem: fail, removeItem: fail }
      : {
          getItem: (key) => (map.has(key) ? map.get(key) : null),
          setItem: (key, value) => map.set(key, String(value)),
          removeItem: (key) => map.delete(key),
        },
  };
}

// Runs the real hook with the real browser-storage, tool-route and sort
// modules and the shared hook runtime; effects run after each render whenever
// their dependencies change.
// With `route`, the hook gets a route ({ query, fromHistory }) that records
// its replaces; `toolRoute: "unused"` fails on any tool-route call.
function toolPageState(
  tool,
  options,
  {
    local: localEntries = {},
    session: sessionEntries = {},
    blocked,
    route: routed,
    toolRoute: toolRouteMode,
  } = {},
) {
  const local = fakeStorage(localEntries, blocked),
    session = fakeStorage(sessionEntries, blocked);
  const runtime = createHookRuntime();
  const storage = loadSource("browser-storage.ts", {
    browser: { localStorage: local.storage, sessionStorage: session.storage },
  });
  const sortable = loadSource("components/SortableHeader.tsx", {
    modules: { "../ui": { ICON: {} }, "../i18n": { t: (key) => key } },
  });
  const toolRoute =
    toolRouteMode === "unused"
      ? new Proxy(
          {},
          {
            get(_, name) {
              return () =>
                assert.fail("tool-route " + String(name) + " called");
            },
          },
        )
      : loadSource("tool-route.ts", {
          modules: { "./browser-storage": storage },
        });
  const { useToolPageState } = loadSource("hooks/useToolPageState.ts", {
    modules: {
      "preact/hooks": runtime.hooks,
      "../browser-storage": storage,
      "../components/SortableHeader": sortable,
      "../tool-route": toolRoute,
    },
  });
  const replaces = [];
  const route = routed && {
    query: routed.query,
    fromHistory: routed.fromHistory,
    replace: (query) => replaces.push(query),
  };
  let current;
  const render = () => {
    current = runtime.render(() =>
      route
        ? useToolPageState(tool, allowed, options, route)
        : useToolPageState(tool, allowed, options),
    );
    runtime.flush();
    return current;
  };
  render();
  return {
    get current() {
      return current;
    },
    render,
    local: local.map,
    session: session.map,
    replaces,
  };
}

test("tool state restores filters, sort and page from their existing keys", () => {
  for (const [tool, options] of tools) {
    const saved = JSON.stringify({
      statuses: ["ok", "gone"],
      targets: ["disk1"],
      kinds: ["small_files", "gone"],
      q: "matrix",
    });
    const h = toolPageState(tool, options, {
      local: {
        [`scopearr-${tool}-filters`]: saved,
        [`scopearr-${tool}-sort`]: "title:desc",
      },
      session: { [`scopearr-${tool}-page`]: "3" },
    });
    const { filters, sort, page } = h.current;
    assert.deepEqual(
      plain(filters),
      {
        statuses: ["ok"],
        targets: ["disk1"],
        kinds: ["small_files"],
        q: "matrix",
      },
      tool,
    );
    assert.deepEqual(plain(sort), { field: "title", direction: "desc" }, tool);
    assert.equal(page, 3, tool);
    assert.deepEqual(
      [...h.local],
      [
        [`scopearr-${tool}-filters`, JSON.stringify(plain(filters))],
        [`scopearr-${tool}-sort`, "title:desc"],
      ],
      tool,
    );
    assert.deepEqual([...h.session], [[`scopearr-${tool}-page`, "3"]], tool);
    for (const stored of ["0", "-2", "abc", ""]) {
      const fresh = toolPageState(tool, options, {
        session: { [`scopearr-${tool}-page`]: stored },
      });
      assert.equal(fresh.current.page, 1, `${tool} page ${stored}`);
      assert.equal(
        fresh.session.get(`scopearr-${tool}-page`),
        "1",
        `${tool} page ${stored}`,
      );
    }
  }
});

test("sorting resets the page only where it did before", () => {
  for (const [tool, options] of tools) {
    const h = toolPageState(tool, options, {
      session: { [`scopearr-${tool}-page`]: "4" },
    });
    h.current.sortBy("size");
    h.render();
    assert.deepEqual(
      plain(h.current.sort),
      { field: "size", direction: "asc" },
      tool,
    );
    assert.equal(h.local.get(`scopearr-${tool}-sort`), "size:asc", tool);
    const page = options.resetPageOnSort ? 1 : 4;
    assert.equal(h.current.page, page, tool);
    assert.equal(h.session.get(`scopearr-${tool}-page`), String(page), tool);
    h.current.setPage(2);
    h.render();
    h.current.sortBy("size");
    h.render();
    assert.deepEqual(
      plain(h.current.sort),
      { field: "size", direction: "desc" },
      tool,
    );
    assert.equal(h.local.get(`scopearr-${tool}-sort`), "size:desc", tool);
    assert.equal(h.current.page, options.resetPageOnSort ? 1 : 2, tool);
    h.current.sortBy("size");
    h.render();
    assert.equal(h.current.sort, null, tool);
    assert.equal(h.local.get(`scopearr-${tool}-sort`), "", tool);
  }
});

test("changing filters returns to page one and persists", () => {
  for (const [tool, options] of tools) {
    const h = toolPageState(tool, options, {
      local: {
        [`scopearr-${tool}-filters`]: JSON.stringify({ statuses: ["open"] }),
      },
      session: { [`scopearr-${tool}-page`]: "5" },
    });
    h.current.changeFilters({ q: "dune" });
    h.render();
    const expected = { statuses: ["open"], targets: [], kinds: [], q: "dune" };
    assert.deepEqual(plain(h.current.filters), expected, tool);
    assert.equal(h.current.page, 1, tool);
    assert.equal(
      h.local.get(`scopearr-${tool}-filters`),
      JSON.stringify(expected),
      tool,
    );
    assert.equal(h.session.get(`scopearr-${tool}-page`), "1", tool);
    // Plain setFilters keeps the page; Mux resets it in its own effect.
    h.current.setPage(3);
    h.render();
    h.current.setFilters({ ...h.current.filters, statuses: [] });
    h.render();
    assert.equal(h.current.page, 3, tool);
    assert.equal(
      h.local.get(`scopearr-${tool}-filters`),
      JSON.stringify({ ...expected, statuses: [] }),
      tool,
    );
  }
});

test("blocked storage falls back to defaults", () => {
  for (const [tool, options] of tools) {
    const h = toolPageState(tool, options, { blocked: true });
    assert.deepEqual(
      plain(h.current.filters),
      { statuses: [], targets: [], kinds: [], q: "" },
      tool,
    );
    assert.equal(h.current.sort, null, tool);
    assert.equal(h.current.page, 1, tool);
    h.current.setPage(2);
    h.render();
    h.current.sortBy("title");
    h.current.changeFilters({ q: "x" });
    h.render();
    assert.deepEqual(
      plain(h.current.sort),
      { field: "title", direction: "asc" },
      tool,
    );
    assert.equal(h.current.filters.q, "x", tool);
    assert.equal(h.current.page, 1, tool);
  }
});

// Stored state of every tool in the tests below, in its stored format.
const stored = {
  statuses: ["ok"],
  targets: ["disk1"],
  kinds: ["small_files"],
  q: "stored",
};
const titleDesc = { field: "title", direction: "desc" };
const emptyFilters = { statuses: [], targets: [], kinds: [], q: "" };
const keys = (tool) => ({
  filters: `scopearr-${tool}-filters`,
  sort: `scopearr-${tool}-sort`,
  page: `scopearr-${tool}-page`,
});
// Opens a tool page on a route over the stored state above.
function openRoute(tool, options, route) {
  return toolPageState(tool, options, {
    local: {
      [keys(tool).filters]: JSON.stringify(stored),
      [keys(tool).sort]: "title:desc",
    },
    session: { [keys(tool).page]: "3" },
    route,
  });
}
const stateOf = (h) =>
  plain({
    filters: h.current.filters,
    sort: h.current.sort,
    page: h.current.page,
  });

test("route values win and stored values fill the gaps", () => {
  for (const [tool, options] of tools) {
    const key = keys(tool);
    // An empty route (a menu click) keeps the stored state and storage.
    const plainOpen = openRoute(tool, options, { query: "" });
    assert.deepEqual(
      stateOf(plainOpen),
      { filters: stored, sort: titleDesc, page: 3 },
      tool,
    );
    assert.deepEqual(
      [...plainOpen.local],
      [
        [key.filters, JSON.stringify(stored)],
        [key.sort, "title:desc"],
      ],
      tool,
    );
    assert.deepEqual([...plainOpen.session], [[key.page, "3"]], tool);

    // A sort replaces the stored one; filters and page stay stored.
    const sorted = openRoute(tool, options, { query: "sort=size&dir=asc" });
    assert.deepEqual(
      stateOf(sorted),
      { filters: stored, sort: { field: "size", direction: "asc" }, page: 3 },
      tool,
    );
    assert.equal(sorted.local.get(key.sort), "size:asc", tool);
    assert.equal(sorted.local.get(key.filters), JSON.stringify(stored), tool);
    // A field the page cannot sort by leaves the stored sort.
    const unknown = openRoute(tool, options, { query: "sort=bogus&dir=asc" });
    assert.deepEqual(plain(unknown.current.sort), titleDesc, tool);
    assert.equal(unknown.local.get(key.sort), "title:desc", tool);

    // Filters come from the route as a whole, without statuses or kinds the
    // page does not know, and start on page 1.
    const filtered = openRoute(tool, options, {
      query: "q=matrix&status=open&status=gone&kind=small_files&kind=gone",
    });
    const routeFilters = {
      statuses: ["open"],
      targets: [],
      kinds: ["small_files"],
      q: "matrix",
    };
    assert.deepEqual(
      stateOf(filtered),
      { filters: routeFilters, sort: titleDesc, page: 1 },
      tool,
    );
    // Storage keeps its format: the filter JSON, field:dir and the page.
    assert.deepEqual(
      [...filtered.local],
      [
        [key.filters, JSON.stringify(routeFilters)],
        [key.sort, "title:desc"],
      ],
      tool,
    );
    assert.deepEqual([...filtered.session], [[key.page, "1"]], tool);
    assert.equal(
      openRoute(tool, options, { query: "q=matrix&page=2" }).current.page,
      2,
      tool,
    );

    // A page alone keeps the stored filters.
    const paged = openRoute(tool, options, { query: "page=5" });
    assert.deepEqual(
      stateOf(paged),
      { filters: stored, sort: titleDesc, page: 5 },
      tool,
    );
    assert.equal(paged.session.get(key.page), "5", tool);
  }
});

test("a route from history names the whole state", () => {
  for (const [tool, options] of tools) {
    const key = keys(tool);
    // Back and Forward take what the route leaves out as its default, and
    // storage follows the page.
    const searched = openRoute(tool, options, {
      query: "q=matrix",
      fromHistory: true,
    });
    const routeFilters = { ...emptyFilters, q: "matrix" };
    assert.deepEqual(
      stateOf(searched),
      { filters: routeFilters, sort: null, page: 1 },
      tool,
    );
    assert.deepEqual(
      [...searched.local],
      [
        [key.filters, JSON.stringify(routeFilters)],
        [key.sort, ""],
      ],
      tool,
    );
    assert.deepEqual([...searched.session], [[key.page, "1"]], tool);

    const empty = openRoute(tool, options, { query: "", fromHistory: true });
    assert.deepEqual(
      stateOf(empty),
      { filters: emptyFilters, sort: null, page: 1 },
      tool,
    );
    assert.equal(
      empty.local.get(key.filters),
      JSON.stringify(emptyFilters),
      tool,
    );

    const sorted = openRoute(tool, options, {
      query: "sort=size&dir=desc&page=2",
      fromHistory: true,
    });
    assert.deepEqual(
      stateOf(sorted),
      {
        filters: emptyFilters,
        sort: { field: "size", direction: "desc" },
        page: 2,
      },
      tool,
    );
    assert.equal(sorted.local.get(key.sort), "size:desc", tool);
  }
});

test("opening a tool keeps an unreadable stored sort", () => {
  for (const [tool, options] of tools) {
    const key = keys(tool);
    // A route without a sort leaves the stored value as it is, also one the
    // page cannot read, until the user sorts.
    for (const query of ["", "q=matrix", "page=2", "sort=bogus&dir=asc"]) {
      const h = toolPageState(tool, options, {
        local: { [key.sort]: "x" },
        route: { query },
      });
      assert.equal(h.current.sort, null, `${tool} ${query}`);
      assert.equal(h.local.get(key.sort), "x", `${tool} ${query}`);
      h.render();
      assert.equal(h.local.get(key.sort), "x", `${tool} ${query}`);
      h.current.sortBy("size");
      h.render();
      assert.equal(h.local.get(key.sort), "size:asc", `${tool} ${query}`);
    }
    // A sort in the route replaces it, and so does a step back to a route
    // without one (its default).
    const sorted = toolPageState(tool, options, {
      local: { [key.sort]: "x" },
      route: { query: "sort=size&dir=desc" },
    });
    assert.equal(sorted.local.get(key.sort), "size:desc", tool);
    const back = toolPageState(tool, options, {
      local: { [key.sort]: "x" },
      route: { query: "", fromHistory: true },
    });
    assert.equal(back.local.get(key.sort), "", tool);
  }
});

test("one tool table names paths, storage names and filter keys", () => {
  const storage = loadSource("browser-storage.ts");
  const toolRoute = loadSource("tool-route.ts", {
    modules: { "./browser-storage": storage },
  });
  const table = {
    mux: { path: "mux", storage: "mux", filters: ["status"] },
    disks: {
      path: "placement",
      storage: "placement",
      filters: ["status", "target", "kind"],
    },
    files: { path: "files", storage: "filecheck", filters: ["status", "kind"] },
  };
  assert.deepEqual(plain(toolRoute.TOOLS), table);
  assert.ok(Object.isFrozen(toolRoute.TOOLS));
  for (const entry of Object.values(toolRoute.TOOLS)) {
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.filters));
  }
  // No other copy of the mapping: the router, the tool queries and the tool
  // page hook read the table.
  for (const path of [
    "router.ts",
    "tool-route.ts",
    "hooks/useToolPageState.ts",
  ]) {
    const code = squash(src(path));
    for (const copy of [
      /\bplacement: "disks"/,
      /\bdisks: "placement"/,
      /\bfilecheck: "files"/,
      /\bfiles: "filecheck"/,
      /\bdisks: \[/,
    ])
      assert.doesNotMatch(code, copy, path);
  }
  for (const path of ["router.ts", "hooks/useToolPageState.ts"])
    assert.match(
      src(path),
      /import \{[^}]*\bTOOLS\b[^}]*\} from "\.\.?\/tool-route";/,
      path,
    );
  // The filter keys and storage names are spelled out in the table only.
  const route = squash(src("tool-route.ts"));
  assert.equal(route.match(/"status", "target", "kind"/g).length, 1);
  assert.equal(route.match(/"mux" \| "placement" \| "filecheck"/g).length, 1);
  assert.doesNotMatch(
    squash(src("hooks/useToolPageState.ts")),
    /"placement"|"filecheck"/,
  );
  // The router follows the table: another path moves the route.
  const moved = {
    ...toolRoute,
    TOOLS: {
      ...toolRoute.TOOLS,
      mux: { ...toolRoute.TOOLS.mux, path: "remux" },
    },
  };
  const { formatRoute, parseRoute } = loadSource("router.ts", {
    modules: {
      "./tool-route": moved,
      "./event-log": loadSource("event-log.ts"),
    },
  });
  assert.deepEqual(plain(parseRoute("#/tools/remux?q=a")), {
    view: "mux",
    query: "q=a",
  });
  assert.equal(formatRoute({ view: "mux", query: "" }), "#/tools/remux");
  assert.deepEqual(plain(parseRoute("#/tools/mux")), { view: "statistics" });
  // The tool page hook mirrors its state into the route of the tool whose
  // storage name it was given.
  for (const [tool, options] of tools) {
    const views = [];
    const runtime = createHookRuntime();
    const { useToolPageState } = loadSource("hooks/useToolPageState.ts", {
      modules: {
        "preact/hooks": runtime.hooks,
        "../browser-storage": storage,
        "../components/SortableHeader": loadSource(
          "components/SortableHeader.tsx",
          { modules: { "../ui": { ICON: {} }, "../i18n": { t: (k) => k } } },
        ),
        "../tool-route": {
          ...toolRoute,
          toolRouteQuery: (view, state) => {
            views.push(view);
            return toolRoute.toolRouteQuery(view, state);
          },
        },
      },
    });
    runtime.render(() =>
      useToolPageState(tool, allowed, options, {
        query: "",
        fromHistory: false,
        replace() {},
      }),
    );
    assert.deepEqual(
      [...new Set(views)],
      [Object.keys(table).find((view) => table[view].storage === tool)],
      tool,
    );
  }
});

test("the page mirrors its full state with replace", () => {
  const opened = {
    mux: "q=stored&status=ok&sort=title&dir=desc&page=3",
    placement:
      "q=stored&status=ok&target=disk1&kind=small_files&sort=title&dir=desc&page=3",
    filecheck: "q=stored&status=ok&kind=small_files&sort=title&dir=desc&page=3",
  };
  for (const [tool, options] of tools) {
    // Opening from storage puts the stored state into the URL at once.
    const h = openRoute(tool, options, { query: "" });
    assert.deepEqual(h.replaces, [opened[tool]], tool);
    h.render();
    assert.equal(h.replaces.length, 1, tool);

    const base = opened[tool].replace("q=stored", "q=dune");
    h.current.changeFilters({ q: "dune" });
    h.render();
    h.current.sortBy("size");
    h.render();
    h.current.setPage(2);
    h.render();
    assert.deepEqual(
      h.replaces.slice(1),
      [
        base.replace("&page=3", ""),
        base.replace("sort=title&dir=desc&page=3", "sort=size&dir=asc"),
        base.replace("sort=title&dir=desc&page=3", "sort=size&dir=asc&page=2"),
      ],
      tool,
    );

    // An empty state mirrors as an empty query.
    const fresh = toolPageState(tool, options, { route: { query: "" } });
    assert.deepEqual(fresh.replaces, [""], tool);
    // The route's own query comes back canonical.
    const linked = openRoute(tool, options, { query: "q=a+b&page=2" });
    assert.match(linked.replaces[0], /^q=a\+b&/, tool);
  }
});

test("without a route nothing changes", () => {
  for (const [tool, options] of tools) {
    const key = keys(tool);
    const h = toolPageState(tool, options, {
      local: {
        [key.filters]: JSON.stringify({ q: "x" }),
        [key.sort]: "size",
      },
      toolRoute: "unused",
    });
    const filters = { ...emptyFilters, q: "x" };
    assert.deepEqual(stateOf(h), { filters, sort: null, page: 1 }, tool);
    // The stored sort is not rewritten until the user sorts.
    assert.deepEqual(
      [...h.local],
      [
        [key.filters, JSON.stringify(filters)],
        [key.sort, "size"],
      ],
      tool,
    );
    assert.deepEqual([...h.session], [[key.page, "1"]], tool);
    h.current.sortBy("size");
    h.current.changeFilters({ q: "y" });
    h.render();
    h.current.setPage(2);
    h.render();
    assert.equal(h.local.get(key.sort), "size:asc", tool);
    assert.equal(h.session.get(key.page), "2", tool);
    assert.deepEqual(h.replaces, [], tool);
  }
});

test("tool pages hand their route and sort columns to the hook", () => {
  const pages = {
    "components/MuxPage.tsx": ['"mux"', "sorts: [...muxSortable]"],
    "components/DiskPlacementPage.tsx": [
      '"placement"',
      "sorts: [...placementSortable]",
    ],
    "components/FileCheckPage.tsx": [
      '"filecheck"',
      "sorts: Object.keys(fileCheckSortFields)",
    ],
  };
  for (const [path, [tool, sorts]] of Object.entries(pages)) {
    const code = squash(src(path));
    const call = between(code, "useToolPageState(", ");");
    assert.ok(call.includes(tool), path);
    assert.ok(call.includes(sorts), path);
    assert.match(
      call,
      /\{\s*resetPageOnSort: (true|false),?\s*\},\s*route,?\s*$/,
      path,
    );
    // The page takes the route as a prop.
    assert.match(
      code,
      /export function \w+Page\(\{[^}]*\broute\s*(?=[,}])[^}]*\}: \{[^}]*\broute\?: ToolRoute\s*[;}]/,
      path,
    );
  }
  // The shell restarts each tool page on a new revision and passes the route.
  const shell = squash(src("components/AppShell.tsx"));
  for (const page of ["FileCheckPage", "DiskPlacementPage", "MuxPage"])
    assert.match(
      shell,
      new RegExp(`<${page} key=\\{revision\\} route=\\{toolRoute\\} `),
      page,
    );
  const toolRoute = between(shell, "const toolRoute: ToolRoute = {", "};");
  assert.match(toolRoute, /query: "query" in route \? route\.query : ""/);
  assert.match(toolRoute, /\bfromHistory,/);
  assert.match(toolRoute, /replace: \(query\) => replaceRoute\(\{ query \}\)/);
});
