import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  placementDiskTone,
  placementDisksBySize,
  placementSelectable,
  placementStartable,
  placementStatusShort,
  placementStatusLabels,
  placementStatusTone,
  placementColumns,
} from "../src/placement.ts";
import { muxSortJobs, muxSortable } from "../src/mux-spec.ts";
import {
  fileCheckFixable,
  fileCheckFixLabel,
  fileCheckModeText,
  fileCheckOrderedColumns,
  fileCheckColumns,
  fileCheckStatus,
  filesTabVisible,
  defaultFileCheckSettings,
} from "../src/filecheck.ts";
import { decimalBytes, decimalGB } from "../src/units.ts";
const src = (path) =>
  readFileSync(new URL("../src/" + path, import.meta.url), "utf8");

test("sizes use decimal units", () => {
  assert.equal(decimalGB(1e9, "en"), "1 GB");
  assert.equal(decimalGB(1.5e9, "de"), "1,5 GB");
  assert.equal(decimalBytes(999, "en"), "999 B");
  assert.equal(decimalBytes(1.5e6, "en"), "1.5 MB");
  assert.equal(decimalBytes(2e12, "en"), "2 TB");
  for (const path of ["ui.tsx", "components/FilterPanel.tsx"])
    assert.doesNotMatch(src(path), /1024 \*\*|GiB|MiB|KiB/, path);
});

test("disk tags: target green, sources orange, deterministic size order", () => {
  const item = {
    target: "disk2",
    disks: {
      disk1: { bytes: 10 },
      disk2: { bytes: 500 },
      disk3: { bytes: 80 },
    },
  };
  assert.equal(placementDiskTone(item, "disk2"), "target");
  assert.equal(placementDiskTone(item, "disk1"), "source");
  assert.equal(placementDiskTone(item, "disk3"), "source");
  assert.deepEqual(
    placementDisksBySize(item).map(([disk]) => disk),
    ["disk2", "disk3", "disk1"],
  );
  assert.equal(
    placementDiskTone({ target: "", disks: { disk6: { bytes: 4 } } }, "disk6"),
    "target",
  );
  const tie = {
    target: "",
    disks: { disk1: { bytes: 5 }, disk2: { bytes: 5 } },
  };
  assert.equal(placementDiskTone(tie, "disk1"), "target");
  assert.equal(placementDiskTone(tie, "disk2"), "source");
});

test("legacy mover items cannot start until rechecked", () => {
  const mover = {
    scanStatus: "waiting_for_mover",
    target: "disk6",
    jobStatus: "",
  };
  assert.equal(placementStartable(mover), false);
  assert.equal(placementSelectable(mover), false);
  assert.equal(placementSelectable({ ...mover, target: "" }), false);
  assert.equal(placementSelectable({ ...mover, jobStatus: "queued" }), false);
  assert.ok(placementColumns.includes("remove"));
});

test("short placement status tags keep long labels and a tone for every status", () => {
  for (const key of Object.keys(placementStatusLabels)) {
    assert.ok(placementStatusShort[key], key);
    assert.ok(placementStatusTone[key], key);
    assert.ok(
      placementStatusShort[key].length <= placementStatusLabels[key].length,
      key,
    );
  }
  assert.equal(placementStatusShort.waiting_for_mover, "Mover");
});

test("disk placement page drops kind/sort dropdowns, row speed and old log icon", () => {
  const page = src("components/DiskPlacementPage.tsx");
  assert.doesNotMatch(page, /SquareTerminal|setOrder|\{bytes\(speed\)\}\/s/);
  assert.match(page, /<Terminal size=\{ICON.row\}/);
  assert.match(page, /"placement\/start", "POST", \{\s*ids:\s*targets\s*\}/);
});

test("mux sorting is display-only and cycles fields", () => {
  const jobs = [
    {
      id: 1,
      status: "succeeded",
      sourceName: "b.mkv",
      source: { size: 5 },
      progress: 0,
      createdAt: "2026-01-01",
      service: "radarr",
    },
    {
      id: 2,
      status: "running",
      sourceName: "a.mkv",
      source: { size: 9 },
      progress: 40,
      createdAt: "2026-01-02",
      service: "sonarr",
    },
    {
      id: 3,
      status: "ready",
      sourceName: "c.mkv",
      source: { size: 1 },
      progress: 0,
      createdAt: "2026-01-03",
      service: "radarr",
    },
  ];
  assert.deepEqual(
    muxSortJobs(jobs, null).map((j) => j.id),
    [2, 3, 1],
  );
  assert.deepEqual(
    muxSortJobs(jobs, { field: "filename", direction: "asc" }).map((j) => j.id),
    [2, 1, 3],
  );
  assert.deepEqual(
    muxSortJobs(jobs, { field: "size", direction: "desc" }).map((j) => j.id),
    [2, 1, 3],
  );
  assert.deepEqual(
    muxSortJobs(jobs, { field: "progress", direction: "desc" }).map(
      (j) => j.id,
    ),
    [1, 2, 3],
  );
  assert.ok(muxSortable.has("status") && !muxSortable.has("select"));
});

test("sortable header cycles ascending, descending and default", async () => {
  const header = src("components/SortableHeader.tsx");
  assert.match(
    header,
    /current\?\.field !== field\) return \{ field, direction: "asc" \}/,
  );
  assert.match(
    header,
    /direction === "asc" \? \{ field, direction: "desc" \} : null/,
  );
});

test("file check helpers", () => {
  assert.equal(fileCheckModeText(0o644, false), "-rw-r--r--");
  assert.equal(fileCheckModeText(2 ** 31 + 0o755, true), "drwxr-xr-x");
  assert.equal(fileCheckStatus({ jobStatus: "", fix: "manual" }), "manual");
  assert.equal(fileCheckStatus({ jobStatus: "", fix: "delete" }), "open");
  assert.equal(
    fileCheckStatus({ jobStatus: "succeeded", fix: "delete" }),
    "succeeded",
  );
  assert.equal(fileCheckFixable({ fix: "manual", jobStatus: "" }), false);
  assert.equal(fileCheckFixable({ fix: "chmod", jobStatus: "failed" }), true);
  assert.equal(
    fileCheckFixLabel({ fix: "chmod", dir: true }, defaultFileCheckSettings),
    "chmod 777",
  );
  assert.equal(
    fileCheckFixLabel({ fix: "chmod", dir: false }, defaultFileCheckSettings),
    "chmod 666",
  );
  assert.equal(filesTabVisible({ files: { available: true } }), true);
  assert.equal(filesTabVisible({}), false);
  assert.deepEqual(fileCheckOrderedColumns(null), fileCheckColumns);
  assert.deepEqual(
    fileCheckOrderedColumns({
      filecheckColumnOrder: ["kind", "select", "title"],
      filecheckVisibleColumns: ["select", "kind"],
    }),
    ["select", "kind"],
  );
});

test("navigation groups tools and lists services under movies and series", () => {
  const library = src("components/Library.tsx");
  assert.match(library, /t\("Tools"\)/);
  assert.match(library, /"All movies"/);
  assert.match(library, /instanceLabel\(instance\)/);
  for (const key of ["mux", "disks", "files"])
    assert.match(library, new RegExp(`key: "${key}"`));
  assert.doesNotMatch(src("components/FilterPanel.tsx"), /instance-filter/);
  const menu = src("components/NavMenu.tsx");
  for (const key of ["Escape", "ArrowDown", "ArrowUp", "Home", "End"])
    assert.match(menu, new RegExp(`"${key}"`));
  assert.match(menu, /aria-haspopup="menu"/);
});

test("file check fix all never sends untracked selections implicitly", () => {
  const page = src("components/FileCheckPage.tsx");
  assert.match(page, /results\.selectableIds\.filter/);
  assert.match(page, /fix\(selectedFixable\)/);
  assert.match(page, /confirmDeletion/);
});
