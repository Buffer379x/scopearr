import test from "node:test";
import assert from "node:assert/strict";
import {
  componentHarness,
  loadSource,
  nodes,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";

// The mux dialogs on the v2 modal (Phase 5d, Task 8; docs/STYLEGUIDE.md,
// Part 1, 10.9): Mux options, Status, the MKVToolNix log and the path
// check. Each runs as real code; Modal, ModalFoot, CheckRow, ProgressCell,
// KeyValues and the other presentation blocks are named stubs.

const classes = (node) => String(node?.props?.class ?? "").split(" ");
const byClass = (tree, name) =>
  nodes(tree).filter((n) => classes(n).includes(name));
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const field = loadSource("components/settings/Field.tsx");
const buttons = (tree) =>
  ofType(tree.props.foot, "button").map((b) => [
    text(b),
    b.props.disabled ?? false,
    b.props.class,
  ]);
const foot = (tree) => ofType(tree, "ModalFoot")[0] ?? tree.props.foot;

const track = (id, type, extra = {}) => ({
  id,
  type,
  codec: type === "video" ? "HEVC" : "DTS",
  ...extra,
});
const job = (override = {}) => ({
  id: 7,
  service: "radarr",
  fileId: 1,
  mediaId: 1,
  title: "Arrival",
  sourceName: "Arrival.2016.mkv",
  status: "draft",
  backupName: "",
  message: "",
  progress: 0,
  createdAt: "2026-01-02T03:04:05Z",
  updatedAt: "2026-01-02T03:04:06Z",
  source: {
    chapters: 3,
    attachments: 1,
    tracks: [
      track(0, "video", { dimensions: "1920x1080" }),
      track(1, "audio", { channels: "5.1" }),
    ],
  },
  check: {},
  spec: {
    outputName: "Arrival",
    chapters: true,
    attachments: false,
    tracks: {
      0: { keep: true, default: true, forced: false, language: "", name: "" },
      1: {
        keep: true,
        default: false,
        forced: false,
        language: "de",
        name: "",
      },
    },
  },
  ...override,
});

function options(j = job(), props = {}) {
  const calls = [];
  const tree = componentHarness(
    "MuxOptionsDialog",
    {
      job: j,
      spec: j.spec,
      dirty: false,
      busy: false,
      edit: (spec) => calls.push(["edit", spec]),
      save: () => calls.push(["save"]),
      discard: () => calls.push(["discard"]),
      close: () => calls.push(["close"]),
      action: (route) => calls.push(["action", route]),
      ...props,
    },
    {
      modules: {
        "./MuxTrackTable": { MuxTrackTable: "MuxTrackTable" },
        "./settings/Field": field,
      },
    },
  ).render();
  return { tree, calls };
}

test("mux options keep every field, lock and action", () => {
  const { tree, calls } = options(job({ backupName: "Arrival.bak" }), {
    dirty: true,
  });
  assert.equal(tree.type, "Modal");
  assert.equal(tree.props.id, "muxOptions");
  assert.equal(tree.props.title, "Mux options");
  assert.equal(tree.props.closeDisabled, false);
  // The foot: Discard (a draft), Close, Delete backup (danger), Save.
  assert.deepEqual(plain(buttons(tree)), [
    ["Discard", false, "v2-btn"],
    ["Close", false, "v2-btn"],
    ["Delete backup", false, "v2-btn v2-btn--danger"],
    ["Save", false, "v2-btn v2-btn--primary"],
  ]);
  const [title] = byClass(tree.props.children, "v2-modal-h");
  assert.equal(title.type, "h3");
  assert.equal(text(title), "Arrival");
  const [source] = byClass(tree.props.children, "v2-path");
  assert.equal(text(source), "Arrival.2016.mkv");
  assert.ok(classes(source).includes("v2-card--inset"));
  assert.equal(
    text(byClass(tree.props.children, "v2-modal-hint")[0]),
    "Preserved backup: Arrival.bak",
  );
  // The output filename with its fixed suffix.
  const input = ofType(tree.props.children, "input")[0];
  assert.equal(input.props.id, "mux-output-name");
  assert.equal(input.props.value, "Arrival");
  assert.equal(
    text(byClass(tree.props.children, "v2-modal-suffix")[0]),
    ".mkv",
  );
  input.props.onInput({ currentTarget: { value: "Other" } });
  assert.equal(calls[0][1].outputName, "Other");
  ofType(tree.props.foot, "button")[3].props.onClick();
  ofType(tree.props.foot, "button")[2].props.onClick();
  assert.deepEqual(plain(calls.slice(1)), [["save"], ["action", "backup"]]);
  // No draft, no backup: Close and Save only.
  assert.deepEqual(plain(buttons(options().tree).map((b) => b[0])), [
    "Close",
    "Save",
  ]);
  // Busy locks the fields, the foot and Close of the head.
  const busy = options(job(), { busy: true }).tree;
  assert.equal(busy.props.closeDisabled, true);
  assert.ok(buttons(busy).every((b) => b[1]));
  assert.equal(ofType(busy.props.children, "input")[0].props.disabled, true);
});

test("mux options lock by status and offer the status actions", () => {
  for (const status of ["queued", "running", "succeeded", "needs_attention"]) {
    const { tree } = options(job({ status }));
    assert.equal(ofType(tree.props.children, "input")[0].props.disabled, true);
    assert.equal(
      buttons(tree).some((b) => b[0] === "Save"),
      false,
      status,
    );
    assert.equal(
      ofType(tree.props.children, "MuxTrackTable")[0].props.disabled,
      true,
    );
  }
  assert.deepEqual(
    plain(
      buttons(options(job({ status: "needs_attention" })).tree).map(
        (b) => b[0],
      ),
    ),
    ["Close", "Retry rescan"],
  );
  // A review blocks Save with its reason and offers Identify again.
  const review = options(job({ status: "needs_review" })).tree;
  assert.deepEqual(plain(buttons(review).map((b) => b[0])), [
    "Close",
    "Identify again",
    "Save",
  ]);
  const save = ofType(review.props.foot, "button").at(-1);
  assert.equal(save.props.disabled, true);
  assert.equal(save.props.title, "Identify the media file again before saving");
  // A running job keeps its backup untouched.
  assert.equal(
    buttons(options(job({ status: "running", backupName: "x" })).tree).some(
      (b) => b[0] === "Delete backup",
    ),
    false,
  );
});

test("mux options track table is a v2 table with named controls", () => {
  const j = job();
  const changes = [];
  const tree = componentHarness(
    "MuxTrackTable",
    { job: j, spec: j.spec, disabled: false, change: (s) => changes.push(s) },
    {
      modules: {
        "../languages": {
          audioLanguageList: () => [
            { id: "deu", codes: ["de"], name: "German" },
          ],
          loadLanguageRegistry: async () => {},
        },
        "../hooks/useLanguageRegistry": { useLanguageRegistry() {} },
        "./LanguageFlag": { LanguageFlag: "LanguageFlag" },
      },
    },
  ).render();
  const [table] = ofType(tree, "table");
  assert.deepEqual(classes(table), ["v2-table", "v2-table--edit"]);
  assert.equal(
    text(ofType(tree, "thead")[0]),
    "KeepTypeIDCodecLanguageNameDefaultForcedDetails",
  );
  const label = (n) => n.props["aria-label"];
  assert.deepEqual(plain(ofType(tree, "input").map(label).filter(Boolean)), [
    "Keep track 0",
    "Track language",
    "Track name",
    "Default track",
    "Forced track",
    "Keep track 1",
    "Track language",
    "Track name",
    "Default track",
    "Forced track",
    "Keep chapters",
    "Keep attachments",
  ]);
  // Every value cell names its column for the card rows below 560.
  assert.deepEqual(
    plain(
      ofType(ofType(tree, "tr")[1], "td").map((td) => td.props["data-label"]),
    ),
    [
      "Keep",
      "Type",
      "ID",
      "Codec",
      "Language",
      "Name",
      "Default",
      "Forced",
      "Details",
    ],
  );
  assert.ok(
    ofType(ofType(tree, "tbody")[0], "tr").every((tr) =>
      classes(tr).includes("v2-row"),
    ),
  );
  assert.ok(
    ofType(tree, "input")
      .filter((n) => n.props.type === "checkbox")
      .every((n) => classes(n).includes("v2-check")),
  );
  // Details: dimensions for video, channels for audio.
  assert.match(text(ofType(tree, "tr")[1]), /1920x1080/);
  assert.match(text(ofType(tree, "tr")[2]), /5\.1/);
  // A track that is not kept locks its language, name and flags.
  const off = job();
  off.spec.tracks[1].keep = false;
  const locked = componentHarness(
    "MuxTrackTable",
    { job: off, spec: off.spec, disabled: false, change() {} },
    {
      modules: {
        "../languages": {
          audioLanguageList: () => [],
          loadLanguageRegistry() {},
        },
        "../hooks/useLanguageRegistry": { useLanguageRegistry() {} },
        "./LanguageFlag": { LanguageFlag: "LanguageFlag" },
      },
    },
  ).render();
  assert.deepEqual(
    plain(
      ofType(ofType(locked, "tr")[2], "input").map((n) => n.props.disabled),
    ),
    [false, true, true, true, true],
  );
});

function status(j, { workDir = true, answer = null } = {}) {
  const runtime = createHookRuntime(),
    requests = [];
  let resolve;
  const view = componentHarness(
    "MuxStatusDialog",
    {
      job: j,
      workDir,
      busy: false,
      options() {},
      terminal() {},
      close() {},
      refresh: async () => requests.push("refresh"),
    },
    {
      modules: {
        "preact/hooks": runtime.hooks,
        "../api": {
          api: (path, method, body, signal) => {
            requests.push(path);
            return new Promise((r) => (resolve = r));
          },
        },
        "../mux-spec": { routineMuxMessages: new Set(["Ready"]) },
        "../tool-status": {
          muxStatusView: (x) => ({
            tone: "ok",
            text: x.status,
            long: x.status,
          }),
        },
        "./settings/ServiceStatus": { StatusValue: "StatusValue" },
      },
      browser: { AbortController },
    },
  );
  return {
    requests,
    props: view,
    answer: (value) => resolve(value),
    render: () => runtime.settle(() => view.render()),
  };
}

test("mux status keeps its checks in fixed rows", async () => {
  const j = job({ status: "running" });
  const s = status(j);
  let tree = s.render();
  assert.equal(tree.props.id, "muxStatus");
  assert.equal(tree.props.title, "Status");
  assert.deepEqual(s.requests, ["mux/jobs?id=7"]);
  // Eight rows with a dash before the answer; no "Loading" paragraph.
  let rows = ofType(tree, "CheckRow");
  assert.equal(rows.length, 8);
  assert.ok(rows.every((n) => n.props.pending && n.props.detail === "—"));
  assert.doesNotMatch(text(tree), /Loading/);
  assert.equal(byClass(tree, "v2-modal-sec")[0].type, "section");
  const busy = nodes(tree).find((n) => n.props?.["aria-busy"] !== undefined);
  assert.equal(busy.props["aria-busy"], true);
  assert.equal(ofType(tree, "StatusValue")[0].props.view.text, "running");
  s.answer({
    ...j,
    check: { exists: true, readable: false, outputDisk: "disk3" },
  });
  await settle();
  tree = s.render();
  rows = ofType(tree, "CheckRow");
  assert.equal(rows.length, 8);
  assert.deepEqual(
    plain(
      rows.slice(0, 2).map((n) => [n.props.label, n.props.ok, n.props.pending]),
    ),
    [
      ["Media file exists", true, false],
      ["Readable", false, false],
    ],
  );
  assert.equal(busy.props["aria-busy"], true);
  assert.equal(
    nodes(tree).find((n) => n.props?.["aria-busy"] !== undefined).props[
      "aria-busy"
    ],
    false,
  );
  assert.match(
    text(ofType(tree, "KeyValues")[0].props.rows.map((r) => r.value)),
    /disk3/,
  );
});

test("mux status drops the working directory rows and shows its notices", () => {
  const j = job({
    status: "ready",
    message: "Disk problem",
    backupName: "a.bak",
    check: { exists: true, diskConflict: true },
    finishedAt: "2026-01-02T04:00:00Z",
  });
  const tree = status(j, { workDir: false }).render();
  assert.deepEqual(plain(ofType(tree, "CheckRow").map((n) => n.props.label)), [
    "Media file exists",
    "Readable",
    "Directory writable",
    "Enough free space",
    "Size matches Radarr/Sonarr",
    "File unchanged since identification",
  ]);
  // No detail request for a job without a stored check to refresh.
  assert.equal(ofType(tree, "CheckRow")[0].props.pending, false);
  assert.deepEqual(
    plain(ofType(tree, "KeyValues")[0].props.rows.map((r) => r.label)),
    ["Created", "Updated", "Finished"],
  );
  const notices = byClass(tree, "v2-notice");
  assert.deepEqual(plain(notices.map(text)), [
    "Disk problem",
    "The media file exists on several disks",
  ]);
  assert.ok(classes(notices[1]).includes("v2-notice--warn"));
  assert.match(
    text(byClass(tree, "v2-modal-hint")[0]),
    /Preserved backup: a.bak/,
  );
  // A routine message stays silent.
  assert.equal(
    byClass(status(job({ message: "Ready" })).render(), "v2-notice").length,
    0,
  );
  assert.deepEqual(plain(buttons(tree).map((b) => b[0])), [
    "Terminal",
    "Mux options",
    "Check again",
    "Close",
  ]);
});

test("mux status checks again with refresh and loads the detail anew", async () => {
  const j = job({ status: "running" });
  const s = status(j);
  s.render();
  s.answer({ ...j, check: { exists: true } });
  await settle();
  let tree = s.render();
  const again = ofType(tree.props.foot, "button")[2];
  assert.equal(text(again), "Check again");
  await again.props.onClick();
  tree = s.render();
  assert.deepEqual(s.requests, ["mux/jobs?id=7", "refresh", "mux/jobs?id=7"]);
});

function log(j = job({ status: "running", progress: 40 }), extra = {}) {
  const runtime = createHookRuntime(),
    notes = [],
    written = [];
  let polling;
  const view = componentHarness(
    "MuxTerminalDialog",
    { job: j, close() {} },
    {
      modules: {
        "preact/hooks": runtime.hooks,
        "../hooks/usePolling": {
          usePolling(load, next, deps) {
            polling = { load, next, deps };
          },
        },
        "../api": {
          api: async () => ({
            text: "Warning: a\nplain\n",
            offset: 17,
            running: true,
            progress: 40,
            message: "Muxing",
          }),
        },
        "../mux-spec": {
          muxLogClass: (line) =>
            line.startsWith("Warning:") ? "terminal-warning" : "",
        },
        "../notifications": { notify: (...a) => notes.push(a) },
      },
      browser: {
        navigator: {
          clipboard: {
            writeText: async (value) => {
              if (extra.fail) throw new Error("no");
              written.push(value);
            },
          },
        },
      },
    },
  );
  return {
    notes,
    written,
    polling: () => polling,
    render: () => runtime.settle(() => view.render()),
  };
}

test("the mux log keeps its polling, status line and copy", async () => {
  const l = log();
  let tree = l.render();
  assert.equal(tree.props.id, "muxLog");
  assert.equal(tree.props.title, "MKVToolNix log");
  // Cadence: 1000 while it runs or waits, 15000 once finished, 0 at 64000
  // characters, 3000 after a failed request.
  const next = l.polling().next;
  assert.equal(next({ text: "x", running: true }), 1000);
  assert.equal(next({ text: "x", running: false }), 15000);
  assert.equal(next({ text: "x".repeat(64000), running: true }), 0);
  assert.equal(next(undefined), 3000);
  const queued = log(job({ status: "queued" }));
  queued.render();
  assert.equal(queued.polling().next({ text: "", running: false }), 1000);
  // The first answer fills the terminal: lines by tone, then the status.
  await l.polling().load(new AbortController().signal);
  tree = l.render();
  const [terminal] = ofType(tree, "Terminal");
  assert.equal(terminal.props.label, "Terminal");
  assert.equal(terminal.props.text, "Warning: a\nplain\n");
  assert.deepEqual(
    plain(
      nodes(terminal.props.children)
        .filter((n) => n.type === "span" && n.props.class)
        .map((n) => n.props.class),
    ),
    ["v2-code-warn"],
  );
  const [line] = byClass(tree.props.foot.props.lead, "v2-modal-status");
  assert.equal(line.props.role, "status");
  assert.equal(ofType(line, "ProgressCell")[0].props.status, "running");
  assert.equal(ofType(line, "ProgressCell")[0].props.value, 40);
  assert.match(text(line), /Muxing/);
  // Copy log: the toast, or the error.
  await ofType(tree.props.foot, "button")[0].props.onClick();
  assert.deepEqual(plain(l.written), ["Warning: a\nplain\n"]);
  assert.deepEqual(plain(l.notes), [["Log copied"]]);
  const failing = log(undefined, { fail: true });
  await ofType(failing.render().props.foot, "button")[0].props.onClick();
  assert.deepEqual(plain(failing.notes), [["Could not copy log", "error"]]);
  // Finished and waiting read their words, without a bar once finished.
  const done = log(job({ status: "succeeded" })).render();
  const [doneLine] = byClass(done.props.foot.props.lead, "v2-modal-status");
  assert.equal(text(doneLine), "Finished");
  assert.equal(ofType(doneLine, "ProgressCell").length, 0);
  assert.equal(
    text(
      byClass(
        log(job({ status: "queued" })).render().props.foot.props.lead,
        "v2-modal-status",
      )[0],
    ),
    "Waiting",
  );
});

function checks(override = {}) {
  return {
    readOnly: false,
    syntax: { ok: true },
    mappings: [
      {
        arrPath: "/arr",
        localPath: "/media",
        exists: true,
        isDir: true,
        readable: true,
        writable: true,
        freeBytes: 1024,
      },
    ],
    rootFolders: [
      {
        arrPath: "/arr",
        mapped: true,
        localExists: true,
        instances: ["Radarr"],
      },
    ],
    errors: [{ instance: "Sonarr", error: "Unreachable" }],
    samples: [{ instance: "Radarr", checked: 2, reachable: 2, sizeMatches: 1 }],
    workDir: {
      configured: true,
      exists: true,
      writable: true,
      freeBytes: 2048,
    },
    ...override,
  };
}
function pathCheck(c) {
  return componentHarness(
    "MuxPathDialog",
    { checks: c, close() {} },
    {
      modules: {
        "../ui": { ICON: { button: 16 }, bytes: (n) => n + " B" },
      },
    },
  ).render();
}

test("the path check keeps every section and the read-only variant", () => {
  const tree = pathCheck(checks());
  assert.equal(tree.props.id, "pathCheck");
  assert.equal(tree.props.title, "Path check");
  assert.deepEqual(
    plain(byClass(tree.props.children, "v2-modal-h").map(text)),
    [
      "Mappings",
      "Root folders in Radarr/Sonarr",
      "Sample files",
      "Muxing directory",
    ],
  );
  assert.ok(
    byClass(tree.props.children, "v2-modal-h").every((n) => n.type === "h3"),
  );
  const rows = ofType(tree.props.children, "CheckRow").map((n) => [
    n.props.label,
    n.props.ok,
    n.props.detail,
  ]);
  assert.deepEqual(plain(rows), [
    ["Mapping syntax", true, "Ready"],
    ["/arr → /media", true, "1024 B free"],
    ["/arr · Radarr", true, "Ready"],
    ["Sonarr", false, "Unreachable"],
    ["Radarr", false, "2 / 2 reachable · 1 size matches"],
    ["Separate directory", true, "2048 B free"],
  ]);
  assert.deepEqual(plain(buttons(tree)), [["Close", false, "v2-btn"]]);
  // Read-only (MediaInfo): no Muxing directory and no writable fact.
  const readOnly = pathCheck(
    checks({
      readOnly: true,
      mappings: [{ ...checks().mappings[0], writable: false }],
    }),
  );
  assert.doesNotMatch(text(readOnly.props.children), /Muxing directory/);
  assert.equal(
    ofType(readOnly.props.children, "CheckRow")[1].props.detail,
    "Ready",
  );
  // A time-out is a notice; empty mappings read a hint.
  const timed = pathCheck(checks({ timedOut: true, mappings: [] }));
  assert.equal(
    text(byClass(timed.props.children, "v2-notice")[0]),
    "Path check timed out. Try again.",
  );
  assert.equal(
    text(byClass(timed.props.children, "v2-modal-hint")[0]),
    "No path mappings configured",
  );
});

test("a pending check row has the muted tone and a dash", () => {
  const { CheckRow } = loadSource("components/dialog/CheckRow.tsx", {
    modules: {
      "../../i18n": { t: (key) => key, useI18n() {} },
      "../../ui": { ICON: { button: 16 } },
    },
  });
  const row = (props) => CheckRow({ label: "Readable", ...props });
  const pending = row({ ok: false, pending: true });
  assert.equal(pending.props["data-tone"], "pending");
  assert.equal(text(pending), "Readable—");
  // Without `pending` the tones and default details are as before.
  assert.equal(row({ ok: true }).props["data-tone"], "ok");
  assert.equal(text(row({ ok: false })), "ReadableNeeds attention");
  assert.equal(row({ ok: false, warning: true }).props["data-tone"], "warn");
});
