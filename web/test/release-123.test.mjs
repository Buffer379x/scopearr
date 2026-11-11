import test from "node:test";
import assert from "node:assert/strict";
import {
  effectiveMuxStatus,
  muxStartable,
  muxColumns,
  importMuxRoots,
  muxLogClass,
} from "../src/mux-spec.ts";
const check = {
  exists: true,
  readable: true,
  writable: true,
  freeSpace: true,
  workWritable: true,
  workFreeSpace: true,
  sizeMatches: true,
  unchanged: true,
};
test("mux statuses preserve active and terminal states; warnings only override editable jobs", () => {
  for (const status of [
    "draft",
    "ready",
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "needs_review",
    "needs_attention",
  ]) {
    assert.equal(effectiveMuxStatus({ status, check }), status);
    assert.equal(
      effectiveMuxStatus({ status, check: { ...check, readable: false } }),
      ["draft", "ready", "failed", "cancelled"].includes(status)
        ? "warning"
        : status,
    );
  }
  for (const key of Object.keys(check))
    assert.equal(
      effectiveMuxStatus({
        status: "ready",
        check: { ...check, [key]: false },
      }),
      "warning",
    );
});
test("mux selection includes all job states while start eligibility stays separate", () => {
  const jobs = [
    "draft",
    "ready",
    "failed",
    "cancelled",
    "running",
    "queued",
    "needs_review",
  ].map((status, id) => ({ id, status }));
  assert.deepEqual(
    jobs.filter(muxStartable).map((j) => j.id),
    [1, 2, 3],
  );
  // The selection of every state and its page box (all, partial, none)
  // are the v2 ToolTable's since Phase 5b (muxSelection left with
  // MuxTable): mux-page.test.mjs "mux selection starts only startable
  // jobs and confirms more than one" (every state selectable) and
  // tool-table.test.mjs "the page box selects only selectable rows".
});
test("mux columns are fixed in the full default order", () => {
  assert.deepEqual(muxColumns, [
    "select",
    "buttons",
    "filename",
    "size",
    "origin",
    "status",
    "progress",
    "actions",
  ]);
});
test("root import keeps drafts and deduplicates Arr roots", () => {
  const roots = [
    { arrPath: "/movies", suggestion: "/media/movies" },
    { arrPath: "/documentaries", suggestion: "/media/documentaries" },
    { arrPath: "/documentaries", suggestion: "/media/other" },
    { arrPath: "/manual", suggestion: "" },
  ];
  const result = importMuxRoots("/movies/ => /custom", roots);
  assert.equal(
    result.mappings,
    "/movies/ => /custom\n/documentaries => /media/documentaries",
  );
  assert.equal(result.added, 1);
  assert.equal(result.missing.length, 1);
});
test("terminal classifications keep arbitrary tool output as plain text", () => {
  assert.equal(muxLogClass("Warning: x"), "terminal-warning");
  assert.equal(muxLogClass("Error: x"), "terminal-error");
  assert.equal(muxLogClass("Finished: x"), "terminal-success");
  assert.equal(muxLogClass("<script>"), "");
});
