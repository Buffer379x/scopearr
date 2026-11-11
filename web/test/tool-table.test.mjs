import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as preact from "preact";
import {
  loadSource,
  nodes,
  PRESENTATION_MODULES,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { src } from "./helpers/sources.mjs";
import * as color from "../src/color.ts";
import * as resolution from "../src/resolution-groups.ts";
import * as tagDisplay from "../src/tag-display.ts";
import * as tagLabels from "../src/tag-labels.ts";
import * as units from "../src/units.ts";

// The tool table, the tool card and the tool filter drawer (Phase 5b, task
// 5; docs/STYLEGUIDE.md, Part 1, 10.5, 10.8 and 10.10), built but not
// mounted yet, and the props they add to the 5a blocks: TableCard live,
// ListEmpty pending and RowButton tone and only. Each component runs as
// real code with the hook runtime; the blocks it places are named stubs,
// so a tree shows what they receive. Without the new props the 5a blocks
// render the VNodes recorded at the BASE of this task (goldens/).

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const i18n = { t, getLocale: () => "en", useI18n: () => ({ locale: "en" }) };

// Every module shares one hooks object; it calls the runtime that renders.
let current = createHookRuntime();
const hooks = new Proxy({}, { get: (_, name) => current.hooks[name] });
// The real ui.tsx: ICON and count.
const ui = loadSource("ui.tsx", {
  modules: {
    "./units": units,
    "./i18n": i18n,
    "./resolution-groups": resolution,
    "./tag-labels": tagLabels,
    "./color": color,
    "./tag-display": tagDisplay,
    preact,
    "preact/compat": { createPortal: (vnode) => vnode },
    "preact/hooks": hooks,
  },
});
const toolFilters = loadSource("tool-filters.ts");
const toolList = loadSource("tool-list.ts", {
  modules: {
    "./i18n": i18n,
    "./mux-spec": { muxFilterJobs: (jobs) => jobs },
    "./tool-filters": toolFilters,
  },
});

// A component with its own runtime; render() renders it again with the
// same state and the current props, as Preact would; flush() runs its
// effects.
function mount(component, props) {
  const runtime = createHookRuntime();
  const view = {
    runtime,
    props,
    render() {
      current = runtime;
      return runtime.render(() => component(view.props));
    },
    flush() {
      current = runtime;
      runtime.flush();
    },
    unmount() {
      current = runtime;
      runtime.unmount();
    },
  };
  return view;
}
const once = (component, props) => mount(component, props).render();
// A value of the sandbox as data of this realm.
const data = (value) => JSON.parse(JSON.stringify(value ?? null));
const classes = (node) => String(node?.props?.class ?? "").split(" ");
const byClass = (tree, name) =>
  nodes(tree).filter((n) => classes(n).includes(name));
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
const one = (tree, type) => {
  const found = ofType(tree, type);
  assert.equal(found.length, 1, "one " + String(type?.name ?? type));
  return found[0];
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

// The shape of a VNode tree, as goldens/ records it: every prop, an
// undefined one and a function by a marker, so a new prop key shows even
// when its value is undefined.
function shape(node) {
  if (Array.isArray(node)) return node.map(shape);
  if (node == null || typeof node === "boolean") return null;
  if (typeof node !== "object") return String(node);
  const type =
    typeof node.type === "function"
      ? "fn:" + (node.type.displayName || node.type.name)
      : node.type;
  const props = {};
  for (const [key, value] of Object.entries(node.props ?? {})) {
    if (key === "children") continue;
    props[key] =
      value === undefined
        ? "<undefined>"
        : typeof value === "function"
          ? "<function>"
          : value;
  }
  return {
    type,
    key: node.key ?? null,
    props,
    children: shape(node.props?.children),
  };
}
const GOLDEN = JSON.parse(
  readFileSync(
    new URL("./goldens/list-blocks-c5b92c6.json", import.meta.url),
    "utf8",
  ),
);

const listModule = (name, modules = {}) =>
  loadSource("components/list/" + name + ".tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../ui": ui,
      "../../i18n": i18n,
      ...modules,
    },
  });

// --- ToolTable -----------------------------------------------------------------

const toolTableModule = () =>
  loadSource("components/tools/ToolTable.tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../i18n": i18n,
      "../list/SortHeader": { SortHeader: "SortHeader" },
    },
    stubs: PRESENTATION_MODULES,
  });
// The real SortHeader, to read what a header the table builds shows.
const sortHeader = () =>
  listModule("SortHeader", { "../frame/Popover": { Popover: "Popover" } })
    .SortHeader;

const ROWS = [
  { id: 1, title: "Arrival", ok: true },
  { id: 2, title: "Heat", ok: false },
  { id: 3, title: "Alien", ok: true },
];
const COLUMNS = [
  { key: "buttons", label: "Info", info: true, cell: (r) => "info " + r.id },
  {
    key: "filename",
    label: "Filename",
    sort: "filename",
    grow: true,
    cell: (r) => r.title,
  },
  {
    key: "size",
    label: "Size",
    sort: "size",
    numeric: true,
    cell: (r) => r.id + " GB",
  },
  { key: "disks", label: "Disks", wide: true, cell: () => "disk1" },
  { key: "status", label: "Status", sort: "status", cell: () => "Queued" },
];
const STYLE = {
  "--tt-select": "44px",
  "--tt-buttons": "100px",
  "--tt-size": "80px",
  "--tt-min": "900px",
  "--tt-min-phone": "600px",
};
function toolTable(props = {}) {
  const sets = [],
    sorts = [];
  const { ToolTable } = toolTableModule();
  const view = mount(ToolTable, {
    rows: ROWS,
    keyOf: (row) => row.id,
    columns: COLUMNS,
    style: STYLE,
    sort: { field: "status", direction: "desc" },
    onSort: (field) => sorts.push(field),
    removing: new Set(),
    ...props,
    selection: {
      selected: [],
      set: (ids) => sets.push(ids),
      selectable: (row) => row.ok,
      disabled: false,
      allLabel: "Select all visible items",
      rowLabel: (row) => "Select item " + row.title,
      ...props.selection,
    },
  });
  return { view, sets, sorts };
}
const bodyRows = (tree) =>
  ofType(tree, "tbody")
    .flatMap((body) => ofType(body, "tr"))
    .filter((row) => classes(row).includes("v2-row"));
const boxes = (tree) => ofType(tree, "SelectionBox");

test("tool tables keep their column widths in a colgroup", () => {
  const tree = toolTable().view.render();
  // table.v2-table.v2-table--fixed with the explicit table role and the
  // measured widths as its style.
  assert.equal(tree.type, "table");
  assert.equal(tree.props.class, "v2-table v2-table--fixed");
  assert.equal(tree.props.role, "table");
  assert.equal(tree.props.style, STYLE);
  // One col per column: the selection, then each column in order with its
  // --tt-<key>; the title column has none, it takes the rest.
  const colgroup = one(tree, "colgroup");
  assert.deepEqual(
    data(ofType(colgroup, "col").map((col) => col.props.style ?? null)),
    [
      "width: var(--tt-select)",
      "width: var(--tt-buttons)",
      null,
      "width: var(--tt-size)",
      "width: var(--tt-disks)",
      "width: var(--tt-status)",
    ],
  );
  // The colgroup comes before the head; no cell carries a width.
  assert.deepEqual(data(tree.props.children.map((child) => child.type)), [
    "colgroup",
    "thead",
    "tbody",
  ]);
  for (const cell of [...ofType(tree, "td"), ...ofType(tree, "th")]) {
    assert.equal(cell.props.style, undefined);
    assert.equal(cell.props.width, undefined);
  }
});

test("tool tables sort through their headers", () => {
  const SortHeader = sortHeader();
  const h = toolTable();
  let tree = h.view.render();
  const head = one(tree, "thead");
  // Sortable fields get a SortHeader with the column's sort field, label,
  // number and title look; the others a th[scope=col] with their label
  // (Info reads "Info").
  const headers = ofType(head, "SortHeader");
  assert.deepEqual(
    data(
      headers.map((header) => [
        header.props.field,
        header.props.label,
        header.props.numeric,
        header.props.grow,
      ]),
    ),
    [
      ["filename", "Filename", false, true],
      ["size", "Size", true, false],
      ["status", "Status", false, false],
    ],
  );
  const plain = ofType(head, "th").filter(
    (th) => !classes(th).includes("v2-table-sel"),
  );
  assert.deepEqual(
    data(
      plain.map((th) => [
        th.props.scope,
        th.props.role,
        th.props["aria-sort"] ?? null,
        text(th),
      ]),
    ),
    [
      ["col", "columnheader", null, "Info"],
      ["col", "columnheader", null, "Disks"],
    ],
  );
  // The headers in column order, after the selection header.
  const order = ofType(head, "tr")[0].props.children.flat();
  assert.deepEqual(
    data(
      order.map((node) =>
        node.type === "SortHeader" ? node.props.field : text(node) || "select",
      ),
    ),
    ["select", "Info", "filename", "size", "Disks", "status"],
  );
  // aria-sort follows the sort: the status column is descending.
  const sorted = (header) => {
    const view = mount(SortHeader, header.props);
    return view.render().props["aria-sort"];
  };
  assert.deepEqual(headers.map(sorted), ["none", "none", "descending"]);
  // A press asks for its field.
  const status = mount(SortHeader, headers[2].props).render();
  one(status, "button").props.onClick({ currentTarget: null });
  assert.deepEqual(h.sorts, ["status"]);
  // Without a sort (1.7.0 TableSort null) every header is "none".
  tree = toolTable({ sort: null }).view.render();
  assert.deepEqual(
    data(ofType(tree, "SortHeader").map((header) => header.props.sort)),
    [
      { field: "", direction: "asc" },
      { field: "", direction: "asc" },
      { field: "", direction: "asc" },
    ],
  );
  assert.deepEqual(ofType(tree, "SortHeader").map(sorted), [
    "none",
    "none",
    "none",
  ]);
});

test("the page box selects only selectable rows", () => {
  // The header box: inside label.v2-table-hit (the 44 hit area on touch,
  // ruling M15), named by allLabel, tri-state over the selectable rows.
  let h = toolTable();
  let tree = h.view.render();
  const header = one(tree, "thead");
  const sel = ofType(header, "th")[0];
  assert.deepEqual(
    [sel.props.class, sel.props.scope, sel.props.role],
    ["v2-table-sel", "col", "columnheader"],
  );
  const hit = byClass(sel, "v2-table-hit");
  assert.equal(hit.length, 1);
  assert.equal(hit[0].type, "label");
  let page = one(header, "SelectionBox");
  assert.deepEqual(
    [
      page.props.label,
      page.props.className,
      page.props.total,
      page.props.count,
      page.props.disabled,
    ],
    ["Select all visible items", "v2-check", 2, 0, false],
  );
  // Checked, it selects the page's selectable rows; unchecked, none.
  page.props.change(true);
  page.props.change(false);
  assert.deepEqual(data(h.sets), [[1, 3], []]);

  // One of two chosen: mixed. A chosen row that is not selectable does not
  // count and its box is locked and unchecked.
  h = toolTable({ selection: { selected: [1, 2] } });
  tree = h.view.render();
  page = one(one(tree, "thead"), "SelectionBox");
  assert.deepEqual([page.props.total, page.props.count], [2, 1]);
  const rowBoxes = boxes(one(tree, "tbody"));
  assert.deepEqual(
    data(
      rowBoxes.map((box) => [
        box.props.label,
        box.props.total,
        box.props.count,
        box.props.disabled,
      ]),
    ),
    [
      ["Select item Arrival", 1, 1, false],
      ["Select item Heat", 0, 0, true],
      ["Select item Alien", 1, 0, false],
    ],
  );
  for (const box of rowBoxes) {
    assert.equal(box.props.className, "v2-check");
    assert.ok(
      byClass(tree, "v2-table-hit").some((label) => nodes(label).includes(box)),
      "each box sits in its hit label",
    );
  }
  // A row's box adds or removes its own id.
  rowBoxes[2].props.change(true);
  rowBoxes[0].props.change(false);
  assert.deepEqual(data(h.sets), [[1, 2, 3], [2]]);

  // keepOthers (Disk placement): the header adds and removes only the ids
  // of the page, the selection of other pages stays.
  h = toolTable({ selection: { selected: [9, 1], keepOthers: true } });
  page = one(one(h.view.render(), "thead"), "SelectionBox");
  assert.deepEqual([page.props.total, page.props.count], [2, 1]);
  page.props.change(true);
  page.props.change(false);
  assert.deepEqual(data(h.sets), [[9, 1, 3], [9]]);

  // Locked while an action runs: every box.
  tree = toolTable({
    selection: { selected: [1], disabled: true },
  }).view.render();
  assert.deepEqual(
    boxes(tree).map((box) => box.props.disabled),
    [true, true, true, true],
  );
  // Without selectable rows the header box is locked.
  tree = toolTable({
    selection: { selectable: () => false },
  }).view.render();
  page = one(one(tree, "thead"), "SelectionBox");
  assert.deepEqual([page.props.total, page.props.disabled], [0, true]);
});

test("rows mark selection and removal", () => {
  const tree = toolTable({
    selection: { selected: [1, 2] },
    removing: new Set([3]),
  }).view.render();
  const rows = bodyRows(tree);
  // Keyed by keyOf; selected only while selectable; a removed row fades
  // and stays in the accessibility tree until it is gone.
  assert.deepEqual(
    data(rows.map((row) => [row.key, row.props.class, row.props.role])),
    [
      [1, "v2-row v2-row--selected", "row"],
      [2, "v2-row", "row"],
      [3, "v2-row v2-row--removing", "row"],
    ],
  );
  for (const row of rows) assert.equal(row.props["aria-hidden"], undefined);
  // Cells: the explicit role, the column's label as data-label and the 5a
  // cell class, so narrow cards apply without tool rules; the content is
  // the column's cell.
  const cells = ofType(rows[0], "td");
  assert.deepEqual(
    data(
      cells.map((cell) => [
        cell.props.role,
        cell.props.class ?? null,
        cell.props["data-label"] ?? null,
      ]),
    ),
    [
      ["cell", "v2-table-sel", null],
      ["cell", "v2-table-info", "Info"],
      ["cell", "v2-table-title", "Filename"],
      ["cell", "v2-table-num", "Size"],
      ["cell", "v2-table-wide", "Disks"],
      ["cell", null, "Status"],
    ],
  );
  assert.deepEqual(
    cells.slice(1).map((cell) => text(cell)),
    ["info 1", "Arrival", "1 GB", "disk1", "Queued"],
  );
  // The groups and the head row carry their roles too.
  assert.deepEqual(
    data(
      [
        one(tree, "thead"),
        one(tree, "tbody"),
        ofType(one(tree, "thead"), "tr")[0],
      ].map((node) => node.props.role),
    ),
    ["rowgroup", "rowgroup", "row"],
  );
});

// F-I2 (Phase 5b fix wave): a plain text column clips its cells
// (v2-table-clip, beside its 5a class), as the 1.7.0 tool cells did; the
// other cells keep theirs alone, so their buttons and tags are never cut.
test("plain tool columns clip their cells", () => {
  const columns = COLUMNS.map((column) =>
    ["size", "status"].includes(column.key)
      ? { ...column, clip: true }
      : column,
  );
  const cells = ofType(bodyRows(toolTable({ columns }).view.render())[0], "td");
  assert.deepEqual(data(cells.map((cell) => cell.props.class ?? null)), [
    "v2-table-sel",
    "v2-table-info",
    "v2-table-title",
    "v2-table-num v2-table-clip",
    "v2-table-wide",
    "v2-table-clip",
  ]);
});

// Ruling M22: before a tool's first answer the page may hold rows of the
// row height instead of a pending empty state, as the libraries do.
test("placeholder rows hide from assistive technology", () => {
  const tree = toolTable({ rows: [], placeholders: 2 }).view.render();
  const rows = ofType(one(tree, "tbody"), "tr");
  assert.deepEqual(
    data(
      rows.map((row) => [
        row.key,
        row.props.class,
        row.props["aria-hidden"],
        row.props.role ?? null,
      ]),
    ),
    [
      ["placeholder0", "v2-row--placeholder", "true", null],
      ["placeholder1", "v2-row--placeholder", "true", null],
    ],
  );
  // The same cells as a row, each a no-break space, the title two lines.
  const cells = ofType(rows[0], "td");
  assert.deepEqual(data(cells.map((cell) => cell.props.class ?? null)), [
    "v2-table-sel",
    "v2-table-info",
    "v2-table-title",
    "v2-table-num",
    "v2-table-wide",
    null,
  ]);
  assert.deepEqual(
    data(
      byClass(cells[2], "v2-table-name")
        .concat(byClass(cells[2], "v2-table-sub"))
        .map((n) => text(n)),
    ),
    [" ", " "],
  );
  assert.equal(text(cells[3]), " ");
  // Without the prop there are none.
  assert.equal(
    ofType(one(toolTable({ rows: [] }).view.render(), "tbody"), "tr").length,
    0,
  );
});

// --- ToolCard -------------------------------------------------------------------

const STUBS = {
  "../list/TableCard": { TableCard: "TableCard" },
  "../list/FilterBar": { FilterBar: "FilterBar" },
  "../list/ChipsRow": { ChipsRow: "ChipsRow" },
  "../list/PageNav": { PageNav: "PageNav" },
  "../list/HelpTip": { HelpTip: "HelpTip" },
};
const HELP = [
  { heading: "Last scan", text: "Today, 4 min", raw: true },
  { heading: "How scanning works", text: "Scans read the shares." },
];
function toolCard(props = {}, presetProps = {}) {
  const calls = [];
  const log =
    (name) =>
    (...args) =>
      calls.push([name, ...args]);
  const { ToolCard } = loadSource("components/tools/ToolCard.tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../i18n": i18n,
      "../../ui": ui,
      "../../tool-list": toolList,
      "../../tool-filters": toolFilters,
      "../../hooks/useListPrefs": {
        useListPrefs: () => ({ density: "compact", stacked: false }),
      },
      ...STUBS,
    },
  });
  const PRESETS = [
    { id: 4, name: "Failed", query: "status=failed", service: "tool:mux" },
    { id: 7, name: "Queued", query: "status=queued", service: "tool:mux" },
  ];
  const presets = {
    presets: PRESETS,
    selectedPreset: undefined,
    applyPreset: log("applyPreset"),
    reset: log("presetReset"),
    savePreset: log("savePreset"),
    deletePreset: log("deletePreset"),
    dialogs: null,
    ...presetProps,
  };
  const view = mount(ToolCard, {
    id: "mux",
    title: "Jobs",
    total: 12,
    busy: true,
    activity: "Moving 1 of 3",
    search: {
      label: "Filename",
      placeholder: "Search filename …",
      value: "arr",
      change: log("search"),
    },
    presets,
    allLabel: "All jobs",
    active: true,
    filters: { count: 2, expanded: false, open: log("open") },
    chips: [
      { key: "status:failed", label: "Status: Failed", remove: log("chip") },
    ],
    reset: log("reset"),
    tools: "TOOLS",
    help: HELP,
    pager: { page: 2, pages: 5, setPage: log("page"), summary: "SUMMARY" },
    children: "TABLE",
    ...props,
  });
  return { view, calls, PRESETS };
}
const toolsOf = (tree) => {
  const chips = tree.props.chips;
  assert.equal(chips.type, "ChipsRow");
  const tools = chips.props.tools;
  return [tools?.type === preact.Fragment ? tools.props.children : tools]
    .flat(Infinity)
    .filter((n) => n != null && n !== false);
};

test("the tool card offers presets, Custom selection and the preset tools", () => {
  let h = toolCard();
  let tree = h.view.render();
  // The table card: its title, count, busy, the activity as its live hint
  // (ruling R-J), the list density, the region named by the title, the
  // pager in the foot and the table.
  assert.equal(tree.type, "TableCard");
  assert.deepEqual(
    data({
      id: tree.props.id,
      title: tree.props.title,
      count: tree.props.count,
      countTitle: tree.props.countTitle,
      busy: tree.props.busy,
      hint: tree.props.hint,
      live: tree.props.live,
      density: tree.props.density,
      regionLabel: tree.props.regionLabel,
      children: tree.props.children,
    }),
    {
      id: "mux",
      title: "Jobs",
      count: 12,
      countTitle: "Items in the list",
      busy: true,
      hint: "Moving 1 of 3",
      live: true,
      density: "compact",
      regionLabel: "Jobs",
      children: "TABLE",
    },
  );
  const foot = tree.props.foot;
  assert.equal(foot.type, "PageNav");
  assert.deepEqual(
    data([foot.props.page, foot.props.pages, foot.props.summary]),
    [2, 5, "SUMMARY"],
  );
  foot.props.setPage(3);

  // The filter bar: the search as given, the Filters button, and the
  // preset select: the tool's "All …" entry, its presets, and Custom
  // selection while active filters match no preset (ruling R-I).
  const bar = tree.props.bar;
  assert.equal(bar.type, "FilterBar");
  assert.equal(bar.props.search.label, "Filename");
  assert.equal(bar.props.search.value, "arr");
  bar.props.search.change("x");
  assert.deepEqual(data(bar.props.filters.count), 2);
  bar.props.filters.open("anchor");
  const preset = bar.props.preset;
  assert.deepEqual(
    data({
      label: preset.label,
      value: preset.value,
      options: preset.options,
      custom: preset.custom,
    }),
    {
      label: "Filter preset",
      value: "all",
      options: [
        { value: "all", label: "All jobs" },
        { value: "4", label: "Failed" },
        { value: "7", label: "Queued" },
      ],
      custom: true,
    },
  );
  // A preset applies; "All …" resets.
  preset.choose("7");
  preset.choose("all");
  assert.deepEqual(
    data(h.calls.map(([name, arg]) => [name, arg?.id ?? arg ?? null])),
    [
      ["page", 3],
      ["search", "x"],
      ["open", "anchor"],
      ["applyPreset", 7],
      ["presetReset", null],
    ],
  );

  // The chips row: "Filters", the tool's chips (never excluded), Reset
  // filters and the tools.
  const chips = tree.props.chips;
  assert.equal(chips.props.label, "Filters");
  assert.equal(chips.props.empty, "No active filters");
  assert.deepEqual(data(chips.props.chips), [
    { key: "status:failed", label: "Status: Failed", excluded: false },
  ]);
  h.calls.length = 0;
  chips.props.chips[0].remove();
  chips.props.reset();
  assert.deepEqual(data(h.calls), [["chip"], ["reset"]]);

  // Tools: the caller's ║ Save preset · Delete selected preset ║ Help, the
  // preset tools as sm icon buttons (ruling R-I) with their 1.7.0 names.
  let tools = toolsOf(tree);
  assert.deepEqual(
    tools.map((node) =>
      typeof node === "string"
        ? node
        : node.type === "HelpTip"
          ? "HelpTip"
          : classes(node).includes("v2-tc-sep")
            ? "│"
            : node.props["aria-label"],
    ),
    ["TOOLS", "│", "Save preset", "Delete selected preset", "│", "HelpTip"],
  );
  const [, sep, save, remove] = tools;
  assert.equal(sep.props["aria-hidden"], "true");
  for (const button of [save, remove]) {
    assert.equal(button.type, "button");
    assert.equal(button.props.type, "button");
    assert.equal(button.props.class, "v2-icon-btn v2-icon-btn--sm");
  }
  assert.equal(save.props.title, "Save filters as a permanent preset");
  assert.equal(remove.props.title, "Delete selected preset");
  assert.equal(save.props.disabled, undefined);
  // Delete is locked without a chosen preset.
  assert.equal(remove.props.disabled, true);
  h.calls.length = 0;
  save.props.onClick();
  assert.deepEqual(data(h.calls), [["savePreset"]]);
  // Help: the 1.7.0 sections.
  const help = tools.at(-1);
  assert.equal(help.props.label, "Help");
  assert.equal(help.props.sections, HELP);

  // A chosen preset shows as the value, without Custom selection, and can
  // be deleted.
  h = toolCard({}, { selectedPreset: { id: 4, name: "Failed" } });
  tree = h.view.render();
  assert.deepEqual(
    [tree.props.bar.props.preset.value, tree.props.bar.props.preset.custom],
    ["4", false],
  );
  tools = toolsOf(tree);
  assert.equal(tools[3].props.disabled, false);
  tools[3].props.onClick();
  assert.deepEqual(data(h.calls), [["deletePreset"]]);
  // Without active filters there is no Custom selection either.
  tree = toolCard({ active: false }).view.render();
  assert.equal(tree.props.bar.props.preset.custom, false);
  // Without an activity the hint line stays, empty.
  tree = toolCard({ activity: undefined, busy: false }).view.render();
  assert.deepEqual(
    [tree.props.hint, tree.props.live, tree.props.busy],
    [undefined, true, false],
  );
  // The page's loading dims the rows; an activity only turns the spinner
  // (Task 10, review M-1): dimmed follows its own prop, also with an
  // activity.
  tree = toolCard({
    activity: undefined,
    busy: true,
    dimmed: true,
  }).view.render();
  assert.deepEqual([tree.props.busy, tree.props.dimmed], [true, true]);
  tree = toolCard({
    activity: "Fixing · 2 waiting",
    busy: true,
    dimmed: false,
  }).view.render();
  assert.deepEqual([tree.props.busy, tree.props.dimmed], [true, false]);
  tree = toolCard({
    activity: "Fixing · 2 waiting",
    busy: true,
    dimmed: true,
  }).view.render();
  assert.deepEqual([tree.props.busy, tree.props.dimmed], [true, true]);
});

test("the tool card exports only with results", () => {
  const HREF =
    "/api/placement/export?q=arr&status=failed&share=Movies&sort=title&dir=desc";
  let tools = toolsOf(
    toolCard({ csv: { href: HREF, enabled: true } }).view.render(),
  );
  const labels = (list) =>
    list.map((node) =>
      typeof node === "string"
        ? node
        : node.type === "HelpTip"
          ? "HelpTip"
          : classes(node).includes("v2-tc-sep")
            ? "│"
            : node.props["aria-label"],
    );
  // Save · Delete ║ Export CSV ║ Help.
  assert.deepEqual(labels(tools), [
    "TOOLS",
    "│",
    "Save preset",
    "Delete selected preset",
    "│",
    "Export CSV",
    "│",
    "HelpTip",
  ]);
  // With results a download link with the literal href, an sm icon button.
  let link = tools[5];
  assert.equal(link.type, "a");
  assert.deepEqual(
    data([
      link.props.class,
      link.props.href,
      link.props.download,
      link.props.title,
      link.props.role ?? null,
    ]),
    ["v2-icon-btn v2-icon-btn--sm", HREF, true, "Export CSV", null],
  );
  // Without results a disabled link in the same place.
  tools = toolsOf(
    toolCard({ csv: { href: HREF, enabled: false } }).view.render(),
  );
  link = tools[5];
  assert.equal(link.type, "span");
  assert.deepEqual(
    data([
      link.props.class,
      link.props.role,
      link.props["aria-disabled"],
      link.props["aria-label"],
      link.props.title,
      link.props.href ?? null,
    ]),
    [
      "v2-icon-btn v2-icon-btn--sm",
      "link",
      "true",
      "Export CSV",
      "Export CSV",
      null,
    ],
  );
  // An inert link: nothing to press (the 1.7.0 CSVExport case of
  // release-163, which left with it in Phase 5b, Task 9).
  assert.equal(link.props.onClick, undefined);
  // Mux has no export: no link and no separator for it.
  assert.equal(
    labels(toolsOf(toolCard().view.render())).includes("Export CSV"),
    false,
  );
});

// --- ToolFilterDrawer -------------------------------------------------------------

const GROUPS = [
  {
    key: "shares",
    label: "Shares",
    options: [
      { value: "Movies", label: "Movies", count: 4 },
      { value: "TV", label: "TV", count: 0 },
    ],
  },
  {
    key: "statuses",
    label: "Status",
    options: [
      { value: "failed", label: "Failed", count: 2 },
      { value: "queued", label: "Queued", count: 1 },
    ],
  },
  {
    key: "kinds",
    label: "Kind",
    options: [{ value: "owner", label: "Owner", count: 3 }],
  },
];
const INITIAL = {
  statuses: ["failed"],
  kinds: [],
  targets: ["disk2"],
  shares: ["Movies"],
};
function toolDrawer(props = {}, { count = null, stale = false, modules } = {}) {
  const counted = [];
  const module = loadSource("components/tools/ToolFilterDrawer.tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../i18n": i18n,
      "../../hooks/useToolMatchCount": {
        useToolMatchCount(path) {
          counted.push(path);
          return { count: path === null ? null : count, stale };
        },
      },
      "../list/FilterDrawer": { FilterDrawer: "FilterDrawer" },
      "../list/CheckField": { CheckField: "CheckField" },
      ...modules,
    },
  });
  const applied = [],
    closed = [];
  const view = mount(module.default, {
    subtitle: "Items",
    groups: GROUPS,
    initial: INITIAL,
    countPath: (draft) =>
      "placement/items?" +
      new URLSearchParams([
        ...draft.statuses.map((v) => ["status", v]),
        ...draft.targets.map((v) => ["target", v]),
        ...draft.kinds.map((v) => ["kind", v]),
        ...draft.shares.map((v) => ["share", v]),
        ["limit", "1"],
      ]),
    apply: (draft) => applied.push(draft),
    close: () => closed.push(true),
    ...props,
  });
  return { view, counted, applied, closed };
}
const fieldOf = (tree, key) =>
  ofType(tree, "CheckField").find(
    (field) => field.props.id === "v2-drawer-" + key,
  );

test("the tool drawer edits a draft and applies it once", () => {
  const h = toolDrawer({}, { count: 42 });
  let tree = h.view.render();
  // The 5a shell: "Filters", the card title as its subtitle, the count.
  assert.equal(tree.type, "FilterDrawer");
  assert.deepEqual(
    data([tree.props.title, tree.props.subtitle, tree.props.count]),
    ["Filters", "Items", 42],
  );
  assert.equal(tree.props.stale, false);
  // One always open CheckField per group, in the given order, reading
  // the draft.
  assert.deepEqual(
    data(
      ofType(tree, "CheckField").map((field) => [
        field.props.id,
        field.props.label,
        field.props.selected,
      ]),
    ),
    [
      ["v2-drawer-shares", "Shares", ["Movies"]],
      ["v2-drawer-statuses", "Status", ["failed"]],
      ["v2-drawer-kinds", "Kind", []],
    ],
  );
  assert.equal(fieldOf(tree, "shares").props.options, GROUPS[0].options);
  assert.equal(
    h.counted.at(-1),
    "placement/items?status=failed&target=disk2&share=Movies&limit=1",
  );
  // Edits change the draft only: the fields and the count follow it.
  fieldOf(tree, "statuses").props.change(["failed", "queued"]);
  tree = h.view.render();
  fieldOf(tree, "kinds").props.change(["owner"]);
  tree = h.view.render();
  assert.deepEqual(data(fieldOf(tree, "statuses").props.selected), [
    "failed",
    "queued",
  ]);
  assert.equal(
    h.counted.at(-1),
    "placement/items?status=failed&status=queued&target=disk2&kind=owner&share=Movies&limit=1",
  );
  assert.deepEqual(h.applied, []);
  assert.deepEqual(h.closed, []);
  // Apply hands the draft over once, then closes.
  tree.props.apply();
  assert.deepEqual(data(h.applied), [
    {
      statuses: ["failed", "queued"],
      kinds: ["owner"],
      targets: ["disk2"],
      shares: ["Movies"],
    },
  ]);
  assert.deepEqual(h.closed, [true]);

  // Closing discards the draft.
  const closing = toolDrawer();
  tree = closing.view.render();
  fieldOf(tree, "statuses").props.change([]);
  tree = closing.view.render();
  tree.props.close();
  assert.deepEqual(closing.applied, []);
  assert.deepEqual(closing.closed, [true]);

  // Reset clears statuses, kinds and shares and keeps the target (a chip
  // of the scan report, no field); it neither applies nor closes.
  const reset = toolDrawer();
  tree = reset.view.render();
  tree.props.reset();
  tree = reset.view.render();
  assert.deepEqual(reset.applied, []);
  assert.deepEqual(reset.closed, []);
  assert.deepEqual(
    data(ofType(tree, "CheckField").map((field) => field.props.selected)),
    [[], [], []],
  );
  assert.equal(reset.counted.at(-1), "placement/items?target=disk2&limit=1");
  tree.props.apply();
  assert.deepEqual(data(reset.applied), [
    { statuses: [], kinds: [], targets: ["disk2"], shares: [] },
  ]);
});

// Ruling M16 (5a A8 M2): Back or Forward while the drawer is open brings
// other filters; the draft starts again from them, so Apply never writes
// back the filters the step left.
test("the tool drawer takes the filters a history step brings", () => {
  const h = toolDrawer();
  let tree = h.view.render();
  h.view.flush();
  fieldOf(tree, "kinds").props.change(["owner"]);
  tree = h.view.render();
  h.view.props = {
    ...h.view.props,
    initial: { statuses: ["queued"], kinds: [], targets: [], shares: [] },
  };
  h.view.render();
  h.view.flush();
  tree = h.view.render();
  assert.deepEqual(
    data(ofType(tree, "CheckField").map((field) => field.props.selected)),
    [[], ["queued"], []],
  );
  tree.props.apply();
  assert.deepEqual(data(h.applied), [
    { statuses: ["queued"], kinds: [], targets: [], shares: [] },
  ]);
  // A render with the same filters in a new object keeps the draft.
  h.view.props = {
    ...h.view.props,
    initial: { statuses: ["queued"], kinds: [], targets: [], shares: [] },
  };
  tree = h.view.render();
  fieldOf(tree, "shares").props.change(["TV"]);
  h.view.props = {
    ...h.view.props,
    initial: { statuses: ["queued"], kinds: [], targets: [], shares: [] },
  };
  h.view.render();
  h.view.flush();
  tree = h.view.render();
  assert.deepEqual(data(fieldOf(tree, "shares").props.selected), ["TV"]);
});

function fakeTimers() {
  let now = 0,
    next = 1;
  const timers = new Map();
  return {
    setTimeout(run, delay) {
      timers.set(next, { run, at: now + delay });
      return next++;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    pending: () => timers.size,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = end;
    },
  };
}

test("the tool drawer counts remotely or locally", async () => {
  const timers = fakeTimers();
  const requests = [];
  const api = (path, method, body, signal, options) =>
    new Promise((resolve, reject) =>
      requests.push({ path, signal, options, resolve, reject }),
    );
  const matchCount = loadSource("hooks/useToolMatchCount.ts", {
    modules: { "preact/hooks": hooks, "../api": { api } },
    browser: {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      AbortController,
    },
  });
  const modules = { "../../hooks/useToolMatchCount": matchCount };
  // Remotely: one request 180ms after the last change of the draft.
  const remote = toolDrawer({}, { modules });
  let tree = remote.view.render();
  remote.view.flush();
  assert.equal(tree.props.count, null);
  timers.advance(179);
  assert.equal(requests.length, 0);
  timers.advance(1);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].path,
    "placement/items?status=failed&target=disk2&share=Movies&limit=1",
  );
  assert.deepEqual(data(requests[0].options), { notifyErrors: false });
  // A change before the answer aborts it and waits for its own pause.
  fieldOf(tree, "statuses").props.change([]);
  tree = remote.view.render();
  remote.view.flush();
  assert.equal(requests[0].signal.aborted, true);
  timers.advance(100);
  fieldOf(tree, "kinds").props.change(["owner"]);
  tree = remote.view.render();
  remote.view.flush();
  timers.advance(179);
  assert.equal(requests.length, 1);
  timers.advance(1);
  assert.equal(requests.length, 2);
  assert.equal(
    requests[1].path,
    "placement/items?target=disk2&kind=owner&share=Movies&limit=1",
  );
  requests[1].resolve({ total: 17, items: [] });
  await tick();
  tree = remote.view.render();
  assert.deepEqual([tree.props.count, tree.props.stale], [17, false]);
  // A changed draft keeps the last count, stale, until its own arrives.
  fieldOf(tree, "kinds").props.change([]);
  tree = remote.view.render();
  remote.view.flush();
  assert.deepEqual([tree.props.count, tree.props.stale], [17, true]);
  remote.view.unmount();
  assert.equal(timers.pending(), 0);

  // Locally (Mux): the count of the draft, never stale, no request.
  const counts = [];
  const local = toolDrawer(
    {
      countPath: undefined,
      localCount: (draft) => (
        counts.push(draft.statuses),
        draft.statuses.length * 5
      ),
    },
    { modules },
  );
  tree = local.view.render();
  local.view.flush();
  assert.deepEqual([tree.props.count, tree.props.stale], [5, false]);
  fieldOf(tree, "statuses").props.change(["failed", "queued"]);
  tree = local.view.render();
  local.view.flush();
  assert.deepEqual([tree.props.count, tree.props.stale], [10, false]);
  timers.advance(1000);
  assert.equal(requests.length, 2);
  assert.deepEqual(data(counts.at(-1)), ["failed", "queued"]);
});

// Ruling I4: the drawer is a chunk of its own, loaded as the library's.
test("the tool drawer's import handles its own failure", async () => {
  const source = src("components/tools/drawer-chunk.ts");
  assert.match(
    source,
    /lazyChunk(?:<[^>]*>)?\(\s*\(\) =>\s*import\("\.\/ToolFilterDrawer"\)\.then\(\s*\(chunk\) => chunk\.default,\s*\(\) => null,?\s*\),?\s*\)/,
  );
  assert.doesNotMatch(source, /^import (?!type )[^;]*ToolFilterDrawer/m);
  const load = (drawer) => {
    let loader;
    const modules = {
      "../../hooks/useLazyChunk": { lazyChunk: (given) => (loader = given) },
    };
    Object.defineProperty(modules, "./ToolFilterDrawer", {
      enumerable: true,
      get() {
        if (drawer) return drawer;
        throw new TypeError("Failed to fetch dynamically imported module");
      },
    });
    loadSource("components/tools/drawer-chunk.ts", { modules });
    return loader;
  };
  assert.equal(await load({ default: "Drawer" })(), "Drawer");
  assert.equal(await load(null)(), null);
});

// The build with the tool page on these blocks (Task 6 on): MuxPage imports
// the drawer's chunk and the column measurement. The shared FilterDrawer
// then is a small chunk of its own, imported by both drawers' chunks
// (ruling I4); and the column measurement (tool-columns.ts) is in a tool
// chunk, never in the library chunk (ruling I2, Task 2 review: checked on
// the build, not only on the direct imports).
test("the drawers share FilterDrawer and the library chunk stays free of tool columns", async () => {
  const { build } = await import("vite");
  const root = fileURLToPath(new URL("../", import.meta.url));
  // The real page imports both (Task 6 replaced the simulated mount).
  const page = src("components/MuxPage.tsx");
  assert.match(
    page,
    /import \{ toolDrawerChunk \} from "\.\/tools\/drawer-chunk";/,
  );
  assert.match(
    page,
    /import \{ useToolColumnStyle \} from "\.\.\/use-tool-table";/,
  );
  const result = await build({
    root,
    logLevel: "silent",
    build: { write: false },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => r.output)
    .filter((o) => o.type === "chunk");
  const named = (name) => {
    const found = chunks.filter((chunk) =>
      new RegExp("^assets/" + name + "-[\\w-]{8}\\.js$").test(chunk.fileName),
    );
    assert.equal(found.length, 1, name);
    return found[0];
  };
  const has = (chunk, path) =>
    chunk.moduleIds.some((id) => id.endsWith("/src/" + path));
  const library = named("Library");
  const mux = named("MuxPage");
  const libraryDrawer = named("LibraryFilterDrawer");
  const toolDrawer = named("ToolFilterDrawer");
  // The measurement is in a tool chunk (the transform reached it) and the
  // library chunk holds neither its module nor its strings.
  const measuring = chunks.filter((chunk) => has(chunk, "tool-columns.ts"));
  assert.equal(measuring.length, 1, "one chunk measures");
  assert.notEqual(measuring[0].fileName, library.fileName);
  assert.match(measuring[0].code, /--tool-status-min/);
  assert.equal(has(library, "tool-columns.ts"), false);
  assert.doesNotMatch(library.code, /--tool-status-min|--tt-min-phone/);
  assert.equal(has(mux, "components/tools/ToolFilterDrawer.tsx"), false);
  // FilterDrawer: one chunk of its own, apart from both drawers, the
  // library and the entry, which both drawers import.
  const shells = chunks.filter((chunk) =>
    has(chunk, "components/list/FilterDrawer.tsx"),
  );
  assert.equal(shells.length, 1, "one chunk holds FilterDrawer");
  const shell = shells[0];
  for (const other of [library, libraryDrawer, toolDrawer, mux])
    assert.notEqual(shell.fileName, other.fileName);
  assert.equal(shell.isEntry, false);
  assert.ok(libraryDrawer.imports.includes(shell.fileName));
  assert.ok(toolDrawer.imports.includes(shell.fileName));
  assert.ok(has(toolDrawer, "components/list/CheckField.tsx"));
  assert.ok(
    shell.code.length < 4000,
    "a small chunk: " + shell.code.length + " B",
  );
});

// --- The 5a blocks' new props -------------------------------------------------------

const CARD = {
  id: "jobs",
  title: "Jobs",
  count: 12,
  countTitle: "Items in the list",
  busy: false,
  bar: "BAR",
  chips: "CHIPS",
  density: "comfortable",
  regionLabel: "Jobs",
  foot: "FOOT",
  children: "TABLE",
};
const tableCard = () =>
  listModule("TableCard", {
    "../../hooks/useTableOverflow": { useTableOverflow: () => false },
  }).TableCard;

test("table cards announce their hint only when live", () => {
  const TableCard = tableCard();
  const variants = [
    CARD,
    { ...CARD, busy: true, hint: "Scanning disk1 · 3 of 9 items" },
    { ...CARD, density: "compact", hint: preact.h("b", null, "x") },
  ];
  // Without live: the VNodes of the BASE.
  assert.deepEqual(
    data(variants.map((props) => shape(once(TableCard, props)))),
    GOLDEN.tableCard,
  );
  // Live: the hint line is a polite live region, nothing else changes.
  const hint = (tree) => byClass(tree, "v2-tc-hint")[0];
  for (const [at, props] of variants.entries()) {
    const tree = once(TableCard, { ...props, live: true });
    assert.equal(hint(tree).props["aria-live"], "polite");
    const golden = structuredClone(GOLDEN.tableCard[at]);
    const line = (node) =>
      node && typeof node === "object"
        ? node.props?.class === "v2-tc-hint"
          ? node
          : [node.children].flat().map(line).find(Boolean)
        : null;
    line(golden).props["aria-live"] = "polite";
    assert.deepEqual(data(shape(tree)), golden);
  }
  // live={false} is as without.
  assert.deepEqual(
    data(shape(once(TableCard, { ...CARD, live: false }))),
    GOLDEN.tableCard[0],
  );
});

test("a pending empty state keeps its place", () => {
  const { ListEmpty } = listModule("ListEmpty");
  const variants = [
    { icon: "ICON", title: "No mux jobs." },
    {
      icon: "ICON",
      title: "No scan yet",
      children: preact.h("p", null, "Run a scan."),
    },
  ];
  assert.deepEqual(
    data(variants.map((props) => shape(once(ListEmpty, props)))),
    GOLDEN.listEmpty,
  );
  // Pending: the same content, invisible (v2-empty--pending) and hidden
  // from assistive technology, so it holds the empty state's height.
  for (const [at, props] of variants.entries()) {
    const tree = shape(once(ListEmpty, { ...props, pending: true }));
    const golden = structuredClone(GOLDEN.listEmpty[at]);
    golden.props.class = "v2-empty v2-empty--pending";
    golden.props["aria-hidden"] = "true";
    assert.deepEqual(data(tree), golden);
  }
  assert.deepEqual(
    data(shape(once(ListEmpty, { ...variants[0], pending: false }))),
    GOLDEN.listEmpty[0],
  );
});

test("row buttons hide on phones or desktops on request", () => {
  const { RowButton } = listModule("RowButton");
  const f = () => {};
  const variants = [
    { label: "Details for Arrival", icon: "I" },
    {
      label: "Terminal for Arrival",
      icon: "I",
      title: "Terminal",
      onClick: f,
      size: "sm",
    },
    { label: "Open in Radarr", icon: "I", href: "https://x", newTab: true },
    {
      label: "Locked",
      icon: "I",
      href: "https://x",
      disabled: true,
      title: "Why",
    },
    { label: "Menu", icon: "I", popup: "menu", expanded: true },
    { label: "Dialog", icon: "I", popup: "dialog", on: true },
    { label: "Plain link", icon: "I", href: "#/x", onClick: f },
  ];
  // Without tone and only: the VNodes of the BASE.
  assert.deepEqual(
    data(variants.map((props) => shape(once(RowButton, props)))),
    GOLDEN.rowButton,
  );
  // Each adds its class after the others, buttons and links alike.
  for (const [extra, added] of [
    [{ only: "desk" }, " v2-row-btn--desk"],
    [{ only: "phone" }, " v2-row-btn--phone"],
    [{ tone: "danger" }, " v2-row-btn--danger"],
    [{ tone: "danger", only: "desk" }, " v2-row-btn--danger v2-row-btn--desk"],
  ])
    for (const [at, props] of variants.entries()) {
      const golden = structuredClone(GOLDEN.rowButton[at]);
      golden.props.class += added;
      assert.deepEqual(
        data(shape(once(RowButton, { ...props, ...extra }))),
        golden,
        JSON.stringify(extra) + " " + props.label,
      );
    }
});
