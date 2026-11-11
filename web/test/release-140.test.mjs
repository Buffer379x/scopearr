import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { sep } from "node:path";
import { translate } from "../src/i18n-core.ts";
import { toolColumn, openJobCount, muxOpenJobs } from "../src/tool-table.ts";
import {
  readSessionPreference,
  writeSessionPreference,
} from "../src/browser-storage.ts";
import { loadSource } from "./helpers/component-harness.mjs";
const src = (path) =>
  readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
test("plural selection handles zero, one and two and preserves legacy fallback", () => {
  const en = JSON.parse(src("locales/en.json"));
  for (const locale of ["en", "de"]) {
    const c = JSON.parse(src("locales/" + locale + ".json"));
    for (const n of [0, 1, 2]) {
      const expected =
        locale === "de"
          ? n === 1
            ? "Datei"
            : "Dateien"
          : n === 1
            ? "file"
            : "files";
      assert.equal(
        translate(c, en, "{count} files", { count: n }),
        n + " " + expected,
      );
    }
    assert.equal(
      translate(c, en, "{count} files", { count: 1234 }).startsWith(
        new Intl.NumberFormat(locale).format(1234),
      ),
      true,
    );
  }
  assert.equal(
    translate(
      { locale: "de", name: "DE", messages: { legacy: "{count} alt" } },
      en,
      "legacy",
      { count: 1 },
    ),
    "1 alt",
  );
});
test("open tools count only explicit pending, running and actionable failure states", () => {
  const jobs = [
    "draft",
    "ready",
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "needs_attention",
    "needs_review",
    "future",
  ].map((status) => ({ status }));
  assert.equal(muxOpenJobs(jobs), 7);
  assert.equal(openJobCount({ pending: 3, running: 1, failed: 3 }), 7);
  assert.equal(openJobCount(undefined), 0);
  assert.equal(
    openJobCount({ pending: 2 }) + openJobCount({ running: 1, failed: 2 }),
    5,
  );
});
test("column geometry depends on column choices and keeps mobile details accessible", () => {
  // The v2 widths (tool-columns.ts; the 1.7.0 toolTableStyle left in
  // Phase 5b, Task 9): the columns chosen sum up to the table's minimum, and
  // at ≤ 739 Info keeps one button (Details) and Actions one (Remove).
  const cols = ["select", "actions", "title", "status", "remove"];
  const geometry = loadSource("tool-columns.ts", {
    modules: {
      "./filecheck": {},
      "./mux-spec": {},
      "./placement": {},
      "./ui": { ICON: { arrow: 11 } },
    },
  });
  const metrics = {
    header: (label) => label.length * 6,
    tag: (text) => text.length * 6 + 24,
    button: 28,
    gap: 4,
    pad: 8,
    edge: 20,
    select: 44,
    title: 200,
    sort: 21,
    status: 116,
  };
  const style = geometry.toolColumnStyle(
    cols,
    "placement",
    {},
    [],
    { info: 2, actions: 2, infoPhone: 1, actionsPhone: 1 },
    metrics,
  );
  // select 44 · Info 2 × 28 + 4 + 16 · title 200 + 16 · status 116 + 16 ·
  // Actions 2 × 28 + 4 + 8 + 20.
  assert.equal(style["--tt-min"], 44 + 76 + 216 + 132 + 88 + "px");
  assert.equal(style["--tt-min-phone"], 44 + 44 + 216 + 132 + 56 + "px");
  assert.equal(toolColumn("filename", "mux"), "title");
  assert.equal(toolColumn("actions", "mux"), "remove");
  // Muxing, Disk placement and Files & permissions (Phase 5b): the tool
  // table's colgroup, its widths measured from the labels
  // (useToolColumnStyle).
  assert.match(src("components/tools/ToolTable.tsx"), /<colgroup>/);
  assert.match(src("components/MuxPage.tsx"), /useToolColumnStyle\(/);
  assert.match(src("components/DiskPlacementPage.tsx"), /useToolColumnStyle\(/);
  assert.match(src("components/DiskPlacementPage.tsx"), /<ToolTable/);
  assert.match(src("components/FileCheckPage.tsx"), /useToolColumnStyle\(/);
  assert.match(src("components/FileCheckPage.tsx"), /<ToolTable/);
});
test("interface recipes apply appwide, including settings, without override stylesheets", () => {
  // Every component, frame/ included.
  const paths = readdirSync(new URL("../src/components/", import.meta.url), {
    recursive: true,
  })
    .map((x) => x.split(sep).join("/"))
    .filter((x) => x.endsWith(".tsx"));
  assert.ok(paths.includes("frame/Sidebar.tsx"), "reads frame/");
  for (const path of paths)
    assert.doesNotMatch(src("components/" + path), /size=\{\d+\}/, path);
});
test("navigation survives auth remounts through the hash and blocked session storage remains optional", () => {
  // The route is read from the hash, which survives a sign-in; router.ts has
  // imports, so it runs through loadSource.
  const browserStorage = loadSource("browser-storage.ts"),
    eventLog = loadSource("event-log.ts");
  const toolRoute = loadSource("tool-route.ts", {
    modules: { "./browser-storage": browserStorage },
  });
  const { parseRoute } = loadSource("router.ts", {
    modules: { "./tool-route": toolRoute, "./event-log": eventLog },
  });
  assert.equal(parseRoute("#/tools/placement").view, "disks");
  const library = parseRoute("#/movies?instance=radarr-4k&page=3");
  assert.equal(library.page, 3);
  assert.equal(library.filters, "instance=radarr-4k");
  for (const broken of ["", "#{", "#/nope", "#/%E0%A4%A"])
    assert.equal(parseRoute(broken).view, "statistics", broken);
  const before = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  try {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw Error("blocked");
      },
    });
    assert.equal(readSessionPreference("scopearr-library-filters"), null);
    assert.doesNotThrow(() => writeSessionPreference("key", "value"));
  } finally {
    if (before) Object.defineProperty(globalThis, "sessionStorage", before);
    else delete globalThis.sessionStorage;
  }
});
