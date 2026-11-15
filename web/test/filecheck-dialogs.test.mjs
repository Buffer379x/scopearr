import test from "node:test";
import assert from "node:assert/strict";
import * as fileCheck from "../src/filecheck.ts";
import * as instances from "../src/instances.ts";
import {
  componentHarness,
  loadSource,
  nodes,
  text,
} from "./helpers/component-harness.mjs";

// The Files & permissions dialogs on the v2 modal (Phase 5d, Task 10;
// docs/STYLEGUIDE.md, Part 1, 10.9): Scan, Details, Terminal commands, the
// scan report and Allowed and ignored names. Each runs as real code; Modal,
// ModalFoot, Terminal, KeyValues, StatusTag, TableScroll and HelpTip are
// named stubs.

const classes = (node) => String(node?.props?.class ?? "").split(" ");
const byClass = (tree, name) =>
  nodes(tree).filter((n) => classes(n).includes(name));
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const field = loadSource("components/settings/Field.tsx");
const check = loadSource("components/settings/Check.tsx");
const interpolate = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "");
const footButtons = (tree) =>
  ofType(tree.props.foot, "button").map((b) => [
    text(b),
    b.props.disabled ?? false,
    b.props.class,
  ]);
const labelOf = (tree, label) =>
  nodes(tree).find((n) => n.type === "label" && text(n).includes(label));
// The control of a checkbox label (its input inside) or of a field (the
// input its label names by `for`).
const inputOf = (tree, label) => {
  const named = labelOf(tree, label);
  return (
    nodes(named).find((n) => n.type === "input") ??
    nodes(tree).find(
      (n) => n.type === "input" && n.props.id === named.props.for,
    )
  );
};
const alerts = (tree) => nodes(tree).filter((n) => n.props?.role === "alert");

// --- Scan ---------------------------------------------------------------

function scan(props = {}) {
  const calls = [];
  const view = componentHarness(
    "FileCheckScanDialog",
    {
      settings: {
        instances: [
          { id: "radarr", type: "radarr", enabled: true, name: "Radarr" },
        ],
        unraid: { ownerUid: 99, ownerGid: 100 },
        fileCheck: {
          ...fileCheck.defaultFileCheckSettings,
          allowed: ["saved.nfo"],
          ignore: [".saved"],
        },
      },
      options: { ...fileCheck.defaultFileCheckSettings, libraries: ["radarr"] },
      physical: true,
      fixesActive: false,
      scanning: false,
      start: async (next) => calls.push(["start", plain(next)]),
      openNames: () => calls.push(["names"]),
      close: () => calls.push(["close"]),
      ...props,
    },
    {
      modules: {
        "../filecheck": fileCheck,
        "../instances": instances,
        "./settings/Field": field,
        "./settings/Check": check,
      },
    },
  );
  return { view, tree: view.render(), calls };
}

test("the file check scan keeps every option and check", async () => {
  const { view, tree, calls } = scan();
  assert.equal(tree.type, "Modal");
  assert.equal(tree.props.id, "fileCheckScan");
  assert.equal(tree.props.title, "Scan files & permissions");
  assert.equal(tree.props.fitViewport, true);
  assert.equal(tree.props.closeDisabled, false);
  // Sections in 1.7.0 order, in two columns.
  assert.deepEqual(
    plain(byClass(tree.props.children, "v2-modal-h").map(text)),
    ["Services", "Checks", "Target owner", "Target permissions", "Fixing"],
  );
  assert.equal(byClass(tree.props.children, "v2-modal-col").length, 2);
  // The names link opens the Unraid settings.
  const link = ofType(tree.props.children, "button").find(
    (b) => text(b) === "Allowed and ignored names in Settings",
  );
  assert.equal(link.props.type, "button");
  assert.equal(link.props.class, "v2-text-btn");
  link.props.onClick();
  assert.deepEqual(plain(calls[0]), ["names"]);
  // The owner: both fields, their limits and the default hint; Reset to
  // default only for another owner.
  const owner = ["Owner UID", "Owner GID"].map((label) => {
    const input = inputOf(tree.props.children, label);
    return [
      input.props.type,
      input.props.min,
      input.props.max,
      input.props.value,
    ];
  });
  assert.deepEqual(plain(owner), [
    ["number", 0, 65535, 99],
    ["number", 0, 65535, 100],
  ]);
  assert.match(
    text(byClass(tree.props.children, "v2-modal-hint").at(0)),
    /Default from Settings: 99:100/,
  );
  assert.equal(
    ofType(tree.props.children, "button").some(
      (b) => text(b) === "Reset to default",
    ),
    false,
  );
  // The strict check carries its help (the label stays clean).
  const help = ofType(tree.props.children, "HelpTip")[0];
  assert.equal(
    help.props.label,
    "Report any deviation from the target permissions",
  );
  assert.match(help.props.text, /^Without this option, permissions only count/);
  assert.equal(
    text(labelOf(tree.props.children, "Report any deviation")),
    "Report any deviation from the target permissions",
  );
  // Fixing: both boxes, the second needs the first; no disk placement
  // service locks both and says why.
  const take = inputOf(tree.props.children, "Take ownership");
  const video = inputOf(tree.props.children, "Include video files");
  assert.equal(take.props.disabled, false);
  assert.equal(video.props.disabled, false);
  take.props.onChange({ currentTarget: { checked: false } });
  assert.equal(
    inputOf(view.render().props.children, "Include video files").props.disabled,
    true,
  );
  const locked = scan({ physical: false }).tree;
  assert.equal(
    inputOf(locked.props.children, "Take ownership").props.disabled,
    true,
  );
  assert.equal(
    text(byClass(locked.props.children, "v2-modal-hint").at(-1)),
    "Taking ownership needs the Unraid disk placement service.",
  );
  // The foot: the reason's place is always there; Cancel and Scan.
  assert.equal(tree.props.foot.type, "ModalFoot");
  assert.equal(tree.props.foot.props.lead.props["data-reason"], "");
  assert.equal(text(tree.props.foot.props.lead), "");
  assert.deepEqual(plain(footButtons(tree)), [
    ["Cancel", false, "v2-btn"],
    ["Scan", false, "v2-btn v2-btn--primary"],
  ]);
});

test("the file check scan keeps its checks, owner and permission choices", async () => {
  const { view, tree, calls } = scan();
  // Unchecking the only service blocks the scan with a notice.
  inputOf(tree.props.children, "Radarr").props.onChange({
    currentTarget: { checked: false },
  });
  await ofType(view.render().props.foot, "button")[1].props.onClick();
  let after = view.render();
  assert.equal(
    text(alerts(after.props.children)[0]),
    "Select at least one library",
  );
  assert.equal(
    calls.filter(([kind]) => kind === "start").length,
    0,
    "no scan starts without a service",
  );
  inputOf(after.props.children, "Radarr").props.onChange({
    currentTarget: { checked: true },
  });
  for (const kind of fileCheck.fileCheckKinds)
    inputOf(
      view.render().props.children,
      fileCheck.fileCheckKindLabels[kind],
    ).props.onChange({
      currentTarget: { checked: false },
    });
  await ofType(view.render().props.foot, "button")[1].props.onClick();
  assert.ok(
    alerts(view.render().props.children).some(
      (a) => text(a) === "Select at least one check",
    ),
  );
  // Reset to default returns another owner to Unraid's.
  const other = scan({
    options: {
      ...fileCheck.defaultFileCheckSettings,
      libraries: ["radarr"],
      ownerUid: 1000,
      ownerGid: 101,
    },
  });
  const reset = ofType(other.tree.props.children, "button").find(
    (b) => text(b) === "Reset to default",
  );
  reset.props.onClick();
  assert.deepEqual(
    plain(
      ["Owner UID", "Owner GID"].map(
        (l) => inputOf(other.view.render().props.children, l).props.value,
      ),
    ),
    [99, 100],
  );
  // Custom values: its two fields appear under the radios.
  const radios = ofType(tree.props.children, "input").filter(
    (i) => i.props.type === "radio",
  );
  assert.ok(radios.every((r) => r.props.name === "filecheck-mode-preset"));
  assert.equal(radios.at(-1).props.checked, false);
  radios.at(-1).props.onChange();
  const placeholders = ofType(view.render().props.children, "input").map(
    (i) => i.props.placeholder,
  );
  assert.ok(placeholders.includes("0664") && placeholders.includes("0775"));
});

test("a file check scan keeps saved names, shows errors inline and locks while busy", async () => {
  const failing = scan({
    start: async (next) => {
      failing.payload = next;
      throw new Error("Scan unavailable");
    },
  });
  await ofType(failing.tree.props.foot, "button")[1].props.onClick();
  assert.deepEqual(Array.from(failing.payload.allowed), ["saved.nfo"]);
  assert.deepEqual(Array.from(failing.payload.ignore), [".saved"]);
  assert.deepEqual(
    Array.from(failing.payload.libraries),
    [],
    "all enabled services use the compatibility empty selection",
  );
  const shown = failing.view.render();
  assert.match(text(alerts(shown.props.children).at(-1)), /Scan unavailable/);
  assert.equal(shown.props.closeDisabled, false);
  assert.equal(ofType(shown.props.foot, "button")[1].props.disabled, false);
  // Fixes running: the reason sits in the foot and only Scan is off.
  const fixing = scan({ fixesActive: true }).tree;
  assert.equal(
    text(fixing.props.foot.props.lead),
    "Finish or cancel fixes first",
  );
  const [cancel, start] = ofType(fixing.props.foot, "button");
  assert.equal(cancel.props.disabled, false);
  assert.equal(start.props.disabled, true);
  assert.equal(start.props.title, "Finish or cancel fixes first");
  assert.ok(
    ofType(fixing.props.children, "input").every(
      (i) => i.props.disabled === false,
    ),
    "running fixes lock only Scan, never the fields",
  );
  assert.equal(inputOf(fixing.props.children, "Radarr").props.disabled, false);
  // A scan running disables Scan, never the fields.
  assert.equal(
    ofType(scan({ scanning: true }).tree.props.foot, "button")[1].props
      .disabled,
    true,
  );
});

// --- Details --------------------------------------------------------------

function detail(props = {}, item = {}) {
  const calls = [];
  const tree = componentHarness(
    "FileCheckDetailDialog",
    {
      item: {
        id: 7,
        title: "Her",
        rel: "movies/Her (2013)/Her.2013.nfo",
        kind: "owner",
        instance: "Radarr",
        dir: false,
        mode: 0o600,
        uid: 0,
        gid: 0,
        size: 1500,
        fix: "chmod",
        jobStatus: "",
        message: "",
        note: "",
        ...item,
      },
      options: { ...fileCheck.defaultFileCheckSettings },
      fix: () => calls.push(["fix"]),
      commands: () => calls.push(["commands"]),
      close: () => calls.push(["close"]),
      disabled: false,
      ...props,
    },
    {
      modules: {
        "../filecheck": fileCheck,
        "../ui": {
          ICON: { label: 15, button: 16 },
          compactBytes: (n) => n + " B",
        },
        "../i18n": {
          useI18n() {},
          t: interpolate,
        },
        "../tool-status": {
          fileCheckStatusView: (it) => ({ text: "Status " + it.fix }),
        },
        "../placement-messages": { placementMessage: (m) => "note:" + m },
      },
    },
  ).render();
  return { tree, calls };
}

test("file check details keep their rows, notices and fix", () => {
  const { tree, calls } = detail();
  assert.equal(tree.props.id, "fileCheckDetails");
  assert.equal(tree.props.title, "Her");
  const body = tree.props.children;
  assert.equal(
    text(byClass(body, "v2-path")[0]),
    "movies/Her (2013)/Her.2013.nfo",
  );
  assert.ok(classes(byClass(body, "v2-path")[0]).includes("v2-card--inset"));
  // The kind as a tag, the status as a StatusTag.
  assert.equal(
    text(byClass(body, "v2-tag")[0]),
    fileCheck.fileCheckKindLabels.owner,
  );
  assert.equal(ofType(body, "StatusTag")[0].props.view.text, "Status chmod");
  assert.equal(
    text(byClass(body, "v2-notice")[0]),
    fileCheck.fileCheckKindHelp.owner,
  );
  // Key values, literal.
  const rows = ofType(body, "KeyValues")[0].props.rows;
  assert.deepEqual(plain(rows.map((r) => [r.label, r.value])), [
    ["Service", "Radarr"],
    [
      "Current permissions",
      `${fileCheck.fileCheckModeText(0o600, false)} · 0:0`,
    ],
    [
      "Target permissions",
      `${fileCheck.fileCheckModeText(parseInt(fileCheck.defaultFileCheckSettings.fileMode, 8), false)} · ${fileCheck.defaultFileCheckSettings.ownerUid}:${fileCheck.defaultFileCheckSettings.ownerGid}`,
    ],
    ["Size", "1500 B"],
    [
      "Fix",
      fileCheck.fileCheckFixLabel(
        { fix: "chmod", dir: false },
        fileCheck.defaultFileCheckSettings,
      ),
    ],
  ]);
  // The foot: Terminal command, Close, Fix.
  assert.deepEqual(plain(footButtons(tree)), [
    ["Terminal command", false, "v2-btn"],
    ["Close", false, "v2-btn"],
    ["Fix", false, "v2-btn v2-btn--primary"],
  ]);
  for (const button of ofType(tree.props.foot, "button"))
    button.props.onClick();
  assert.deepEqual(plain(calls), [["commands"], ["close"], ["fix"]]);
  // A folder has no size; a note is a row; Fix locks with `disabled`.
  const folder = detail({ disabled: true }, { dir: true, note: "x" });
  const names = ofType(
    folder.tree.props.children,
    "KeyValues",
  )[0].props.rows.map((r) => r.label);
  assert.deepEqual(plain(names), [
    "Service",
    "Current permissions",
    "Target permissions",
    "Fix",
    "Note",
  ]);
  assert.equal(footButtons(folder.tree)[2][1], true);
});

test("file check details tell a manual finding to use the terminal command", () => {
  const manual = (extra) =>
    detail({}, { fix: "manual", message: "Needs root", ...extra }).tree.props
      .children;
  const notices = (body) => byClass(body, "v2-notice").map(text);
  // The manual hint comes with the kind help, the message does not repeat.
  assert.ok(
    notices(manual({ note: "" })).some((n) =>
      n.startsWith("Scopearr runs without root"),
    ),
  );
  assert.equal(notices(manual({ note: "" })).includes("Needs root"), false);
  // "cannot assign" says it itself.
  assert.equal(
    notices(manual({ note: "cannot assign owner" })).some((n) =>
      n.startsWith("Scopearr runs without root"),
    ),
    false,
  );
  // An automatic finding shows its message.
  assert.ok(
    notices(
      detail({}, { fix: "chmod", message: "Queued" }).tree.props.children,
    ).includes("Queued"),
  );
});

// --- Terminal commands --------------------------------------------------

function commands(props = {}, browser = {}) {
  const calls = [];
  const view = componentHarness(
    "FileCheckCommandsDialog",
    {
      text: "echo 1\necho 2\n",
      hostPaths: true,
      total: 4,
      downloadAll: () => calls.push(["all"]),
      busy: false,
      close: () => calls.push(["close"]),
      ...props,
    },
    {
      modules: {},
      browser: {
        navigator: { clipboard: { writeText: async () => {} } },
        ...browser,
      },
    },
  );
  return { view, tree: view.render(), calls };
}

const script = (lines) =>
  Array.from({ length: lines }, (_, i) => "echo " + i).join("\n") + "\n";

test("terminal commands keep copy, download and the preview", async () => {
  // Up to 500 lines: all of them, in the Terminal.
  const small = commands({ text: script(500) });
  assert.equal(small.tree.props.id, "fileCheckCommands");
  assert.equal(small.tree.props.title, "Terminal commands");
  const terminal = ofType(small.tree.props.children, "Terminal")[0];
  assert.equal(terminal.props.label, "Terminal");
  assert.equal(text(terminal).trimEnd().split("\n").length, 500);
  assert.equal(
    byClass(small.tree.props.children, "v2-notice").length,
    0,
    "no preview notice up to 500 lines",
  );
  assert.match(
    text(byClass(small.tree.props.children, "v2-modal-hint")[0]),
    /Review these commands and run them in the Unraid terminal/,
  );
  // The container-path hint.
  assert.match(
    text(
      byClass(
        commands({ hostPaths: false }).tree.props.children,
        "v2-modal-hint",
      )[0],
    ),
    /These are container paths/,
  );
  // Beyond 500 lines: fifty shown, the full script copied.
  let copied;
  const big = commands(
    { text: script(501) },
    {
      navigator: {
        clipboard: {
          writeText: async (value) => {
            copied = value;
          },
        },
      },
    },
  );
  assert.equal(
    text(ofType(big.tree.props.children, "Terminal")[0]).split("\n").length,
    50,
  );
  assert.match(
    text(byClass(big.tree.props.children, "v2-notice")[0]),
    /first 50 of 501 lines/,
  );
  const copy = ofType(big.tree.props.foot, "button").find(
    (b) => text(b) === "Copy",
  );
  await copy.props.onClick();
  assert.equal(copied, script(501));
  const done = big.view.render();
  assert.ok(
    ofType(done.props.foot, "button").some((b) => text(b) === "Copied"),
  );
  // The foot: the script of all matches first (left), then Copy, the
  // download of the shown script and Close.
  assert.deepEqual(plain(footButtons(big.tree)), [
    ["Download script for all 4 matches", false, "v2-btn v2-modal-foot-first"],
    ["Copy", false, "v2-btn"],
    ["Download script (.sh)", false, "v2-btn"],
    ["Close", false, "v2-btn"],
  ]);
  const [all, , , close] = ofType(big.tree.props.foot, "button");
  all.props.onClick();
  close.props.onClick();
  assert.deepEqual(plain(big.calls), [["all"], ["close"]]);
  // The shown script downloads whole, as one .sh file.
  const link = { click() {}, remove() {} };
  const blobs = [];
  const download = commands(
    { text: script(501) },
    {
      URL: {
        createObjectURL: (blob) => (blobs.push(blob), "blob:x"),
        revokeObjectURL() {},
      },
      document: {
        createElement: () => link,
        body: { appendChild() {} },
      },
    },
  );
  ofType(download.tree.props.foot, "button")[2].props.onClick();
  assert.equal(link.download, "scopearr-filecheck.sh");
  assert.equal(await blobs[0].text(), script(501));
});

test("terminal commands say what failed to copy and what is not selected", async () => {
  // A failed copy of a preview points at the download.
  const failing = commands(
    { text: script(501) },
    {
      navigator: {
        clipboard: {
          writeText: async () => {
            throw new Error("denied");
          },
        },
      },
    },
  );
  await ofType(failing.tree.props.foot, "button")[1].props.onClick();
  assert.equal(
    text(alerts(failing.view.render().props.children)[0]),
    "Copy failed. Download the complete script instead.",
  );
  // Without a preview the text is selected instead.
  const selected = [];
  const fallback = commands(
    {},
    {
      navigator: {
        clipboard: {
          writeText: async () => {
            throw new Error("denied");
          },
        },
      },
      document: {
        createRange: () => ({ selectNodeContents() {} }),
      },
      getSelection: () => ({
        removeAllRanges() {},
        addRange: (range) => selected.push(range),
      }),
    },
  );
  await ofType(fallback.tree.props.foot, "button")[1].props.onClick();
  assert.equal(alerts(fallback.view.render().props.children).length, 0);
  // No findings selected: only the hint and the all-matches script.
  const empty = commands({ text: "", total: 0 });
  assert.equal(ofType(empty.tree.props.children, "Terminal").length, 0);
  assert.match(
    text(byClass(empty.tree.props.children, "v2-modal-hint")[0]),
    /No findings selected\. The script for all matches covers 0 findings/,
  );
  assert.deepEqual(plain(footButtons(empty.tree)), [
    ["Download script for all 0 matches", true, "v2-btn v2-modal-foot-first"],
    ["Close", false, "v2-btn"],
  ]);
  assert.equal(
    commands({ text: "", busy: true }).tree.props.foot.props.children[0].props
      .disabled,
    true,
  );
});

// --- Report ---------------------------------------------------------------

function report(props = {}) {
  const calls = [];
  const tree = componentHarness(
    "dialog/FileCheckReportDialog",
    {
      report: {
        finishedAt: "2026-01-02T03:04:05Z",
        checked: 10,
        files: 20,
        findings: 5,
        items: 4,
        bytes: 2048,
        fixes: { manual: 2 },
        kinds: { owner: 3, permissions: 2, orphaned: 0 },
        roots: [],
      },
      scanning: false,
      roots: [{ arrPath: "/tv", mapped: false }],
      mappings: "",
      changed: async () => calls.push(["changed"]),
      setup: () => calls.push(["setup"]),
      filterKind: (kind) => calls.push(["filter", kind]),
      close: () => calls.push(["close"]),
      disabled: false,
      ...props,
    },
    {
      exportName: "FileCheckReportDialog",
      modules: {
        "../../filecheck": fileCheck,
        "../../ui": {
          ICON: { label: 15, button: 16 },
          compactBytes: (n) => n + " B",
          count: String,
        },
        "../../i18n": {
          useI18n: () => ({ locale: "en" }),
          t: interpolate,
        },
        "../../scan-report": {
          scanReportTime: (scan) =>
            scan.finishedAt && {
              date: "2 Jan 2026",
              iso: scan.finishedAt,
              duration: "1 min",
            },
        },
        "../RootCoverage": {
          SkippedRootsNotice: "SkippedRootsNotice",
          rootPresentation: (roots, mappings) =>
            roots.map((r) => ({ ...r, mappings })),
        },
      },
    },
  ).render();
  return { tree, calls };
}

test("the file check report keeps its kinds and roots", () => {
  const { tree, calls } = report({ scanning: true, mappings: "m" });
  assert.equal(tree.props.id, "fileCheckReport");
  assert.equal(tree.props.title, "Scan report");
  const body = tree.props.children;
  // A running scan is a line in the foot (not in the body, see below).
  assert.match(
    text(tree.props.foot.props.lead),
    /A new scan is running\. This report shows the previous scan\./,
  );
  // The numbers, the scan time first (with its ISO title).
  const rows = ofType(body, "KeyValues")[0].props.rows;
  assert.deepEqual(
    plain(
      rows.map((r) => [
        r.label,
        r.value.props ? r.value.props.title : text(r.value),
        r.value.props ? text(r.value) : null,
      ]),
    ),
    [
      ["Scanned at", "2026-01-02T03:04:05Z", "2 Jan 2026"],
      ["Duration", "1 min", null],
      ["Items checked", "10", null],
      ["Files checked", "20", null],
      ["Findings", "5", null],
      ["Affected items", "4", null],
      ["Data in findings", "2048 B", null],
      ["Manual fixes", "2", null],
    ],
  );
  // The skipped roots are presented against the mappings.
  const roots = ofType(body, "SkippedRootsNotice")[0];
  assert.deepEqual(plain(roots.props.roots), [
    { arrPath: "/tv", mapped: false, mappings: "m" },
  ]);
  assert.equal(roots.props.disabled, false);
  roots.props.setup();
  assert.deepEqual(plain(calls), [["setup"]]);
  // The kinds with findings, each a filter link that also closes; the
  // table sits in a named region.
  assert.equal(ofType(body, "TableScroll")[0].props.label, "By kind");
  const links = ofType(body, "button");
  assert.deepEqual(plain(links.map(text)), [
    fileCheck.fileCheckKindLabels.permissions,
    fileCheck.fileCheckKindLabels.owner,
  ]);
  links[1].props.onClick();
  assert.deepEqual(plain(calls.at(-1)), ["filter", "owner"]);
  assert.deepEqual(
    plain(ofType(body, "th").map((th) => [text(th), th.props.scope])),
    [
      ["Kind", "col"],
      ["Findings", "col"],
    ],
  );
  assert.ok(ofType(body, "table").every((t) => t.props.class === "v2-table"));
  // The foot is Close.
  assert.deepEqual(plain(footButtons(tree)), [["Close", false, "v2-btn"]]);
});

// --- Names ----------------------------------------------------------------

function names(props = {}) {
  const calls = [];
  const view = componentHarness(
    "FileCheckNamesDialog",
    {
      options: fileCheck.defaultFileCheckSettings,
      save: (allowed, ignore) =>
        calls.push(["save", plain(allowed), plain(ignore)]),
      close: () => calls.push(["close"]),
      ...props,
    },
    {
      modules: {
        "../filecheck": fileCheck,
        "./settings/Field": field,
      },
    },
  );
  return { view, tree: view.render(), calls };
}

test("the names dialog keeps both lists, reset and apply", () => {
  const { view, tree, calls } = names();
  assert.equal(tree.props.id, "fileCheckNames");
  assert.equal(tree.props.title, "Allowed and ignored names");
  // Two textareas side by side, each a field with its hint.
  assert.equal(byClass(tree.props.children, "v2-modal-col").length, 2);
  const areas = ofType(tree.props.children, "textarea");
  assert.deepEqual(
    plain(areas.map((a) => [a.props.id, a.props.class, a.props.rows])),
    [
      ["filecheck-allowed", "v2-textarea", 12],
      ["filecheck-ignore", "v2-textarea", 12],
    ],
  );
  assert.deepEqual(plain(ofType(tree.props.children, "label").map(text)), [
    "Allowed names",
    "Ignored names",
  ]);
  assert.deepEqual(plain(ofType(tree.props.children, "small").map(text)), [
    "Never reported as orphaned. One pattern per line; a trailing / matches folders.",
    "Never reported at all.",
  ]);
  assert.equal(
    text(byClass(tree.props.children, "v2-modal-hint").at(-1)),
    "Changes apply to the next scan.",
  );
  // Apply saves the trimmed, non-empty lines and closes.
  areas[0].props.onInput({
    currentTarget: { value: " custom.nfo \n\nposter.*\n" },
  });
  areas[1].props.onInput({ currentTarget: { value: " .private/\n" } });
  const foot = view.render().props.foot;
  assert.deepEqual(
    plain(
      ofType(foot, "button").map((b) => [text(b), b.props.type, b.props.class]),
    ),
    [
      ["Reset allowed names", "button", "v2-btn"],
      ["Apply", "button", "v2-btn v2-btn--primary"],
    ],
  );
  ofType(foot, "button")[1].props.onClick();
  assert.deepEqual(plain(calls), [
    ["save", ["custom.nfo", "poster.*"], [".private/"]],
    ["close"],
  ]);
  // Reset allowed names returns the default list into the first field.
  ofType(foot, "button")[0].props.onClick();
  assert.equal(
    ofType(view.render().props.children, "textarea")[0].props.value,
    fileCheck.defaultFileCheckSettings.allowed.join("\n"),
  );
  assert.equal(
    ofType(view.render().props.children, "textarea")[1].props.value,
    " .private/\n",
    "the ignored list stays",
  );
});

test("the names dialog locks both lists and both buttons in the demo", () => {
  const { tree } = names({ disabled: true });
  assert.equal(tree.props.id, "fileCheckNames");
  assert.ok(
    ofType(tree.props.children, "textarea").every((a) => a.props.disabled),
  );
  assert.ok(ofType(tree.props.foot, "button").every((b) => b.props.disabled));
});

// --- Fix round 1 ---------------------------------------------------------

test("a scan starting behind the report moves nothing in its body", () => {
  const idle = report({ scanning: false }).tree;
  const running = report({ scanning: true }).tree;
  // The note lives in the foot's reserved lead (one line, always there),
  // never in the body, so the numbers below it keep their place.
  for (const tree of [idle, running])
    assert.equal(
      byClass(tree.props.children, "v2-notice").some((n) =>
        /A new scan is running/.test(text(n)),
      ),
      false,
    );
  assert.equal(idle.props.foot.props.lead.props["data-reason"], "");
  assert.equal(text(idle.props.foot.props.lead), "");
  assert.equal(
    text(running.props.foot.props.lead),
    "A new scan is running. This report shows the previous scan.",
  );
  assert.equal(
    running.props.foot.props.lead.props.title,
    "A new scan is running. This report shows the previous scan.",
  );
  // The body's blocks are the same with and without a scan.
  const shape = (tree) =>
    plain(
      tree.props.children.props.children.filter(Boolean).map((n) => n.type),
    );
  assert.deepEqual(shape(running), shape(idle));
});

test("the skipped roots notice has the v2 look and keeps its text and actions", () => {
  const calls = [];
  const tree = componentHarness(
    "RootCoverage",
    {
      roots: [
        {
          arrPath: "/a",
          share: "a",
          instances: ["Radarr"],
          mapped: false,
          items: 2,
          suggestion: "/mnt/a",
        },
        {
          arrPath: "/b",
          share: "b",
          instances: ["Sonarr"],
          mapped: false,
          items: 1,
          suggestion: "/mnt/b",
        },
        {
          arrPath: "/c",
          share: "c",
          instances: ["Radarr"],
          mapped: true,
          items: 3,
          localExists: true,
          pathWarning: "Careful",
        },
        {
          arrPath: "/d",
          share: "d",
          instances: ["Radarr"],
          mapped: false,
          items: 1,
        },
      ],
      saved() {},
      setup: () => calls.push("setup"),
      disabled: false,
    },
    {
      exportName: "SkippedRootsNotice",
      modules: {
        "../scan-coverage": { scanCoverageReason: () => "" },
        "../placement-messages": { placementMessage: (m) => m },
        "../api": { api: async () => ({}) },
        "../notifications": { notify() {} },
      },
    },
  ).render();
  assert.equal(tree.props.role, "status");
  assert.deepEqual(plain(classes(tree)), [
    "v2-notice",
    "v2-notice--warn",
    "v2-notice--setup",
  ]);
  // No 1.7.0 class is left anywhere in it.
  const legacy = /^(notice|quiet|button|text-button|primary|root-.*|spin)$/;
  for (const node of nodes(tree))
    for (const name of classes(node)) assert.doesNotMatch(name, legacy, name);
  assert.match(
    text(byClass(tree, "v2-notice-body")[0]),
    /Some root folders have no path mapping/,
  );
  // The actions keep their text; the buttons are v2 buttons.
  const buttons = ofType(tree, "button");
  assert.deepEqual(plain(buttons.map((b) => [text(b).trim(), b.props.class])), [
    ["Apply mapping (/mnt/a)", "v2-text-btn"],
    ["Apply mapping (/mnt/b)", "v2-text-btn"],
    ["Map in settings", "v2-text-btn"],
    ["Apply all (2)", "v2-btn v2-btn--sm"],
  ]);
  buttons[2].props.onClick();
  assert.deepEqual(plain(calls), ["setup"]);
  assert.match(text(tree), /Careful/);
});
