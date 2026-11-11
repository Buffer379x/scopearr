import test from "node:test";
import assert from "node:assert/strict";
import {
  componentHarness,
  loadSource,
  find,
  nodes,
  text,
} from "./helpers/component-harness.mjs";

test("Info column widths measure long headings without adding a sort icon", () => {
  // The v2 widths (tool-columns.ts; the 1.7.0 toolTableStyle left in
  // Phase 5b, Task 9): Info holds its buttons or its header, never a sort
  // button; a sortable data column adds one (4 + 4 + 2 + 11).
  const geometry = loadSource("tool-columns.ts", {
    modules: {
      "./filecheck": {},
      "./mux-spec": {},
      "./placement": {},
      "./ui": { ICON: { arrow: 11 } },
    },
  });
  const metrics = {
    header: (label) => label.length * 6,
    tag: (text) => text.length * 6 + 24,
    button: 28,
    gap: 4,
    pad: 8,
    edge: 20,
    select: 44,
    title: 200,
    sort: 21,
    status: 116,
  };
  const buttons = { info: 2, actions: 2, infoPhone: 1, actionsPhone: 1 };
  const style = (column, kind, label) =>
    geometry.toolColumnStyle(
      [column],
      kind,
      { [column]: label },
      [],
      buttons,
      metrics,
    )["--tt-" + column];
  // One column is the first and the last cell: --sp-5 on both sides.
  assert.equal(style("actions", "placement", "A".repeat(30)), 180 + 40 + "px");
  assert.equal(style("buttons", "mux", "A".repeat(30)), 180 + 40 + "px");
  assert.equal(style("actions", "filecheck", "Info"), 2 * 28 + 4 + 40 + "px");
  assert.equal(
    style("service", "placement", "A".repeat(30)),
    180 + 21 + 40 + "px",
  );
});

test("commands without selection explain current-filter scope and offer only all-matches download", async () => {
  let downloaded = 0;
  const h = componentHarness("FileCheckCommandsDialog", {
    text: "",
    hostPaths: true,
    total: 1200,
    downloadAll: () => {
      downloaded++;
    },
    close() {},
  });
  const tree = h.render();
  assert.match(text(tree), /No findings selected.*1200 findings/);
  assert.equal(find(tree, "pre"), undefined);
  assert.equal(find(tree, "button", "Copy"), undefined);
  const footer = nodes(tree).find(
    (node) => node.props?.class === "modal-actions",
  );
  assert.equal(
    text(footer.props.children[0]),
    "Download script for all 1200 matches",
  );
  await find(
    tree,
    "button",
    "Download script for all 1200 matches",
  ).props.onClick();
  assert.equal(downloaded, 1);
});

test("selected commands keep complete copy payload alongside all-matches action", async () => {
  const script = Array.from({ length: 501 }, (_, i) => `# row ${i}`).join("\n");
  let copied;
  const h = componentHarness(
    "FileCheckCommandsDialog",
    {
      text: script,
      hostPaths: true,
      total: 1200,
      downloadAll() {},
      close() {},
    },
    {
      browser: {
        navigator: {
          clipboard: {
            writeText: async (value) => {
              copied = value;
            },
          },
        },
      },
    },
  );
  const tree = h.render();
  assert.equal(text(find(tree, "pre")).split("\n").length, 50);
  await find(tree, "button", "Copy").props.onClick();
  assert.equal(copied, script);
  assert.ok(find(h.render(), "button", "Download script for all 1200 matches"));
});

test("filter footer places CSV between page tools and help", () => {
  const slot = (label) => ({ type: "button", props: { children: label } });
  const h = componentHarness(
    "ToolFilters",
    {
      chips: [{ key: "q", label: "Search", remove() {} }],
      reset() {},
      tools: slot("Report"),
      export: slot("CSV"),
      help: slot("Help"),
    },
    { exportName: "ActiveFilterBar" },
  );
  const footer = nodes(h.render()).find(
    (node) => node.props?.class === "filter-footer-tools",
  );
  const labels = nodes(footer.props.children)
    .filter((node) => node.type === "button")
    .map((node) => node.props["aria-label"] || text(node));
  assert.deepEqual([...labels], ["Reset filters", "Report", "CSV", "Help"]);
});

test("scan blocking reasons live beside the disabled action in the footer", () => {
  const h = componentHarness(
    "PlacementScanDialog",
    {
      libraries: [],
      options: { excludedDisks: [], libraries: [], reserveGB: 10 },
      service: { ready: true, disks: [] },
      busy: false,
      active: true,
      update() {},
      editDisks() {},
      start() {},
      close() {},
    },
    { modules: { "../instances": { instanceLabel: (c) => c.name } } },
  );
  const tree = h.render();
  const footer = nodes(tree).find((n) => n.props?.class === "modal-actions");
  assert.match(text(footer), /Finish or cancel moves first/);
  assert.equal(find(footer, "button", "Scan").props.disabled, true);
  assert.equal(
    nodes(tree).filter(
      (n) => n.type === "p" && text(n) === "Finish or cancel moves first",
    ).length,
    1,
  );
});
