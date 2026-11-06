import test from "node:test";
import assert from "node:assert/strict";
import { createContext } from "preact";
import { componentHarness } from "./helpers/component-harness.mjs";
import { between, src } from "./helpers/sources.mjs";

// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));

const order = [
  "CustomTagNames",
  "TagLabels",
  "SDListGrouping",
  "TagVisibility",
  "HiddenTags",
  "TagColors",
  "TagTextColors",
];

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

// Runs the real provider with fake hooks: state and refs persist across
// renders, effects run on flush when their dependencies change, and the API
// answers from `responses` (a function answer is called per request).
function dataProvider({ responses = {}, status = {} } = {}) {
  const contexts = Object.fromEntries(
      order.map((name) => [name, createContext(undefined)]),
    ),
    state = [],
    refs = [],
    effects = [],
    calls = [],
    loaded = [],
    read = new Map(),
    seen = [],
    children = { type: "children" };
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
    useRef(initial) {
      const slot = cursor++;
      if (!(slot in refs)) refs[slot] = { current: initial };
      return refs[slot];
    },
    useEffect(effect, deps) {
      const slot = cursor++;
      const old = effects[slot];
      if (!old || !deps || deps.some((value, i) => value !== old.deps[i]))
        effects[slot] = { deps, pending: effect, cleanup: old?.cleanup };
    },
    useContext(context) {
      seen.push(context);
      return read.get(context);
    },
  };
  const props = {
    status,
    customTagsLoaded: (ids) => loaded.push([...ids].sort()),
    children,
  };
  const harness = componentHarness("AppDataProvider", props, {
    browser: { AbortController },
    modules: {
      preact: { createContext },
      "preact/hooks": hooks,
      "../ui": contexts,
      "../notifications": { notify: () => {} },
      "../api": {
        api: async (path, method = "GET") => {
          calls.push(method + " " + path);
          const answer = responses[path];
          return typeof answer === "function" ? answer() : answer;
        },
      },
    },
  });
  const h = {
    contexts,
    children,
    calls,
    loaded,
    exports: harness.exports,
    render() {
      cursor = 0;
      h.tree = harness.render();
      return h.tree;
    },
    get data() {
      return h.tree.props.value;
    },
    async flush() {
      for (const entry of effects)
        if (entry?.pending) {
          if (typeof entry.cleanup === "function") entry.cleanup();
          entry.cleanup = entry.pending();
          entry.pending = undefined;
        }
      await new Promise((done) => setTimeout(done, 0));
      return h.render();
    },
    unmount() {
      for (const entry of effects)
        if (typeof entry?.cleanup === "function") entry.cleanup();
    },
    // Contexts read through useContext, and values supplied to them.
    seen,
    provide: (context, value) => read.set(context, value),
  };
  h.render();
  return h;
}

// Walks the provider chain below the data provider.
function chain(h) {
  const types = [];
  let node = h.tree.props.children;
  while (node && node !== h.children) {
    types.push(node.type);
    node = node.props.children;
  }
  assert.equal(node, h.children, "children render innermost");
  return types;
}

test("data provider keeps the seven presentation contexts in order", () => {
  const h = dataProvider();
  assert.deepEqual(
    chain(h),
    order.map((name) => h.contexts[name].Provider),
  );
  // useAppData reads the context the outer provider supplies and refuses to
  // run outside of it.
  const { useAppData } = h.exports;
  assert.throws(() => useAppData(), /AppDataProvider/);
  const [context] = h.seen;
  assert.equal(context.Provider, h.tree.type);
  h.provide(context, h.data);
  assert.equal(useAppData(), h.data);
  assert.deepEqual(Object.keys(h.data).sort(), [
    "customRevision",
    "customTags",
    "loadCustom",
    "loadPresets",
    "loadSettings",
    "presets",
    "setSettings",
    "settings",
  ]);
  // The shell subscribes to app data itself; Preact would otherwise skip the
  // passed-through children when only the provider state changes.
  assert.match(
    between(
      src("components/AppShell.tsx"),
      "export function AppShell(",
      "\n}\n",
    ),
    /const data = useAppData\(\);/,
  );
  const library = src("components/Library.tsx");
  assert.match(
    between(library, "export function Library(", "\n}\n"),
    /<AppDataProvider[\s\S]*customTagsLoaded=\{navigation\.pruneCustomFilters\}[\s\S]*<AppShell [\s\S]*<\/AppDataProvider>/,
  );
});

test("presentation values derive from settings and custom tags", async () => {
  const settings = {
    groupSDLists: true,
    hiddenTags: { codec: true },
    tagColors: { 1: "#ff0000" },
    tagTextColors: { 1: "#ffffff" },
  };
  const h = dataProvider({
    responses: {
      settings,
      presets: [{ id: 3, name: "HEVC", service: "radarr", query: "" }],
      "custom-tags": [
        { id: 1, name: "keep", displayName: "Keep forever" },
        { id: 2, name: "trash", displayName: "" },
      ],
      "tag-presentation": {
        tags: { resolution: ["1080p"] },
        labels: { "1080p": "Full HD" },
      },
    },
  });
  const values = () =>
    plain(
      Object.fromEntries(
        order.map((name, i) => {
          let node = h.tree;
          for (let depth = 0; depth <= i; depth++) node = node.props.children;
          return [name, node.props.value ?? null];
        }),
      ),
    );
  assert.deepEqual(values(), {
    CustomTagNames: {},
    TagLabels: {},
    SDListGrouping: false,
    TagVisibility: null,
    HiddenTags: {},
    TagColors: {},
    TagTextColors: {},
  });
  assert.equal(h.data.settings, null);
  await h.flush();
  await h.flush();
  assert.deepEqual(values(), {
    CustomTagNames: { 1: "Keep forever", 2: "trash" },
    TagLabels: { "1080p": "Full HD" },
    SDListGrouping: true,
    TagVisibility: { resolution: ["1080p"] },
    HiddenTags: { codec: true },
    TagColors: { 1: "#ff0000" },
    TagTextColors: { 1: "#ffffff" },
  });
  assert.equal(h.data.settings, settings);
  assert.equal(h.data.presets.length, 1);
  assert.equal(h.data.customTags.length, 2);
  assert.equal(h.data.customRevision, 1);
  // Grouping SD lists needs both switches; groupSD false turns it off.
  settings.groupSD = false;
  h.render();
  assert.equal(values().SDListGrouping, false);
  // Settings come from one request each on mount; tag presentation reloads
  // after the custom tags revision changed.
  assert.deepEqual(h.calls.slice().sort(), [
    "GET custom-tags",
    "GET presets",
    "GET settings",
    "GET tag-presentation",
    "GET tag-presentation",
  ]);
});

test("custom tag loads report ids for filter pruning", async () => {
  const answers = [];
  const h = dataProvider({
    responses: {
      "custom-tags": () => {
        const answer = deferred();
        answers.push(answer);
        return answer.promise;
      },
    },
  });
  await h.flush();
  answers[0].resolve([{ id: 1, name: "keep" }]);
  await h.flush();
  assert.deepEqual(h.loaded, [["1"]]);
  assert.deepEqual(plain(h.data.customTags.map((tag) => tag.id)), [1]);

  // A reload overtakes an earlier one; the older answer is dropped.
  const older = h.data.loadCustom(),
    newer = h.data.loadCustom();
  answers[2].resolve([
    { id: 4, name: "new" },
    { id: 5, name: "other" },
  ]);
  assert.equal(plain(await newer).length, 2);
  answers[1].resolve([{ id: 9, name: "stale" }]);
  assert.equal(await older, undefined);
  h.render();
  assert.deepEqual(h.loaded, [["1"], ["4", "5"]]);
  assert.deepEqual(plain(h.data.customTags.map((tag) => tag.id)), [4, 5]);
  assert.equal(h.data.customRevision, 2);

  // An answer that arrives after unmount is dropped as well.
  const late = h.data.loadCustom();
  h.unmount();
  answers[3].resolve([{ id: 7, name: "late" }]);
  assert.equal(await late, undefined);
  assert.equal(h.loaded.length, 2);
});
