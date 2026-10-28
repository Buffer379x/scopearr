import test from "node:test";
import assert from "node:assert/strict";
import { toolTableStyle } from "../src/tool-table.ts";
import * as muxSpec from "../src/mux-spec.ts";
import {
  componentHarness,
  find,
  nodes,
  text,
} from "./helpers/component-harness.mjs";

test("Info column widths measure long headings without adding a sort icon", () => {
  const oldDocument = globalThis.document,
    oldStyle = globalThis.getComputedStyle;
  globalThis.document = {
    documentElement: {},
    body: {},
    createElement: () => ({
      getContext: () => ({
        measureText: (value) => ({ width: value.length * 6 }),
      }),
    }),
  };
  globalThis.getComputedStyle = () => ({
    getPropertyValue: () => "",
    fontFamily: "sans-serif",
  });
  try {
    assert.equal(
      toolTableStyle(["actions"], "placement", { actions: "A".repeat(30) })[
        "--tool-col-actions"
      ],
      "205px",
    );
    assert.equal(
      toolTableStyle(["buttons"], "mux", { buttons: "A".repeat(30) })[
        "--tool-col-actions"
      ],
      "205px",
    );
    assert.equal(
      toolTableStyle(["actions"], "filecheck", { actions: "Info" })[
        "--tool-col-actions"
      ],
      "88px",
    );
    assert.equal(
      toolTableStyle(["actions"], "mux", { actions: "A".repeat(30) })[
        "--tool-col-remove"
      ],
      "52px",
    );
  } finally {
    globalThis.document = oldDocument;
    globalThis.getComputedStyle = oldStyle;
  }
});

test("mux Info header is visible and never offers a sort action", () => {
  const h = componentHarness(
    "MuxTable",
    {
      jobs: [],
      names: {},
      columns: ["buttons"],
      selected: [],
      busy: false,
      removing: new Set(),
      setSelected() {},
      options() {},
      terminal() {},
      status() {},
      remove() {},
      sort: null,
      sortBy() {},
    },
    {
      modules: {
        "../tool-table": {
          toolColumn: (field) => (field === "buttons" ? "actions" : field),
        },
        "../use-tool-table": { useToolTableStyle: () => ({}) },
        "../mux-spec": muxSpec,
        "./MuxStatusDialog": { MuxStatusTag: "MuxStatusTag" },
        "./SortableHeader": { SortableHeader: "SortableHeader" },
        "./CompactProgress": { CompactProgress: "CompactProgress" },
      },
    },
  );
  const header = find(h.render(), "th");
  assert.equal(text(header), "Info");
  assert.equal(header.props.class, "col-info");
  assert.equal(
    nodes(header).some((node) => node.type === "button"),
    false,
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

test("empty CSV export is an inert accessible link, populated export retains its exact query", () => {
  const h = componentHarness(
    "ToolFilters",
    {},
    { exportName: "ActiveFilterBar" },
  );
  const disabled = h.exports.CSVExport?.({
    href: "/api/export?q=Movie",
    enabled: false,
  });
  assert.equal(disabled?.type, "span");
  assert.equal(disabled.props.role, "link");
  assert.equal(disabled.props["aria-disabled"], true);
  assert.equal(disabled.props["aria-label"], "Export CSV");
  assert.equal(disabled.props.href, undefined);
  assert.equal(disabled.props.onClick, undefined);
  const enabled = h.exports.CSVExport({
    href: "/api/export?q=Movie&sort=title&dir=desc",
    enabled: true,
  });
  assert.equal(enabled.type, "a");
  assert.equal(enabled.props.href, "/api/export?q=Movie&sort=title&dir=desc");
  assert.equal(enabled.props.download, true);
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
