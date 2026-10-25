import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  effectiveMuxStatus,
  muxSelection,
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
  assert.deepEqual(muxSelection(jobs, []), {
    ids: [0, 1, 2, 3, 4, 5, 6],
    all: false,
    partial: false,
  });
  assert.equal(muxSelection(jobs, [1]).partial, true);
  assert.equal(muxSelection(jobs, [0, 1, 2, 3, 4, 5, 6]).all, true);
  assert.equal(muxSelection([], []).all, false);
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
const luminance = (hex) => {
  if (hex.length === 4)
    hex = "#" + [...hex.slice(1)].map((c) => c + c).join("");
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
};
test("mux status colors meet 4.5:1 in dark and light themes", () => {
  const css = readFileSync(
    new URL("../src/styles/base.css", import.meta.url),
    "utf8",
  );
  for (const block of css.matchAll(
    /(?::root|:root\[data-theme="light"\])\s*\{([^}]+)\}/g,
  )) {
    const vars = Object.fromEntries(
      [...block[1].matchAll(/--([\w-]+):\s*(#[a-f0-9]{3,6});/g)].map((m) => [
        m[1],
        m[2],
      ]),
    );
    const panel =
      vars.panel.length === 4
        ? "#" + [...vars.panel.slice(1)].map((v) => v + v).join("")
        : vars.panel;
    for (const key of [
      "status-ok",
      "status-warn",
      "status-error",
      "status-info",
      "status-wait",
    ]) {
      const a = luminance(vars[key]),
        b = luminance(
          key === "status-wait"
            ? "#" +
                [1, 3, 5]
                  .map((i) =>
                    Math.round(
                      parseInt(vars[key].slice(i, i + 2), 16) * 0.08 +
                        parseInt(panel.slice(i, i + 2), 16) * 0.92,
                    )
                      .toString(16)
                      .padStart(2, "0"),
                  )
                  .join("")
            : vars.panel,
        );
      assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, key);
    }
  }
});
