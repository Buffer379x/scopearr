import test from "node:test";
import assert from "node:assert/strict";
import { placementSelectable } from "../src/placement.ts";
import { placementMessage } from "../src/placement-messages.ts";
import { processMuxSelection } from "../src/mux-selection.ts";

test("legacy mover rows require recheck and cannot be queued", () => {
  assert.equal(
    placementSelectable({
      scanStatus: "waiting_for_mover",
      target: "disk1",
      jobStatus: "",
    }),
    false,
  );
  assert.equal(
    placementSelectable({
      scanStatus: "split",
      target: "disk1",
      jobStatus: "",
    }),
    true,
  );
});
test("source blockers and new cache targets translate their dynamic values", () => {
  const tr = (key, p) => [key, p];
  assert.deepEqual(
    placementMessage("2 files are not readable by Scopearr (99:100)", tr),
    ["{count} files are not readable by Scopearr (99:100)", { count: 2 }],
  );
  assert.deepEqual(
    placementMessage("3 files cannot be removed from disk1, cache", tr),
    [
      "{count} files cannot be removed from {disk}",
      { count: 3, disk: "disk1, cache" },
    ],
  );
  assert.deepEqual(
    placementMessage("Target disk2 is new for this folder", tr),
    ["Target {disk} is new for this folder", { disk: "disk2" }],
  );
  assert.deepEqual(
    placementMessage(
      "This share keeps files on fast (Use cache: prefer). Disk placement does not move them to the array.",
      tr,
    ),
    [
      "This share keeps files on {pool} (Use cache: {value}). Disk placement does not move them to the array.",
      { pool: "fast", value: "prefer" },
    ],
  );
});
test("mux job selection removes one normal job and skips all three protected states", async () => {
  const jobs = [
    { id: 1, service: "radarr", fileId: 1, status: "running" },
    { id: 2, service: "radarr", fileId: 2, status: "queued" },
    {
      id: 3,
      service: "radarr",
      fileId: 3,
      status: "succeeded",
      backupName: "backup.mkv",
    },
    { id: 4, service: "radarr", fileId: 4, status: "ready" },
  ];
  const calls = [],
    updates = [];
  const result = await processMuxSelection(
    jobs.map((j) => ({ service: j.service, id: j.fileId })),
    jobs,
    true,
    async (path, method) => calls.push([path, method]),
    (n) => updates.push(n),
  );
  assert.deepEqual(calls, [["mux/jobs?id=4", "DELETE"]]);
  assert.deepEqual(updates, [1, 2, 3, 4]);
  assert.deepEqual(result, {
    done: 4,
    total: 4,
    ok: 1,
    failed: 0,
    skipped: 3,
    reason: "",
  });
});

test("mux selection includes drafts and protected rows for bulk removal", async () => {
  const { muxSelection } = await import("../src/mux-spec.ts");
  const jobs = [
    { id: 1, status: "draft" },
    { id: 2, status: "running" },
    { id: 3, status: "queued" },
    { id: 4, status: "succeeded", backupName: "backup" },
    { id: 5, status: "ready" },
  ];
  assert.deepEqual(muxSelection(jobs, [1, 3]), {
    ids: [1, 2, 3, 4, 5],
    all: false,
    partial: true,
  });
});
