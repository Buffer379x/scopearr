import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { placementCompact, placementReportNotices } from "../src/placement.ts";
const src = (p) =>
  readFileSync(new URL("../src/" + p, import.meta.url), "utf8");
const between = (code, from, to) => {
  const start = code.indexOf(from);
  assert.ok(start >= 0, from);
  const end = code.indexOf(to, start);
  assert.ok(end > start, to);
  return code.slice(start, end);
};

test("one-device placement rows are compact and show no size", () => {
  assert.equal(
    placementCompact({
      scanStatus: "ok",
      disks: { disk3: { bytes: 0, files: 0, dirs: 0 } },
    }),
    true,
  );
  assert.equal(
    placementCompact({
      scanStatus: "ok",
      disks: { disk3: { bytes: 10, files: 1, dirs: 1 } },
    }),
    false,
  );
  assert.equal(
    placementCompact({
      scanStatus: "split",
      disks: { disk3: { bytes: 0, files: 0, dirs: 0 } },
    }),
    false,
  );
  const page = src("components/DiskPlacementPage.tsx");
  assert.match(page, /placementCompact\(item\)\s*\?\s*"—"/);
  assert.match(page, /No Radarr\/Sonarr entry/);
  assert.match(page, /"no_arr", "Without Arr entry"/);
});

test("the report explains shares and its icon marks notices", () => {
  const finished = { finishedAt: "2026-10-24T00:00:00Z" };
  assert.equal(placementReportNotices(undefined), false);
  assert.equal(
    placementReportNotices({
      ...finished,
      shares: [{ shareDir: "documentaries", deviceErrors: [] }],
      rootFolders: [{ status: "resolved" }],
    }),
    false,
  );
  assert.equal(
    placementReportNotices({
      ...finished,
      shares: [],
      rootFolders: [{ status: "unresolved" }],
    }),
    true,
  );
  assert.equal(
    placementReportNotices({
      ...finished,
      shares: [{ shareDir: "x", notice: "empty", deviceErrors: [] }],
      rootFolders: [],
    }),
    true,
  );
  const dialogs = src("components/PlacementDialogs.tsx");
  for (const label of [
    "Share folder",
    "Folders on disks",
    "On several disks",
    "Without Arr entry",
    "Arr entries without folder",
    "Device errors",
  ])
    assert.match(dialogs, new RegExp('"' + label + '"'));
  assert.match(dialogs, /Open in settings/);
});

test("tool pages render no result-dependent box between filters and results", () => {
  for (const page of ["DiskPlacementPage", "FileCheckPage"]) {
    const code = src("components/" + page + ".tsx");
    const end = code.indexOf('<section class="library-section">');
    const flow = code.slice(code.lastIndexOf("</section>", end), end);
    assert.doesNotMatch(flow, /SkippedRootsNotice|class="notice"/);
    assert.doesNotMatch(code, /setError\(/);
    assert.match(code, /useScanErrorToast\(/);
    assert.match(code, /notification-dot/);
    assert.match(code, /Scan report · contains notices/);
  }
  const files = src("components/FileCheckPage.tsx");
  const report = between(files, 'title={t("Scan report")}', "By kind");
  assert.match(report, /SkippedRootsNotice/);
  assert.doesNotMatch(
    src("components/DiskPlacementPage.tsx"),
    /SkippedRootsNotice/,
  );
});

test("the shares card lists only Arr root folders and saves choices", () => {
  const card = src("components/UnraidShares.tsx");
  assert.match(card, /"unraid\/shares"/);
  assert.match(card, /"unraid\/share-dirs"/);
  assert.match(card, /Do not scan/);
  assert.match(card, /Choose subfolder …/);
  assert.match(src("components/UnraidSettings.tsx"), /<UnraidShares/);
});

test("dialogs close after a successful save", () => {
  const mux = src("components/MuxPage.tsx");
  assert.match(
    mux,
    /await save\(job\);[\s\S]{0,120}setDialog\(undefined\)/,
    "mux options close after saving",
  );
  assert.match(
    src("components/RecognitionPage.tsx"),
    /if \(ok\) setEditing\(null\)/,
  );
  assert.match(src("hooks/useToolPresets.tsx"), /setOpen\(false\)/);
  assert.match(src("components/Library.tsx"), /setSavePreset\(false\)/);
  assert.match(
    src("components/FileCheckPage.tsx"),
    /save\(lines\(allowed\), lines\(ignore\)\);\s*close\(\);/,
  );
});
