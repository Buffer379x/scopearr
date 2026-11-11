import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { componentHarness, loadSource } from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { src } from "./helpers/sources.mjs";

// The status tags and the column widths of the tool tables (Phase 5b,
// task 2; docs/STYLEGUIDE.md, Part 1, 10.7 and 10.10): tool-status.ts,
// tool-columns.ts, useToolColumnStyle and useToolMatchCount.

const spec = loadSource("mux-spec.ts", {
  modules: { "./languages.ts": { audioLanguage: () => null } },
});
const placement = loadSource("placement.ts");
const fileCheck = loadSource("filecheck.ts");
const messages = loadSource("placement-messages.ts");
// The column widths' modules: the v2 metrics and the status texts.
const columnModules = {
  "./filecheck": fileCheck,
  "./mux-spec": spec,
  "./placement": placement,
  "./ui": { ICON: { arrow: 11 } },
};
const columns = loadSource("tool-columns.ts", { modules: columnModules });
const status = loadSource("tool-status.ts", {
  modules: {
    "./filecheck": fileCheck,
    "./mux-spec": spec,
    "./placement": placement,
    "./placement-messages": messages,
    "./tool-columns": columns,
  },
});
const plain = (value) => JSON.parse(JSON.stringify(value));
// A translation that marks every text, so a missing t() shows.
const de = (key, values = {}) =>
  "«" + key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "") + "»";
const en = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");

const ok = { readable: true, writable: true };
const bad = { readable: false, writable: true };

// MuxStatusTag (MuxStatusDialog.tsx) as rendered at BASE 658adc4, before
// muxStatusTone replaced its inline map: [class, title, aria-label, text]
// for each status with a passing and a failing check (ruling M20: the
// golden is from before the change).
const MUX_STATUS_TAG_AT_BASE = {
  "warning:ok": ["tag status-warn", "Warning", "Warning", "Warning"],
  "warning:bad": ["tag status-warn", "Warning", "Warning", "Warning"],
  "draft:ok": [
    "tag status-neutral",
    "Not configured",
    "Not configured",
    "Not configured",
  ],
  "draft:bad": ["tag status-warn", "Warning", "Warning", "Warning"],
  "ready:ok": ["tag status-ok", "Ready", "Ready", "Ready"],
  "ready:bad": ["tag status-warn", "Warning", "Warning", "Warning"],
  "queued:ok": ["tag status-wait", "Waiting", "Waiting", "Waiting"],
  "queued:bad": ["tag status-wait", "Waiting", "Waiting", "Waiting"],
  "running:ok": ["tag status-running", "Running", "Running", "Running"],
  "running:bad": ["tag status-running", "Running", "Running", "Running"],
  "succeeded:ok": ["tag status-ok", "Successful", "Successful", "Successful"],
  "succeeded:bad": ["tag status-ok", "Successful", "Successful", "Successful"],
  "failed:ok": ["tag status-error", "Failed", "Failed", "Failed"],
  "failed:bad": ["tag status-warn", "Warning", "Warning", "Warning"],
  "cancelled:ok": ["tag status-neutral", "Cancelled", "Cancelled", "Cancelled"],
  "cancelled:bad": ["tag status-warn", "Warning", "Warning", "Warning"],
  "needs_review:ok": [
    "tag status-warn",
    "Review needed",
    "Review needed",
    "Review",
  ],
  "needs_review:bad": [
    "tag status-warn",
    "Review needed",
    "Review needed",
    "Review",
  ],
  "needs_attention:ok": [
    "tag status-error",
    "Action needed",
    "Action needed",
    "Attention",
  ],
  "needs_attention:bad": [
    "tag status-error",
    "Action needed",
    "Action needed",
    "Attention",
  ],
  "mystery:ok": ["tag status-neutral", "mystery", "mystery", "mystery"],
  "mystery:bad": ["tag status-neutral", "mystery", "mystery", "mystery"],
};

test("mux status views match the 1.7.0 tag", () => {
  // The tones live with the views (tool-status.ts), out of the library
  // chunk, which holds mux-spec (Task 2 review).
  assert.equal(spec.muxStatusTone, undefined);
  assert.deepEqual(plain(status.muxStatusTone), {
    ready: "ok",
    succeeded: "ok",
    warning: "warn",
    needs_review: "warn",
    failed: "error",
    needs_attention: "error",
    queued: "wait",
    running: "running",
  });
  assert.deepEqual(
    plain(status.muxStatusView({ status: "needs_review", check: ok }, en)),
    { tone: "warn", text: "Review", long: "Review needed" },
  );
  assert.deepEqual(
    plain(status.muxStatusView({ status: "failed", check: bad }, de)),
    { tone: "warn", text: "«Warning»", long: "«Warning»" },
  );
  assert.deepEqual(
    plain(status.muxStatusView({ status: "mystery", check: ok }, en)),
    { tone: "neutral", text: "mystery", long: "mystery" },
  );
  // The 1.7.0 tag renders as at BASE, and the view says the same.
  for (const [key, [cls, title, label, text]] of Object.entries(
    MUX_STATUS_TAG_AT_BASE,
  )) {
    const [name, checked] = key.split(":");
    const job = { status: name, check: checked === "ok" ? ok : bad };
    const tag = componentHarness(
      "MuxStatusDialog",
      { job },
      {
        exportName: "MuxStatusTag",
        modules: {
          "../api": { api() {} },
          "../mux-spec": spec,
          "../tool-status": status,
          "./Modal": {},
          "./MuxPathDialog": {},
        },
        stubs: [],
      },
    ).render();
    assert.equal(tag.type, "span", key);
    assert.deepEqual(
      { ...tag.props },
      { class: cls, title, "aria-label": label, children: text },
      key,
    );
    const view = status.muxStatusView(job, en);
    assert.equal("tag status-" + view.tone, cls, key);
    assert.equal(view.text, text, key);
    assert.equal(view.long, title, key);
  }
});

test("queued moves read the mover and parity waits", () => {
  for (const message of [
    "Waiting: mover is running",
    "Waiting: parity operation in progress",
  ]) {
    const view = status.placementStatusView(
      { scanStatus: "split", jobStatus: "queued", message },
      de,
    );
    assert.deepEqual(plain(view), {
      tone: "wait",
      text: "«" + message + "»",
      long: "«Waiting» · «" + message + "»",
    });
  }
  // Another message of a queued job keeps the short text, in the title.
  assert.deepEqual(
    plain(
      status.placementStatusView(
        {
          scanStatus: "split",
          jobStatus: "queued",
          message: "Target disk3 is new for this folder",
        },
        en,
      ),
    ),
    {
      tone: "wait",
      text: "Queued",
      long: "Waiting · Target disk3 is new for this folder",
    },
  );
  // Without a job the scan status counts, with its description.
  assert.deepEqual(
    plain(
      status.placementStatusView(
        { scanStatus: "empty_folders", jobStatus: "", message: "" },
        en,
      ),
    ),
    {
      tone: "info",
      text: "Empty copies",
      long: "Files are on one disk; the other disks only hold empty folders.",
    },
  );
  // A stored check names its blocker; the mover comes first.
  const check = {
    reachable: true,
    writable: true,
    freeSpace: false,
    unchanged: true,
    noConflict: true,
    readable: true,
    removable: true,
    state: { mover: true, parity: false },
  };
  assert.deepEqual(
    plain(
      status.placementStatusView(
        { scanStatus: "split", jobStatus: "", message: "", check },
        de,
      ),
    ),
    {
      tone: "info",
      text: "«Split»",
      long: "«Several disks»",
      blocker: "«Mover is running»",
    },
  );
  assert.equal(
    status.placementStatusView(
      {
        scanStatus: "split",
        jobStatus: "failed",
        message: "",
        check: { ...check, state: { mover: false, parity: false } },
      },
      en,
    ).blocker,
    "Enough free space",
  );
  // Files & permissions: Open, Manual or the job; the message is the title.
  assert.deepEqual(
    plain(
      status.fileCheckStatusView(
        { jobStatus: "", fix: "manual", message: "" },
        en,
      ),
    ),
    { tone: "warn", text: "Manual", long: "Manual" },
  );
  assert.deepEqual(
    plain(
      status.fileCheckStatusView(
        { jobStatus: "failed", fix: "chmod", message: "Permission denied" },
        de,
      ),
    ),
    { tone: "error", text: "«Failed»", long: "«Permission denied»" },
  );
  assert.deepEqual(
    plain(
      status.fileCheckStatusView(
        { jobStatus: "", fix: "delete", message: "" },
        en,
      ),
    ),
    { tone: "ok", text: "Open", long: "Open" },
  );
});

test("status texts cover every tag a tool can show", () => {
  const mux = status.toolStatusTexts("mux", en);
  assert.deepEqual(plain(mux), [
    "Warning",
    "Not configured",
    "Ready",
    "Waiting",
    "Running",
    "Successful",
    "Failed",
    "Cancelled",
    "Review",
    "Attention",
  ]);
  const disks = status.toolStatusTexts("placement", en);
  assert.equal(disks.length, 21);
  for (const text of [
    "Not found",
    "Split",
    "Mover",
    "Queued",
    "Moving",
    "Moved",
    "Attention",
    "Waiting: mover is running",
    "Waiting: parity operation in progress",
  ])
    assert.ok(disks.includes(text), text);
  assert.equal(new Set(disks).size, disks.length, "each text once");
  // One list: tool-status.ts exports the column measurement's own.
  assert.equal(status.toolStatusTexts, columns.toolStatusTexts);
  const files = status.toolStatusTexts("files", en);
  assert.deepEqual(plain(files), [
    "Open",
    "Manual",
    "Queued",
    "Fixing",
    "Fixed",
    "Failed",
    "Cancelled",
    "Review",
  ]);
  // Translated, and every text a view can show is in its tool's list.
  assert.ok(status.toolStatusTexts("files", de).every((x) => /^«.*»$/.test(x)));
  for (const name of Object.keys(spec.muxStatusLabels).concat("warning"))
    for (const check of [ok, bad])
      assert.ok(
        mux.includes(status.muxStatusView({ status: name, check }, en).text),
        name,
      );
  for (const name of Object.keys(placement.placementStatusShort))
    assert.ok(
      disks.includes(
        status.placementStatusView(
          { scanStatus: name, jobStatus: "", message: "" },
          en,
        ).text,
      ),
      name,
    );
  for (const jobStatus of ["", "queued", "running", "succeeded", "failed"])
    for (const fix of ["chmod", "manual"])
      assert.ok(
        files.includes(
          status.fileCheckStatusView({ jobStatus, fix, message: "" }, en).text,
        ),
        jobStatus + fix,
      );
});

// --- Column widths -----------------------------------------------------------

// The v2 tokens on :root that the tool tables measure with, as the token file
// defines them (stylesheet-guards.test.mjs reads the stylesheets).
const tokens = {
  "--font": '"Inter Variable", sans-serif',
  "--fs-thead": "10px",
  "--ls-thead": "0.04em",
  "--w-bold": "700",
  "--fs-xs": "11.5px",
  "--w-semi": "600",
  "--dot-sm": "6px",
  "--sp-1": "4px",
  "--sp-2": "8px",
  "--sp-3": "12px",
  "--sp-5": "20px",
  "--check": "16px",
  "--check-touch": "20px",
  "--touch": "44px",
  "--row-btn": "28px",
  "--select-col": "44px",
  "--title-col-min": "200px",
  "--tool-status-min": "116px",
  "--tool-progress-w": "130px",
};
const px = (name) => Number.parseFloat(tokens[name]);

// The fake metrics of the plan: a header is 6px a character, a status tag
// 6px a character and 24, a cell's text 6px a character; the rest are the
// token values.
const fake = {
  header: (label) => label.length * 6,
  tag: (text) => text.length * 6 + 24,
  text: (text) => text.length * 6,
  button: px("--row-btn"),
  gap: px("--sp-1"),
  pad: px("--sp-2"),
  edge: px("--sp-5"),
  select: px("--select-col"),
  title: px("--title-col-min"),
  sort: 2 * px("--sp-1") + px("--sp-1") / 2 + 11,
  status: px("--tool-status-min"),
};
const placementLabels = {
  ...placement.placementColumnLabels,
  remove: "Actions",
};
const placementButtons = { info: 2, actions: 2, infoPhone: 1, actionsPhone: 1 };
const fileLabels = { ...fileCheck.fileCheckColumnLabels, remove: "Actions" };
const muxButtons = { info: 2, actions: 2, infoPhone: 1, actionsPhone: 1 };
const width = (style, name) => Number.parseFloat(style[name]);

// A catalog's translation, with the English key where it has none.
const catalog = (locale) => {
  const messages = JSON.parse(
    readFileSync(
      new URL("../src/locales/" + locale + ".json", import.meta.url),
      "utf8",
    ),
  ).messages;
  return (key) => messages[key] ?? key;
};
const translated = (labels, t) =>
  Object.fromEntries(
    Object.entries(labels).map(([key, label]) => [key, t(label)]),
  );

// 1440 with the rail leaves a card of 1318; its table has 1278 between the
// card's 20px sides. Mux fits there in every language. Disk placement does
// not (ruling for Task 2, option A): its status column covers the full
// wait texts (Design 11.2, E14), so its default columns exceed the card
// and the table scrolls inside it, as in 1.7.0. Files & permissions'
// kind and fix columns cover their longest label of each language (F-I2,
// the fix wave), so whether its table fits follows the real typeface,
// which the e2e test "tool tables fit at 1440 in four languages" measures
// (English fits; where it does not, ruling A as for placement). Task 10
// asserts in e2e: no page overflow, the table scrolls inside its card as
// a focusable named region (the TableCard pattern) and the sticky header
// is off while it overflows (ruling R-B).
test("mux columns fit 1440 with the rail; placement overflows its card; file kinds and fixes stay whole", () => {
  // The progress minimum is the progress cell (--tool-progress-w); the
  // cell padding comes on top (Phase 5b, Task 1 ledger).
  assert.equal(columns.TOOL_COLUMN_MIN.progress, px("--tool-progress-w"));
  const table = 1318 - 2 * 20;
  for (const locale of ["en", "de", "es", "it"]) {
    const t = catalog(locale);
    const muxStyle = columns.toolColumnStyle(
      spec.muxColumns,
      "mux",
      translated(spec.muxColumnLabels, t),
      status.toolStatusTexts("mux", t),
      muxButtons,
      fake,
    );
    assert.ok(
      width(muxStyle, "--tt-min") <= table,
      locale + " mux: " + muxStyle["--tt-min"],
    );
    const cells = columns.toolCellTexts("files", t);
    const fileStyle = columns.toolColumnStyle(
      fileCheck.fileCheckColumns,
      "files",
      translated(fileLabels, t),
      status.toolStatusTexts("files", t),
      placementButtons,
      fake,
      cells,
    );
    // Every kind and every fix of the language fits its column whole
    // ("Nicht verwaltetes Video", "Acquisisci proprietà", Manual as a tag).
    for (const kind of Object.values(fileCheck.fileCheckKindLabels))
      assert.ok(
        width(fileStyle, "--tt-kind") >= fake.text(t(kind)) + 16,
        locale + " kind " + t(kind),
      );
    for (const fix of ["Take ownership", "Delete", "chmod 777"])
      assert.ok(
        width(fileStyle, "--tt-fix") >= fake.text(t(fix)) + 16,
        locale + " fix " + t(fix),
      );
    assert.ok(width(fileStyle, "--tt-fix") >= fake.tag(t("Manual")) + 16);
    assert.ok(cells.kind.text.includes(t("Untracked video")), locale);
    assert.ok(cells.fix.text.includes(t("Take ownership")), locale);
    const placementStyle = columns.toolColumnStyle(
      placement.placementColumns,
      "placement",
      translated(placementLabels, t),
      status.toolStatusTexts("placement", t),
      placementButtons,
      fake,
    );
    assert.ok(
      width(placementStyle, "--tt-min") > table,
      locale + " placement: " + placementStyle["--tt-min"],
    );
    // In English the waits cost most of it: without them the table is
    // narrower, though no longer inside the card, as the 1.7.0 minima of
    // its data columns (F-I2) take their part too.
    if (locale !== "en") continue;
    const short = columns.toolColumnStyle(
      placement.placementColumns,
      "placement",
      translated(placementLabels, t),
      status
        .toolStatusTexts("placement", t)
        .filter(
          (text) =>
            ![
              t("Waiting: mover is running"),
              t("Waiting: parity operation in progress"),
            ].includes(text),
        ),
      placementButtons,
      fake,
    );
    assert.ok(
      width(short, "--tt-min") < width(placementStyle, "--tt-min"),
      locale + " placement without the waits: " + short["--tt-min"],
    );
    assert.equal(
      width(placementStyle, "--tt-min") - width(short, "--tt-min"),
      width(placementStyle, "--tt-status") - width(short, "--tt-status"),
    );
  }
});

test("tool column widths follow the labels and the status texts", () => {
  const style = (labels, texts = status.toolStatusTexts("placement", en)) =>
    columns.toolColumnStyle(
      placement.placementColumns,
      "placement",
      labels,
      texts,
      placementButtons,
      fake,
    );
  const english = style(placementLabels);
  // The title takes the rest: no width of its own, its minimum counts.
  assert.equal(english["--tt-title"], undefined);
  assert.equal(english["--tt-select"], px("--select-col") + "px");
  // Info and Actions: n row buttons, n − 1 gaps and the padding; Actions
  // is the last cell (--sp-5 on its right).
  assert.equal(english["--tt-actions"], 2 * 28 + 4 + 8 + 8 + "px");
  assert.equal(english["--tt-remove"], 2 * 28 + 4 + 8 + 20 + "px");
  // A data column: its minimum, or its sortable header, plus the padding.
  assert.equal(english["--tt-disks"], 144 + 16 + "px");
  assert.equal(english["--tt-target"], 64 + 16 + "px");
  assert.equal(english["--tt-progress"], 130 + 16 + "px");
  // The status column covers the widest text the tool can show.
  assert.equal(
    english["--tt-status"],
    "Waiting: parity operation in progress".length * 6 + 24 + 16 + "px",
  );
  const sum = (s) =>
    Object.entries(s)
      .filter(([name]) => !name.startsWith("--tt-min"))
      .reduce((total, [, value]) => total + Number.parseFloat(value), 0);
  // The title's minimum content and its cell padding count (Task 5
  // review: the fixed layout ignores its min-width).
  assert.equal(
    width(english, "--tt-min"),
    sum(english) + px("--title-col-min") + 2 * px("--sp-2"),
  );
  // At ≤ 739 Info shows Details and Actions shows Remove only; Actions
  // keeps the width of its header.
  assert.equal(
    width(english, "--tt-min-phone"),
    width(english, "--tt-min") -
      (76 - (28 + 16)) -
      (88 - ("Actions".length * 6 + 8 + 20)),
  );
  // Spanish headers: only the columns whose header outgrows them widen
  // (a service header longer than the 1.7.0 minimum of 96).
  const spanish = style({
    ...placementLabels,
    service: "Servicio de la biblioteca",
    size: "Tamaño",
    disks: "Discos",
    target: "Destino",
    move: "Mover",
    kind: "Tipo",
    status: "Estado",
    progress: "Progreso",
    remove: "Acciones",
  });
  const grown = Object.keys(english).filter(
    (name) => !name.startsWith("--tt-min") && spanish[name] !== english[name],
  );
  assert.deepEqual(grown, ["--tt-service"]);
  assert.equal(spanish["--tt-service"], 25 * 6 + 21 + 16 + "px");
  // Destino (7 × 6 + 21) stays inside the target minimum of 64.
  assert.equal(spanish["--tt-target"], english["--tt-target"]);
  // Tamaño (6 × 6 + 21) stays inside the size minimum of 64.
  assert.equal(spanish["--tt-size"], english["--tt-size"]);
  assert.equal(english["--tt-size"], 64 + 16 + "px");
  // A plain column covers the texts it can show: a kind label wider than
  // its minimum widens the kind column only.
  const kinds = columns.toolColumnStyle(
    placement.placementColumns,
    "placement",
    placementLabels,
    status.toolStatusTexts("placement", en),
    placementButtons,
    fake,
    { kind: { text: ["K".repeat(30)] } },
  );
  assert.deepEqual(
    Object.keys(english).filter(
      (name) => !name.startsWith("--tt-min") && kinds[name] !== english[name],
    ),
    ["--tt-kind"],
  );
  assert.equal(kinds["--tt-kind"], 30 * 6 + 16 + "px");
  assert.equal(english["--tt-kind"], 96 + 16 + "px");
  for (const name of Object.keys(english))
    assert.ok(width(spanish, name) >= width(english, name), name);
  // A wider status text widens the status column only.
  const longer = style(placementLabels, [
    ...status.toolStatusTexts("placement", en),
    "W".repeat(60),
  ]);
  assert.deepEqual(
    Object.keys(english).filter(
      (name) => !name.startsWith("--tt-min") && longer[name] !== english[name],
    ),
    ["--tt-status"],
  );
  // Column IDs of Mux: Info (buttons) and Actions (actions, last).
  const mux = columns.toolColumnStyle(
    spec.muxColumns,
    "mux",
    spec.muxColumnLabels,
    status.toolStatusTexts("mux", en),
    { info: 2, actions: 2, infoPhone: 1, actionsPhone: 1 },
    fake,
  );
  assert.equal(mux["--tt-buttons"], 2 * 28 + 4 + 16 + "px");
  assert.equal(mux["--tt-actions"], 2 * 28 + 4 + 8 + 20 + "px");
  assert.equal(mux["--tt-filename"], undefined);
  assert.equal(
    mux["--tt-origin"],
    "Source service".length * 6 + 21 + 16 + "px",
  );
});

// Ruling M15 (Task 5 review): on a coarse pointer the box grows to
// --check-touch and the cell's right padding to --sp-3, as in the
// libraries, whose auto layout grows the column; the fixed tool table
// measures it, so the box's 44 hit area ends where the next cell begins,
// and the table's minimum grows with it.
test("the selection column makes room for the touch box", () => {
  const { document, getComputedStyle } = toolDocument();
  const tools = loadSource("tool-columns.ts", {
    modules: columnModules,
    browser: { document, getComputedStyle },
  });
  const fine = tools.domToolMetrics();
  const coarse = tools.domToolMetrics(true);
  assert.equal(fine.select, px("--select-col"));
  assert.equal(
    coarse.select,
    px("--sp-5") + px("--check-touch") + px("--sp-3"),
  );
  assert.equal(coarse.select, 52);
  // The hit area: centered on the box, which starts after the first
  // cell's padding; it ends inside the column.
  assert.ok(
    px("--sp-5") + px("--check-touch") / 2 + px("--touch") / 2 <= coarse.select,
  );
  assert.ok(px("--sp-5") + px("--check") + px("--sp-1") <= fine.select);
  // Everything else measures alike.
  for (const name of Object.keys(fine))
    if (name !== "select" && typeof fine[name] === "number")
      assert.equal(coarse[name], fine[name], name);
  // The selection column and the table's minimums grow by the difference.
  const style = (metrics) =>
    tools.toolColumnStyle(
      spec.muxColumns,
      "mux",
      spec.muxColumnLabels,
      status.toolStatusTexts("mux", en),
      muxButtons,
      metrics,
    );
  const desk = style(fine),
    touch = style(coarse);
  assert.equal(touch["--tt-select"], "52px");
  assert.equal(desk["--tt-select"], px("--select-col") + "px");
  for (const name of ["--tt-min", "--tt-min-phone"])
    assert.equal(width(touch, name) - width(desk, name), 52 - 44, name);

  // useToolColumnStyle follows the pointer: a change measures again.
  const runtime = createHookRuntime();
  const query = new EventTarget();
  query.matches = false;
  const queries = [];
  const { useToolColumnStyle } = loadSource("use-tool-table.ts", {
    modules: {
      "preact/hooks": runtime.hooks,
      "./i18n": { t: en, useI18n: () => ({ locale: "en" }) },
      "./hooks/useFontsLoaded": { useFontsLoaded: () => 0 },
      "./tool-columns": tools,
      "./tool-table": {},
    },
    browser: {
      document,
      getComputedStyle,
      matchMedia: (text) => (queries.push(text), query),
    },
  });
  const render = () => {
    const value = runtime.render(() =>
      useToolColumnStyle(spec.muxColumns, "mux", spec.muxColumnLabels, {
        ...muxButtons,
      }),
    );
    runtime.flush();
    return value;
  };
  assert.equal(render()["--tt-select"], "44px");
  assert.ok(queries.every((text) => text === "(pointer: coarse)"));
  query.matches = true;
  query.dispatchEvent(new Event("change"));
  assert.equal(render()["--tt-select"], "52px");
  query.matches = false;
  query.dispatchEvent(new Event("change"));
  assert.equal(render()["--tt-select"], "44px");
  runtime.unmount();
});

// A document for useToolColumnStyle: the v2 tokens above on :root, a
// canvas that measures 6px a character and logs what it measured, a table
// whose rows the test fills, and document.fonts.
function toolDocument() {
  const fonts = new EventTarget();
  fonts.ready = new Promise(() => {});
  const measured = [];
  const context = {
    font: "",
    measureText(text) {
      measured.push(text);
      return { width: text.length * 6 };
    },
  };
  const rows = [];
  const cells = () =>
    rows.flatMap((row) =>
      Object.values(row).map((text) => ({ textContent: text })),
    );
  const document = {
    fonts,
    documentElement: { lang: "en" },
    body: {},
    createElement(tag) {
      assert.equal(tag, "canvas");
      return { getContext: () => context };
    },
    querySelectorAll: () => cells(),
    getElementsByTagName: () => cells(),
  };
  const getComputedStyle = () => ({
    getPropertyValue: (name) => tokens[name] ?? "",
  });
  return { document, getComputedStyle, fonts, measured, rows };
}

test("the tool column style measures labels and status texts, never rows", () => {
  const { document, getComputedStyle, fonts, measured, rows } = toolDocument();
  const runtime = createHookRuntime();
  const browser = { document, getComputedStyle };
  const { useToolColumnStyle } = loadSource("use-tool-table.ts", {
    modules: {
      "preact/hooks": runtime.hooks,
      "./i18n": { t: en, useI18n: () => ({ locale: "en" }) },
      "./hooks/useFontsLoaded": loadSource("hooks/useFontsLoaded.ts", {
        modules: { "preact/hooks": runtime.hooks },
        browser: { document },
      }),
      "./tool-columns": loadSource("tool-columns.ts", {
        modules: columnModules,
        browser,
      }),
      "./tool-table": {},
    },
    browser,
  });
  const render = (cols = placement.placementColumns) =>
    runtime.render(() =>
      useToolColumnStyle(cols, "placement", placementLabels, {
        ...placementButtons,
      }),
    );
  const first = render();
  runtime.flush();
  // The real metrics: headers of 10px at 6px a character with .04em, the
  // sort button (4 + 4 + 2 + 11), the cell padding; tags with two dots of
  // 6 and 8 on both sides; each rounded up and 1px more.
  assert.equal(
    first["--tt-status"],
    Math.ceil("Waiting: parity operation in progress".length * 6 + 12 + 16) +
      1 +
      16 +
      "px",
  );
  assert.equal(
    first["--tt-target"],
    Math.max(64, Math.ceil(6 * 6 + 6 * 0.4) + 1 + 21) + 16 + "px",
  );
  assert.ok(measured.includes("TARGET"), "headers in upper case");
  // A plain cell's kinds are measured as they show (F-I2).
  assert.ok(measured.includes("Media files"), "the kind labels");
  assert.equal(first["--tt-kind"], 96 + 16 + "px");
  // Rows arrive and run: fifty of them, long titles, every status but the
  // waits. The same inputs give the very same style, and a font event
  // measures again to the same widths.
  for (let n = 0; n < 50; n++)
    rows.push({
      title: "A very long title of row " + n + " ".repeat(n) + "!",
      status: n % 2 ? "Moving" : "Queued",
      progress: n + " %",
    });
  measured.length = 0;
  assert.equal(render(), first, "no new measurement for new rows");
  assert.equal(render([...placement.placementColumns]), first, "same columns");
  assert.deepEqual(measured, []);
  fonts.dispatchEvent(new Event("loadingdone"));
  runtime.flush();
  const again = render();
  runtime.flush();
  assert.notEqual(again, first, "measured again after a face loaded");
  assert.deepEqual({ ...again }, { ...first });
  // Only labels, status texts and the kind labels were measured, never a
  // row's text.
  const allowed = new Set([
    ...Object.values(placementLabels).map((label) => label.toUpperCase()),
    ...status.toolStatusTexts("placement", en),
    ...Object.values(placement.placementKindLabels),
  ]);
  assert.ok(measured.length > 0);
  for (const text of measured) assert.ok(allowed.has(text), text);
  runtime.unmount();
});

test("the match count waits, aborts and reads the total", async () => {
  let now = 0,
    next = 1;
  const timers = new Map();
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!due || due[1].at > end) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].run();
    }
    now = end;
  };
  const requests = [];
  const api = (path, method, body, signal, options) =>
    new Promise((resolve, reject) =>
      requests.push({ path, method, body, signal, options, resolve, reject }),
    );
  const runtime = createHookRuntime();
  const { useToolMatchCount } = loadSource("hooks/useToolMatchCount.ts", {
    modules: { "preact/hooks": runtime.hooks, "../api": { api } },
    browser: {
      setTimeout: (run, delay) => {
        timers.set(next, { run, at: now + delay });
        return next++;
      },
      clearTimeout: (id) => timers.delete(id),
      AbortController,
    },
  });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const count = (path) => {
    const value = runtime.render(() => useToolMatchCount(path));
    runtime.flush();
    return plain(value);
  };
  const a = "placement/items?q=Dune&status=split&limit=1";
  const b = "placement/items?q=Dune&limit=1";
  assert.deepEqual(count(a), { count: null, stale: false });
  advance(179);
  assert.equal(requests.length, 0);
  advance(1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, a);
  assert.equal(requests[0].method, "GET");
  assert.deepEqual(plain(requests[0].options), { notifyErrors: false });
  // A change aborts the request before it and waits again.
  assert.deepEqual(count(b), { count: null, stale: false });
  assert.equal(requests[0].signal.aborted, true);
  advance(180);
  assert.equal(requests.length, 2);
  requests[1].resolve({ total: 42, items: [] });
  await tick();
  assert.deepEqual(count(b), { count: 42, stale: false });
  // An aborted answer that arrives late is ignored.
  requests[0].resolve({ total: 7, items: [] });
  await tick();
  assert.deepEqual(count(b), { count: 42, stale: false });
  // A new draft keeps the last count, stale, until its own; a failure is
  // null, and so is an answer without a total.
  assert.deepEqual(count(a), { count: 42, stale: true });
  advance(180);
  requests[2].reject(new Error("offline"));
  await tick();
  assert.deepEqual(count(a), { count: null, stale: false });
  assert.deepEqual(count(b), { count: null, stale: false });
  advance(180);
  requests[3].resolve({ items: [] });
  await tick();
  assert.deepEqual(count(b), { count: null, stale: false });
  // Without a path (Mux counts locally) nothing is asked.
  assert.deepEqual(count(null), { count: null, stale: false });
  advance(1000);
  assert.equal(requests.length, 4);
  runtime.unmount();
  assert.equal(timers.size, 0);
});

// Imports only (ruling I2): frame-status keeps the measurement out of the
// library chunk, and measuring pulls in no message formatting, so the tool
// chunks keep their grouping until the pages use the status views.
test("the column measurement stays out of the library chunk", () => {
  const imports = (path) =>
    [...src(path).matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  for (const name of ["./tool-columns", "./use-tool-table", "./tool-status"])
    assert.ok(!imports("frame-status.ts").includes(name), name);
  assert.ok(imports("use-tool-table.ts").includes("./tool-columns"));
  for (const name of ["./tool-status", "./placement-messages"])
    assert.ok(!imports("use-tool-table.ts").includes(name), name);
  assert.ok(!imports("tool-columns.ts").includes("./placement-messages"));
  assert.ok(!imports("tool-columns.ts").includes("./tool-status"));
});
