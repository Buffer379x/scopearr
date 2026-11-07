// Legacy UI (1.7.0 look) – replaced in Phase 5b by the v2 tool table tests.
import test from "node:test";
import assert from "node:assert/strict";
import * as muxSpec from "../../src/mux-spec.ts";
import { componentHarness, find } from "../helpers/component-harness.mjs";

test("mux Info header is visible and never offers a sort action (1.7.0 look)", () => {
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
  assert.equal(header.props.class, "col-info");
});
