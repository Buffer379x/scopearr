import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = (path) =>
  readFileSync(new URL("../src/" + path, import.meta.url), "utf8");

test("scan report time formats the completed scan and elapsed minutes and seconds", async () => {
  const { scanReportTime } = await import("../src/scan-report.ts");
  const scan = {
    startedAt: "2026-10-26T10:00:00Z",
    finishedAt: "2026-10-26T10:02:03Z",
  };
  const report = scanReportTime(scan, "de");
  assert.equal(report.date, new Date(scan.finishedAt).toLocaleString("de"));
  assert.equal(report.iso, "2026-10-26T10:02:03.000Z");
  assert.equal(report.duration, "2 min 3 s");
  assert.equal(scanReportTime({}, "en"), undefined);
  assert.equal(scanReportTime({ finishedAt: "bad" }, "en"), undefined);
  assert.equal(
    scanReportTime({ finishedAt: scan.finishedAt }, "en").duration,
    "",
  );
  assert.equal(
    scanReportTime({ ...scan, startedAt: "bad" }, "en").duration,
    "",
  );
  assert.equal(
    scanReportTime({ ...scan, startedAt: "2026-10-26T10:03:00Z" }, "en")
      .duration,
    "",
  );
});

test("placement filter panel contains only result filters and Scan opens its options dialog", () => {
  const page = src("components/DiskPlacementPage.tsx");
  const panel = page.slice(
    page.indexOf("{!collapsed && ("),
    page.indexOf("<ActiveFilterBar"),
  );
  assert.doesNotMatch(
    panel,
    /options\.|updateOptions|setEditDisks|Group by|Target disks/,
  );
  for (const title of ["Show", "Status", "Kind"])
    assert.ok(panel.includes(`t("${title}")`));
  assert.match(panel, /<MultiFilter/);
  assert.match(page, /: setScanDialog\(true\)/);
  assert.doesNotMatch(
    page.slice(
      page.indexOf("const startScan"),
      page.indexOf("// The server queues"),
    ),
    /verifyChecksum/,
  );
  assert.match(page, /<PlacementScanDialog/);
  assert.match(page, /next.report \|\| \(!next.scan.running/);
  assert.match(page, /if \(completed\?\.finishedAt\) setReport\(completed\)/);
  assert.match(page, /<PlacementSummaryDialog[\s\S]*?scan=\{report\}/);
  assert.match(page, /counts=\{report.counts\}/);
});

test("placement scan options have ordered sections, inline errors and a moves-disabled start", () => {
  const dialog = src("components/PlacementScanDialog.tsx");
  assert.match(dialog, /<Modal[\s\S]*wide[\s\S]*className="scan-dialog"/);
  assert.ok(dialog.indexOf('t("Services")') < dialog.indexOf('t("TV series")'));
  assert.ok(
    dialog.indexOf('t("TV series")') < dialog.indexOf('t("Target disks")'),
  );
  assert.match(dialog, /instanceLabel/);
  assert.match(dialog, /role="alert"/);
  assert.match(dialog, /Finish or cancel moves first/);
  assert.doesNotMatch(dialog, /verifyChecksum/);
});

test("placement report begins with the completed scan time and shows the running notice", () => {
  const dialog = src("components/PlacementDialogs.tsx");
  const summary = dialog.slice(
    dialog.indexOf("export function PlacementSummaryDialog"),
    dialog.indexOf("function PlacementSharesReport"),
  );
  assert.ok(
    summary.indexOf('t("Scanned at")') < summary.indexOf('["Items checked"'),
  );
  assert.match(summary, /title=\{reportTime\.iso\}/);
  assert.match(
    summary,
    /A new scan is running\. This report shows the previous scan\./,
  );
});
