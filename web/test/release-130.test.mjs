import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  disksTabVisible,
  placementStartable,
  placementSelection,
  placementOrderedColumns,
  placementColumns,
  placementScanCompleted,
  placementDuration,
} from "../src/placement.ts";
import { placementMessage } from "../src/placement-messages.ts";
import { settingsPayload } from "../src/settings-payload.ts";
const item = (id, patch = {}) => ({
  id,
  scanStatus: "split",
  target: "disk6",
  jobStatus: "",
  kind: "small_files",
  moveBytes: id,
  ...patch,
});
test("disk placement is visible only with an enabled service, including older status responses", () => {
  assert.equal(disksTabVisible({}), false);
  assert.equal(disksTabVisible({ unraid: { enabled: false } }), false);
  assert.equal(disksTabVisible({ unraid: { enabled: true } }), true);
});
test("selection includes only ready items and reports partial visible selection", () => {
  const items = [
    item(1),
    item(2, { scanStatus: "conflict" }),
    item(3),
    item(4, { jobStatus: "running" }),
    item(5, { jobStatus: "needs_review" }),
    item(6, { jobStatus: "cancelled" }),
    item(7, { jobStatus: "failed" }),
  ];
  assert.deepEqual(placementSelection(items, [1, 2]), {
    ids: [1, 3, 7],
    all: false,
    partial: true,
  });
  assert.deepEqual(placementSelection(items, [1, 3, 7]), {
    ids: [1, 3, 7],
    all: true,
    partial: false,
  });
  assert.equal(placementStartable(item(1, { target: "" })), false);
});
test("selection stays first while configurable placement columns retain their saved order", () => {
  assert.deepEqual(placementOrderedColumns(null), placementColumns);
  const settings = {
    placementColumnOrder: ["progress", "select", "title", "target"],
    placementVisibleColumns: ["select", "progress", "target"],
  };
  assert.deepEqual(placementOrderedColumns(settings), [
    "select",
    "progress",
    "target",
  ]);
  assert.deepEqual(settingsPayload(settings), settings);
});
test("summary opens once for a completed scan observed while the page is open", () => {
  assert.equal(
    placementScanCompleted(undefined, {
      running: false,
      finishedAt: "existing",
    }),
    false,
  );
  assert.equal(
    placementScanCompleted("existing", {
      running: true,
      finishedAt: "existing",
    }),
    false,
  );
  assert.equal(
    placementScanCompleted("existing", { running: false, finishedAt: "new" }),
    true,
  );
  assert.equal(
    placementScanCompleted("new", { running: false, finishedAt: "new" }),
    false,
  );
  assert.equal(
    placementScanCompleted("", { running: false, finishedAt: "" }),
    false,
  );
  assert.equal(placementDuration(52.42), "53 s");
  assert.equal(placementDuration(120), "2 min");
});
test("dynamic statuses preserve filenames, disk names and cancellation counts in all locales", () => {
  for (const locale of ["en", "de", "es", "it"]) {
    const messages = JSON.parse(
      readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url)),
    ).messages;
    const translate = (key, p = {}) =>
      (messages[key] || key).replace(/\{(\w+)\}/g, (_, name) =>
        String(p[name]),
      );
    assert.ok(placementMessage("Moved to disk6", translate).includes("disk6"));
    const partial = placementMessage(
      "Partially moved: 2 of 3 files. Check again to continue.",
      translate,
    );
    assert.ok(partial.includes("2") && partial.includes("3"));
    assert.ok(
      placementMessage('Moving "Film.nfo"', translate).includes("Film.nfo"),
    );
    for (const key of [
      "Disk placement",
      "Scan report",
      "Write mux output to the original's disk",
      "Verify copies with checksums (slower)",
    ])
      assert.ok(messages[key]);
  }
});
