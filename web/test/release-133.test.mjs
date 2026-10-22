import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { placementDiskTone } from "../src/placement.ts";
import { removePreference } from "../src/browser-storage.ts";

const src = (path) =>
  readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
const tones = (item) =>
  Object.keys(item.disks).map((disk) => placementDiskTone(item, disk));

test("three and four disks have exactly one green target and orange sources", () => {
  for (const count of [3, 4]) {
    const disks = Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        "disk" + (i + 1),
        { bytes: i + 1 },
      ]),
    );
    const values = tones({ disks, target: "disk2" });
    assert.equal(values.filter((v) => v === "target").length, 1);
    assert.equal(values.filter((v) => v === "source").length, count - 1);
    assert.equal(
      placementDiskTone({ disks, target: "disk2" }, "disk2"),
      "target",
    );
    assert.equal(
      placementDiskTone({ disks, target: "disk2" }, "disk" + count),
      "source",
    );
  }
});

test("disk fallback handles absent targets, ties, single disks, pools and missing disks", () => {
  const disks = {
    disk2: { bytes: 5 },
    disk1: { bytes: 5 },
    cache: { bytes: 1 },
  };
  assert.deepEqual(tones({ disks, target: "" }), [
    "source",
    "target",
    "source",
  ]);
  assert.deepEqual(tones({ disks, target: "cache" }), [
    "source",
    "source",
    "target",
  ]);
  assert.deepEqual(tones({ disks: { disk6: { bytes: 0 } }, target: "" }), [
    "target",
  ]);
  assert.equal(placementDiskTone({ disks, target: "disk1" }, "missing"), "");
  assert.equal(placementDiskTone({ disks: {}, target: "" }, "disk1"), "");
});

test("tool footer icons share a centered 32px control without header sizing", () => {
  const component = src("components/ToolFilters.tsx");
  assert.match(component, /filter-footer-tools/);
  assert.doesNotMatch(component, /filter-icon-tools/);
  assert.match(
    src("styles/interface-v2.css"),
    /\.filter-footer-tools \.icon-button,[\s\S]*?\.filter-footer-tools \.inline-help \.icon-button\s*\{[^}]*height: 32px;[^}]*align-items: center;/,
  );
});

test("each tool visit starts collapsed and removes only its obsolete preference", () => {
  for (const [page, key] of [
    ["DiskPlacementPage", "scopearr-placement-collapsed"],
    ["FileCheckPage", "scopearr-filecheck-collapsed"],
    ["MuxPage", "scopearr-mux-filter-collapsed"],
  ]) {
    const code = src("components/" + page + ".tsx");
    assert.match(code, /\[collapsed, setCollapsed\] = useState\(true\)/);
    assert.ok(code.includes(`removePreference("${key}")`));
    assert.ok(!code.includes(`readPreference("${key}")`));
    assert.ok(!code.includes(`writePreference("${key}"`));
  }
});

test("obsolete preference removal works and tolerates blocked storage", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    const values = new Map([
      ["old", "false"],
      ["filters", "keep"],
    ]);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { removeItem: (key) => values.delete(key) },
    });
    removePreference("old");
    assert.deepEqual([...values], [["filters", "keep"]]);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("Storage blocked");
      },
    });
    assert.doesNotThrow(() => removePreference("old"));
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  }
});

test("file check explanations reuse notice typography and removal columns reserve 80px", () => {
  assert.match(
    src("components/FileCheckPage.tsx"),
    /class="notice filecheck-reason"/,
  );
  const css = src("styles/placement.css");
  assert.match(
    css,
    /\.filecheck-reason\s*\{\s*display: block;\s*margin-bottom: 16px;\s*\}/,
  );
  assert.match(
    css,
    /\.mux-table \.col-remove\s*\{[^}]*width: 80px;[^}]*min-width: 80px;[^}]*max-width: 80px;[^}]*padding-left: 12px;[^}]*padding-right: 24px;/,
  );
});
