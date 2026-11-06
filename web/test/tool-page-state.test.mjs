import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";

const tools = [
  ["mux", { resetPageOnSort: false }],
  ["placement", { resetPageOnSort: true }],
  ["filecheck", { resetPageOnSort: true }],
];
const allowed = { statuses: ["open", "ok"], kinds: ["small_files"] };
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

// Runs the real hook with the real browser-storage module and sort helpers;
// effects run after each render whenever their dependencies change.
function toolPageState(
  tool,
  options,
  { local: localEntries = {}, session: sessionEntries = {}, blocked } = {},
) {
  const local = fakeStorage(localEntries, blocked),
    session = fakeStorage(sessionEntries, blocked);
  const state = [],
    effects = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in state))
        state[slot] = typeof initial === "function" ? initial() : initial;
      return [
        state[slot],
        (next) => {
          state[slot] = typeof next === "function" ? next(state[slot]) : next;
        },
      ];
    },
    useEffect(effect, deps) {
      const slot = cursor++;
      const old = effects[slot];
      if (!old || deps.some((value, i) => value !== old.deps[i]))
        effects[slot] = { deps, pending: effect };
    },
  };
  const storage = loadSource("browser-storage.ts", {
    browser: { localStorage: local.storage, sessionStorage: session.storage },
  });
  const sortable = loadSource("components/SortableHeader.tsx", {
    modules: { "../ui": { ICON: {} }, "../i18n": { t: (key) => key } },
  });
  const { useToolPageState } = loadSource("hooks/useToolPageState.ts", {
    modules: {
      "preact/hooks": hooks,
      "../browser-storage": storage,
      "../components/SortableHeader": sortable,
    },
  });
  let current;
  const render = () => {
    cursor = 0;
    current = useToolPageState(tool, allowed, options);
    for (const entry of effects)
      if (entry?.pending) {
        entry.pending();
        entry.pending = undefined;
      }
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
      assert.equal(fresh.session.get(`scopearr-${tool}-page`), "1");
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
    assert.deepEqual(plain(h.current.sort), {
      field: "size",
      direction: "asc",
    });
    assert.equal(h.local.get(`scopearr-${tool}-sort`), "size:asc");
    const page = options.resetPageOnSort ? 1 : 4;
    assert.equal(h.current.page, page, tool);
    assert.equal(h.session.get(`scopearr-${tool}-page`), String(page), tool);
    h.current.setPage(2);
    h.render();
    h.current.sortBy("size");
    h.render();
    assert.deepEqual(plain(h.current.sort), {
      field: "size",
      direction: "desc",
    });
    assert.equal(h.local.get(`scopearr-${tool}-sort`), "size:desc");
    assert.equal(h.current.page, options.resetPageOnSort ? 1 : 2, tool);
    h.current.sortBy("size");
    h.render();
    assert.equal(h.current.sort, null);
    assert.equal(h.local.get(`scopearr-${tool}-sort`), "");
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
    );
  }
});

test("blocked storage falls back to defaults", () => {
  for (const [tool, options] of tools) {
    const h = toolPageState(tool, options, { blocked: true });
    assert.deepEqual(plain(h.current.filters), {
      statuses: [],
      targets: [],
      kinds: [],
      q: "",
    });
    assert.equal(h.current.sort, null);
    assert.equal(h.current.page, 1);
    h.current.setPage(2);
    h.render();
    h.current.sortBy("title");
    h.current.changeFilters({ q: "x" });
    h.render();
    assert.deepEqual(plain(h.current.sort), {
      field: "title",
      direction: "asc",
    });
    assert.equal(h.current.filters.q, "x");
    assert.equal(h.current.page, 1);
  }
});
