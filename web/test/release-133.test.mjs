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

test("each tool visit starts collapsed and removes only its obsolete preference", () => {
  // The 1.7.0 filter panel starts collapsed; Muxing's filter drawer
  // (Phase 5b) starts closed.
  const collapsed = /\[collapsed, setCollapsed\] = useState\(true\)/;
  for (const [page, key, closed] of [
    ["DiskPlacementPage", "scopearr-placement-collapsed", collapsed],
    ["FileCheckPage", "scopearr-filecheck-collapsed", collapsed],
    [
      "MuxPage",
      "scopearr-mux-filter-collapsed",
      /\[drawer, setDrawer\] = useState<HTMLElement \| null>\(null\)/,
    ],
  ]) {
    const code = src("components/" + page + ".tsx");
    assert.match(code, closed);
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
