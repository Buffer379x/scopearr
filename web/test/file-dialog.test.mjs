import test from "node:test";
import assert from "node:assert/strict";
import * as icons from "lucide-preact";
import {
  loadSource,
  nodes,
  PRESENTATION_MODULES,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { src } from "./helpers/sources.mjs";

// File & metadata on the v2 modal (Phase 5d, Task 6; docs/STYLEGUIDE.md,
// Part 1, 10.9): the head with the title, the filename and the rename
// field, the paging tools, the reserved tabs, the overview, the evidence
// table and its menu, MediaInfo and the companion files. Each runs as real
// code; the v2 Modal, ModalFoot, RowButton, MediaTag and ToolDiskTag are
// named stubs, so a tree shows what each hands them.

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const i18n = { t, getLocale: () => "en", useI18n: () => ({ locale: "en" }) };
const ICON = { label: 15, button: 16, row: 16, close: 18 };
const labels = {
  resolution: "Resolution",
  source: "Source",
  language: "Language",
};
const classes = (node) => String(node?.props?.class ?? "").split(" ");
const byClass = (tree, name) =>
  nodes(tree).filter((n) => classes(n).includes(name));
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
// The module runs in its own realm: compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const same = (actual, expected, message) =>
  assert.deepEqual(plain(actual), plain(expected), message);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const rename = loadSource("file-rename.ts", {
  modules: {
    "./mux-spec.ts": {
      validateFilenameStem: (name) =>
        !name || /[/\\]/.test(name) ? "Invalid output filename" : "",
    },
  },
});
class ApiError extends Error {}

const baseFile = (override = {}) => ({
  service: "radarr",
  id: 7,
  title: "Arrival",
  series: "",
  filename: "Arrival.2016.1080p.mkv",
  language: "de",
  audio: "DTS",
  audioStreamCount: 0,
  evidence: {
    resolution: {
      filename: "1080p",
      api: "1080p",
      emby: "1080p",
      origin: "filename",
    },
  },
  ...override,
});

// The dialog with its boundaries: the API (status, mux jobs, rename and
// the confirmations), the session store, notify and the callbacks.
function fileDialog({
  file = baseFile(),
  props = {},
  status = {},
  jobs = [],
  answer = () => ({}),
} = {}) {
  const runtime = createHookRuntime();
  const log = [];
  const session = new Map();
  const api = async (path, method = "GET", body) => {
    log.push(["api", path, method, body]);
    if (path === "status") return status;
    if (path.startsWith("mux/jobs?service=")) return jobs;
    return answer(path, method, body);
  };
  const { FileDialog } = loadSource("components/FileDialog.tsx", {
    modules: {
      "preact/hooks": runtime.hooks,
      "../confirmation-summary": { hasActiveFieldConfirmation: () => false },
      "./MediaInfoPanel": { MediaInfoPanel: "MediaInfoPanel" },
      "../browser-storage": {
        readSessionPreference: (key) => session.get(key) ?? "",
        writeSessionPreference: (key, value) => session.set(key, value),
      },
      "../useMediaInfoRead": {
        useMediaInfoRead: () => ({ busy: false, error: "", read() {} }),
      },
      "../mediainfo": {
        mediaInfoVisible: (enabled, result) => enabled || !!result,
        mediaInfoReadAvailable: (m) => !!m?.enabled && !!m?.installed,
      },
      "./dialog/Tabs": { Tabs: "Tabs" },
      "./EvidenceSourceMenu": {
        EvidenceSourceMenu: "EvidenceSourceMenu",
        evidenceSourceLabel: (source) => source,
      },
      "../audio-channels": { audioChannelLayout: (track) => track.channels },
      "../ui": { ICON, embyMatchLabels: {}, labels },
      "../api": { api, ApiError },
      "../mux-selection": {
        markedForMuxing: () => ["Marked for muxing.", "success"],
      },
      "../notifications": {
        notify: (...args) => log.push(["notify", ...args]),
      },
      "../i18n": i18n,
      "../languages": { audioLanguageListLabel: (value) => value },
      "./LanguageFlag": {
        LanguageFlag: "LanguageFlag",
        LanguageFlags: "LanguageFlags",
      },
      "./list/HelpTip": { HelpTip: "HelpTip" },
      "./RenameCompanionsDialog": {
        RenameCompanionsDialog: "RenameCompanionsDialog",
      },
      "../file-rename": rename,
    },
    stubs: PRESENTATION_MODULES,
  });
  const view = {
    log,
    session,
    props: {
      file,
      providers: [],
      warningColors: { recognition: "#c00", metadata: "#a60" },
      close: () => log.push(["close"]),
      ...props,
    },
    render: () => runtime.settle(() => FileDialog(view.props)),
    // Renders, lets the API answer, renders again.
    async ready() {
      view.render();
      await settle();
      return view.render();
    },
  };
  return view;
}
const rowButton = (tree, label) =>
  ofType(tree, "RowButton").find((n) => n.props.label === label);
const footButtons = (tree) => ofType(tree.props.foot, "button");

test("the file dialog head shows title, filename and rename", async () => {
  const view = fileDialog({
    file: baseFile({
      service: "sonarr",
      series: "Severance",
      title: "Good News About Hell",
      filename: "Severance.S01E01.mkv",
    }),
    props: { renameAvailable: true },
  });
  const tree = await view.ready();
  assert.equal(tree.type, "Modal");
  assert.equal(tree.props.id, "file");
  assert.equal(tree.props.eyebrow, true);
  assert.equal(tree.props.title, "File & metadata");
  // The title line: series · title, the 1.7.0 label for assistive
  // technology only.
  const [head] = byClass(tree.props.head, "v2-file");
  const [name] = byClass(head, "v2-file-name");
  assert.equal(name.type, "p");
  assert.equal(text(name), "Episode Severance · Good News About Hell");
  assert.equal(text(byClass(name, "v2-sr-only")), "Episode ");
  assert.equal(name.props.title, "Severance · Good News About Hell");
  // The filename: the stem in code, the extension in its own span.
  const [path] = byClass(head, "v2-file-path");
  // The stem may be cut; the extension stands beside it, never cut.
  const code = ofType(path, "code")[0];
  assert.equal(text(code), "Severance.S01E01");
  assert.equal(byClass(code, "v2-file-ext").length, 0);
  const [ext] = byClass(path, "v2-file-ext");
  assert.equal(ext.type, "span");
  assert.equal(text(ext), ".mkv");
  const all = nodes(path);
  assert.equal(all.indexOf(ext), all.indexOf(code) + 1);
  assert.equal(code.props.title, "Severance.S01E01.mkv");
  const pencil = rowButton(path, "Rename file");
  assert.equal(pencil.props.size, "sm");
  assert.equal(pencil.props.title, "Rename file");
  assert.equal(pencil.props.disabled, false);
  // A movie reads its title alone.
  const movie = await fileDialog().ready();
  assert.equal(
    text(byClass(movie.props.head, "v2-file-name")),
    "Title Arrival",
  );
  // The tools: Previous and Next, locked without a pager; with one they
  // page and the foot counts.
  const tools = tree.props.tools;
  same(classes(tools), ["v2-file-pager"]);
  const [prev, next] = ofType(tools, "RowButton");
  assert.equal(prev.props.label, "Previous file");
  assert.equal(next.props.label, "Next file");
  assert.equal(prev.props.icon.type, icons.ChevronUp);
  assert.equal(next.props.icon.type, icons.ChevronDown);
  assert.equal(prev.props.disabled, true);
  assert.equal(next.props.disabled, true);
  assert.equal(tree.props.foot.props.lead, null);
  const paged = [];
  view.props = {
    ...view.props,
    pager: {
      index: 3,
      total: 26,
      busy: false,
      next: () => paged.push("next"),
    },
  };
  const withPager = view.render();
  const [p2, n2] = ofType(withPager.props.tools, "RowButton");
  assert.equal(p2.props.disabled, true, "no previous file");
  assert.equal(n2.props.disabled, false);
  n2.props.onClick();
  same(paged, ["next"]);
  const lead = withPager.props.foot.props.lead;
  assert.equal(lead.props["aria-live"], "polite");
  assert.equal(text(lead), "3 of 26");
  view.props.pager = { ...view.props.pager, busy: true };
  assert.equal(
    ofType(view.render().props.tools, "RowButton")[1].props.disabled,
    true,
  );
});

test("renaming keeps every 1.7.0 check and the head height", async () => {
  // Locked with its reason as title: no mount, then a mux job.
  const unavailable = await fileDialog().ready();
  const locked = rowButton(unavailable.props.head, "Rename file");
  assert.equal(locked.props.disabled, true);
  assert.equal(
    locked.props.title,
    "Renaming requires the media mount and path mapping under Settings → Services → MKVToolNix",
  );
  const job = await fileDialog({
    props: { renameAvailable: true },
    jobs: [{ id: 3, status: "draft" }],
  }).ready();
  assert.equal(
    rowButton(job.props.head, "Rename file").props.title,
    "Remove the mux job for this file first",
  );
  // Locked until the mux jobs are loaded.
  const early = fileDialog({ props: { renameAvailable: true } });
  assert.equal(
    rowButton(early.render().props.head, "Rename file").props.disabled,
    true,
  );
  const view = fileDialog({
    props: { renameAvailable: true },
    answer: (path) =>
      path === "files/rename/preview"
        ? {
            filename: "Arrival.mkv",
            companions: [],
            device: "",
            userShare: false,
          }
        : {},
  });
  let tree = await view.ready();
  const shape = (t) =>
    byClass(t.props.head, "v2-file")[0].props.children.length;
  const before = shape(tree);
  rowButton(tree.props.head, "Rename file").props.onClick();
  tree = view.render();
  // The same line becomes the field without the extension, then the
  // fixed extension, Rename file and Cancel renaming.
  const [path] = byClass(tree.props.head, "v2-file-path");
  const [group] = byClass(path, "v2-file-rename");
  same(classes(group), ["v2-input-group", "v2-file-rename"]);
  const input = ofType(group, "input")[0];
  same(classes(input), ["v2-input"]);
  assert.equal(input.props["aria-label"], "Filename");
  assert.equal(input.props.value, "Arrival.2016.1080p");
  assert.equal(text(byClass(group, "v2-file-ext")), ".mkv");
  same(
    ofType(path, "RowButton").map((b) => b.props.label),
    ["Rename file", "Cancel renaming"],
  );
  assert.equal(shape(tree), before, "the head keeps its lines");
  // Unchanged: Rename file is locked; an invalid name shows its error as
  // an alert in the reserved line.
  assert.equal(rowButton(path, "Rename file").props.disabled, true);
  input.props.onInput({ currentTarget: { value: "a/b" } });
  tree = view.render();
  const [error] = byClass(tree.props.head, "v2-modal-error");
  assert.equal(error.props.role, "alert");
  assert.equal(text(error), "Invalid output filename");
  // Escape cancels only the field: the dialog's own Escape is taken.
  const keys = [];
  const key = (name) => ({
    key: name,
    preventDefault: () => keys.push("prevent"),
    stopPropagation: () => keys.push("stop"),
  });
  ofType(tree.props.head, "input")[0].props.onKeyDown(key("Escape"));
  same(keys.splice(0), ["prevent", "stop"]);
  tree = view.render();
  assert.equal(byClass(tree.props.head, "v2-file-rename").length, 0);
  same(
    view.log.filter(([kind]) => kind === "close"),
    [],
    "the dialog stays",
  );
  // While editing, the dialog's cancel ends the field, not the dialog.
  rowButton(tree.props.head, "Rename file").props.onClick();
  tree = view.render();
  tree.props.cancel();
  tree = view.render();
  assert.equal(byClass(tree.props.head, "v2-file-rename").length, 0);
  assert.equal(view.log.filter(([kind]) => kind === "close").length, 0);
  // Enter asks for the preview; meanwhile the status shows and the dialog
  // cannot close.
  rowButton(tree.props.head, "Rename file").props.onClick();
  tree = view.render();
  ofType(tree.props.head, "input")[0].props.onInput({
    currentTarget: { value: "Arrival" },
  });
  tree = view.render();
  ofType(tree.props.head, "input")[0].props.onKeyDown(key("Enter"));
  tree = view.render();
  const [status] = byClass(tree.props.head, "v2-modal-hint");
  assert.equal(status.props.role, "status");
  assert.equal(text(status), "Renaming and rescanning …");
  assert.equal(tree.props.closeDisabled, true);
  await settle();
  tree = view.render();
  same(
    view.log.find(([, path]) => path === "files/rename/preview"),
    [
      "api",
      "files/rename/preview",
      "POST",
      { service: "radarr", fileId: 7, name: "Arrival" },
    ],
  );
  // The preview is open: the dialog still cannot close.
  assert.equal(ofType(tree.props.children, "RenameCompanionsDialog").length, 1);
  assert.equal(tree.props.closeDisabled, true);
  assert.equal(shape(tree), before);
});

test("a successful rename keeps the dialog on the renamed file", async () => {
  for (const refresh of ["completed", "pending"]) {
    const renamed = [];
    const view = fileDialog({
      props: {
        renameAvailable: true,
        renamed: (name) => renamed.push(name),
      },
      answer: (path) =>
        path === "files/rename/preview"
          ? {
              filename: "Arrival.mkv",
              companions: [],
              device: "",
              userShare: false,
            }
          : path === "files/rename"
            ? { refresh }
            : {},
    });
    let tree = await view.ready();
    const focus = [];
    rowButton(tree.props.head, "Rename file").props.buttonRef.current = {
      focus: () => focus.push("pencil"),
    };
    rowButton(tree.props.head, "Rename file").props.onClick();
    tree = view.render();
    ofType(tree.props.head, "input")[0].props.onInput({
      currentTarget: { value: "Arrival" },
    });
    rowButton(view.render().props.head, "Rename file").props.onClick();
    await settle();
    tree = view.render();
    const [companions] = ofType(tree.props.children, "RenameCompanionsDialog");
    companions.props.save(false);
    await settle();
    tree = view.render();
    const notices = view.log.filter(([kind]) => kind === "notify");
    same(notices.at(-1), [
      "notify",
      "File renamed. Radarr/Sonarr and media servers were updated.",
      refresh === "completed" ? "success" : "warning",
    ]);
    if (refresh === "completed") {
      // It stays: the library is asked for the renamed row, the head shows
      // the new name and focus is back on the pencil.
      same(renamed, ["Arrival.mkv"]);
      assert.equal(view.log.filter(([kind]) => kind === "close").length, 0);
      assert.equal(
        text(byClass(tree.props.head, "v2-file-path")[0]),
        "Arrival.mkv",
      );
      same(focus, ["pencil"]);
      // The library hands over its row: the dialog shows it.
      view.props = {
        ...view.props,
        file: baseFile({ filename: "Arrival.mkv", title: "Arrival (2016)" }),
      };
      tree = view.render();
      assert.equal(
        text(byClass(tree.props.head, "v2-file-name")),
        "Title Arrival (2016)",
      );
    } else {
      // Not read again yet: it closes as in 1.7.0.
      same(renamed, [undefined]);
      assert.equal(view.log.filter(([kind]) => kind === "close").length, 1);
    }
  }
  // The library's side: the renamed row of the same service, else none,
  // and the library closes the dialog when the page does not list it.
  const files = [
    { service: "radarr", filename: "Arrival.mkv", id: 7 },
    { service: "radarr-4k", filename: "Other.mkv", id: 8 },
  ];
  assert.equal(rename.renamedRow(files, "radarr", "Arrival.mkv"), files[0]);
  assert.equal(rename.renamedRow(files, "radarr-4k", "Arrival.mkv"), null);
  assert.equal(rename.renamedRow([], "radarr", "Arrival.mkv"), null);
  // The follow-up of a completed rename (I1): it acts only while the dialog
  // is open. New results show the renamed row (or none, which closes it);
  // a dialog closed before they arrive is forgotten and stays closed; a
  // reload that ends without new results (it failed) is forgotten too, so
  // a later change of the list neither opens nor closes the dialog.
  const before = { files: [] },
    after = { files };
  const pending = {
    service: "radarr",
    name: "Arrival.mkv",
    before,
    started: false,
  };
  const step = (p, open, results, busy) =>
    plain(rename.renameFollowUp(p, open, results, busy));
  same(step(null, true, after, false), { pending: null });
  same(step(pending, true, before, false), { pending });
  same(step(pending, true, after, false), { pending: null, file: files[0] });
  same(step({ ...pending, name: "Gone.mkv" }, true, after, false), {
    pending: null,
    file: null,
  });
  // Closed before the results: forgotten, nothing to show.
  same(step(pending, false, before, true), { pending: null });
  same(step(pending, false, after, false), { pending: null });
  // A failed reload: busy, then idle with the same results.
  const running = rename.renameFollowUp(pending, true, before, true);
  same(running, { pending: { ...pending, started: true } });
  same(step(running.pending, true, before, true), { pending: running.pending });
  same(step(running.pending, true, before, false), { pending: null });
  const library = src("components/LibraryPage.tsx");
  assert.match(
    library,
    /renameFollowUp\(renamedTo, !!filename, results, busy\)/,
  );
  assert.match(library, /if \("file" in step\) setFilename\(step\.file\);/);
  assert.match(library, /\[renamedTo, filename, results, busy\]/);
  assert.match(library, /else setFilename\(null\);/);
});

test("the file dialog keeps its mux and MediaInfo actions in fixed slots", async () => {
  const actions = (tree) =>
    footButtons(tree).map(
      (b) =>
        nodes(b)
          .filter(
            (n) => n.type === "span" && !classes(n).includes("v2-btn-alt"),
          )
          .map(text)
          .join("") || text(b),
    );
  const mux = { muxAvailable: true };
  const status = { mediaInfo: { enabled: true, installed: true } };
  // Nothing marked: MediaInfo, then Mark for muxing, then Close.
  let tree = await fileDialog({ props: mux, status }).ready();
  same(actions(tree), ["Read with MediaInfo", "Mark for muxing", "Close"]);
  const [actionsBox] = byClass(tree.props.foot, "v2-file-actions");
  assert.ok(actionsBox, "the actions have their own place");
  // The mux button holds all three texts, one shown, so its width stays.
  const muxButton = footButtons(tree)[1];
  same(
    ofType(muxButton, "span").map((s) => [
      text(s),
      classes(s).includes("v2-btn-alt"),
    ]),
    [
      ["Mark for muxing", false],
      ["Open Muxing tab", true],
      ["Identifying…", true],
    ],
  );
  for (const alt of byClass(muxButton, "v2-btn-alt"))
    assert.equal(alt.props["aria-hidden"], "true");
  const mediaButton = footButtons(tree)[0];
  same(ofType(mediaButton, "span").map(text), [
    "Read with MediaInfo",
    "Read again",
  ]);
  // A waiting job: Remove mux marking stands on the left, Open Muxing tab.
  tree = await fileDialog({
    props: mux,
    status,
    jobs: [{ id: 4, status: "draft" }],
  }).ready();
  same(actions(tree), [
    "Remove mux marking",
    "Read with MediaInfo",
    "Open Muxing tab",
    "Close",
  ]);
  // With a backup it is locked; a running job has none.
  tree = await fileDialog({
    props: mux,
    jobs: [{ id: 4, status: "failed", backupName: "x.bak" }],
  }).ready();
  assert.equal(footButtons(tree)[0].props.disabled, true);
  tree = await fileDialog({
    props: mux,
    jobs: [{ id: 4, status: "running" }],
  }).ready();
  same(actions(tree), ["Open Muxing tab", "Close"]);
  // In the demo, MediaInfo reads are locked with their reason.
  tree = await fileDialog({
    status: { demo: true, mediaInfo: { enabled: true, installed: true } },
    file: baseFile({ mediaInfo: { scannedAt: 1, version: "24" } }),
  }).ready();
  const [read] = footButtons(tree);
  assert.equal(read.props.disabled, true);
  assert.equal(read.props.title, "MediaInfo reads are disabled in demo mode");
  assert.equal(actions(tree)[0], "Read again");
  // Marking: the request, the toast of the mux selection, then Open Muxing.
  const view = fileDialog({
    props: mux,
    answer: (path, method) =>
      path === "mux/jobs" && method === "POST"
        ? { id: 9, status: "draft" }
        : {},
  });
  tree = await view.ready();
  footButtons(tree)[0].props.onClick();
  await settle();
  tree = view.render();
  same(
    view.log.filter(([kind]) => kind === "notify"),
    [["notify", "Marked for muxing.", "success"]],
  );
  assert.equal(actions(tree)[1], "Open Muxing tab");
  // Close is the foot's last button and closes.
  footButtons(tree).at(-1).props.onClick();
  same(view.log.at(-1), ["close"]);
  same(classes(footButtons(tree).at(-1)), ["v2-btn", "v2-btn--primary"]);
});

test("file tabs keep their ids, key and reserved row", async () => {
  // Without MediaInfo the row is reserved and has no tabs.
  let view = fileDialog();
  let tree = await view.ready();
  const bar = tree.props.bar;
  assert.equal(bar.type, "Tabs");
  assert.equal(bar.props.id, "file-detail");
  assert.equal(bar.props.label, "File details");
  assert.equal(bar.props.reserve, true);
  same(bar.props.items, []);
  const [panel] = byClass(tree.props.children, "v2-modal-panel");
  assert.equal(panel.props.id, "file-detail-panel-overview");
  assert.equal(panel.props.role, undefined);
  // With MediaInfo: Overview and MediaInfo; the choice is kept for the
  // session under its 1.7.0 key.
  view = fileDialog({ status: { mediaInfo: { enabled: true } } });
  view.session.set("scopearr-file-dialog-tab", "mediainfo");
  tree = await view.ready();
  same(
    tree.props.bar.props.items.map((item) => item.value),
    ["overview", "mediainfo"],
  );
  assert.equal(tree.props.bar.props.value, "mediainfo");
  assert.equal(ofType(tree.props.children, "MediaInfoPanel").length, 1);
  tree.props.bar.props.change("overview");
  assert.equal(view.session.get("scopearr-file-dialog-tab"), "overview");
  tree = view.render();
  const [overview] = byClass(tree.props.children, "v2-modal-panel");
  assert.equal(overview.props.role, "tabpanel");
  assert.equal(overview.props["aria-labelledby"], "file-detail-tab-overview");
});

test("the overview keeps every section of 1.7.0", async () => {
  const tree = await fileDialog({
    file: baseFile({
      metadataIncomplete: true,
      audioTracks: [
        {
          index: 1,
          language: "de",
          codec: "DTS",
          channels: "5.1",
          default: true,
          title: "Main",
        },
      ],
      mediaServers: {
        emby: {
          status: "matched",
          video: { width: 1920, height: 1080, codec: "h264" },
        },
      },
      seasonOutlier: true,
      seasonReasons: { codec: "x265" },
      recognitionConflicts: [
        {
          field: "resolution",
          values: ["1080p", "2160p"],
          ruleNames: ["A", "B"],
        },
      ],
    }),
    props: { providers: [{ id: "emby", name: "Emby" }] },
  }).ready();
  const body = tree.props.children;
  const [notice] = byClass(body, "v2-notice");
  assert.equal(
    text(notice).trim(),
    "Incomplete metadata. Undetected attributes do not prove their absence.",
  );
  const sections = byClass(body, "v2-modal-sec");
  const headings = sections.map((s) => text(byClass(s, "v2-modal-h")[0]));
  same(headings, [
    "Audio tracks",
    "Media server matching",
    "Season outliers",
    "Conflicting recognition rules",
  ]);
  // The tracks: number, flag, codec as a MediaTag, layout, Default, title.
  const [track] = ofType(byClass(sections[0], "v2-modal-list"), "li");
  assert.equal(ofType(track, "LanguageFlag")[0].props.value, "de");
  const tag = ofType(track, "MediaTag")[0];
  same([tag.props.value, tag.props.kind], ["DTS", "audio"]);
  assert.equal(text(track), "#15.1Default(Main)");
  // Matched from the media server: the help says so.
  const help = ofType(sections[0], "HelpTip")[0];
  assert.equal(help.props.label, "Audio tracks");
  assert.match(
    help.props.text,
    /^Matched using existing media server metadata/,
  );
  assert.equal(
    text(sections[1]),
    "Media server matchingEmby · matched · Video: 1920 × 1080 · h264",
  );
  assert.equal(
    text(sections[2]),
    "Season outliersCodec family: Season majority · x265",
  );
  // Conflicts: the warning color on the icon only, never on the text.
  const conflict = sections[3];
  assert.equal(conflict.props["aria-label"], "Conflicting recognition rules");
  const [h] = byClass(conflict, "v2-modal-h");
  assert.equal(h.props.style, undefined);
  const octagon = nodes(h).find((n) => n.type === icons.OctagonAlert);
  same(octagon.props.style, { color: "#c00" });
  for (const node of nodes(conflict).filter(
    (n) => n.type !== icons.OctagonAlert,
  ))
    assert.equal(node.props?.style, undefined, "no inline color on text");
  assert.equal(
    text(byClass(conflict, "v2-modal-list")),
    "Resolution: 1080p / 2160pA · B",
  );
  // Without tracks: the 1.7.0 fallback paragraphs.
  const fallback = await fileDialog({
    file: baseFile({ audioStreamCount: 2 }),
  }).ready();
  const [audio] = byClass(fallback.props.children, "v2-modal-sec");
  assert.match(
    text(audio),
    /Detected languages: .* · Detected codecs: DTS · 2 audio tracks reported by API/,
  );
  assert.match(
    text(byClass(audio, "v2-modal-hint")),
    /Language → codec mapping unavailable/,
  );
  // A MediaInfo origin shows its date instead of the help.
  const measured = await fileDialog({
    file: baseFile({
      mediaOrigin: "mediainfo",
      mediaInfo: { scannedAt: 0, version: "24" },
      audioTracks: [
        { index: 1, language: "en", codec: "AAC", channels: "2.0" },
      ],
    }),
  }).ready();
  const [audio2] = byClass(measured.props.children, "v2-modal-sec");
  assert.equal(ofType(audio2, "HelpTip").length, 0);
  assert.match(text(byClass(audio2, "v2-modal-hint")[0]), /^MediaInfo · /);
});

test("the evidence table keeps its columns, marks and hints", async () => {
  const evidence = {
    resolution: {
      filename: "1080p",
      api: "720p",
      emby: "1080p",
      apiDiffers: true,
      origin: "filename",
    },
    source: {
      filename: "BluRay",
      api: "Bluray-1080p",
      emby: "",
      origin: "filename",
    },
    language: {
      filename: "de",
      api: "de",
      emby: "en",
      conflict: true,
      mediaServerDiffers: true,
      origin: "filename",
    },
  };
  const table = (tree) => ofType(tree.props.children, "table")[0];
  let tree = await fileDialog({ file: baseFile({ evidence }) }).ready();
  let t1 = table(tree);
  same(classes(t1), ["v2-table"]);
  const heads = ofType(ofType(t1, "thead"), "th");
  same(heads.map(text), [
    "Attribute",
    "Filename",
    "Radarr / Sonarr",
    "Media server",
    "Used",
  ]);
  for (const th of heads) assert.equal(th.props.scope, "col");
  const rows = ofType(ofType(t1, "tbody"), "tr");
  same(
    rows.map((r) => r.props.class),
    ["v2-row", "v2-row", "v2-row v2-row--warn"],
  );
  for (const row of rows) {
    const [th, ...cells] = ofType(row, "th").concat(ofType(row, "td"));
    assert.equal(th.props.scope, "row");
    same(
      cells.map((c) => c.props["data-label"]),
      ["Filename", "Radarr / Sonarr", "Media server", "Used"],
    );
  }
  // The info icons are named images.
  const images = nodes(t1).filter((n) => n.props?.role === "img");
  same(
    images.map((n) => n.props["aria-label"]),
    [
      "The file and media server agree. Radarr/Sonarr report a different value; shown for information only.",
      "MediaInfo reports a different value; shown for information only.",
    ],
  );
  for (const image of images)
    assert.equal(image.props.title, image.props["aria-label"]);
  // A broader Arr category is a hint.
  const category = nodes(rows[1]).find(
    (n) => text(n) === "Category" && n.type === "span",
  );
  assert.equal(
    category.props.title,
    "Radarr/Sonarr report a broader category; the filename is more specific.",
  );
  // A conflict: the TriangleAlert in the metadata color, the row on the
  // warning edge, the text without a color.
  const triangle = nodes(rows[2]).find((n) => n.type === icons.TriangleAlert);
  same(triangle.props.style, { color: "#a60" });
  assert.equal(triangle.props["aria-hidden"], "true");
  // The Used column hands each field to the evidence menu.
  const menus = ofType(t1, "EvidenceSourceMenu");
  same(
    menus.map((m) => m.props.field),
    ["Resolution", "Source", "Language"],
  );
  assert.equal(menus[2].props.ruleConflict, false);
  // With a MediaInfo result there is a MediaInfo column.
  tree = await fileDialog({
    file: baseFile({
      evidence: { resolution: { ...evidence.resolution, mediainfo: "1080p" } },
      mediaInfo: { scannedAt: 1, version: "24" },
    }),
  }).ready();
  t1 = table(tree);
  same(ofType(ofType(t1, "thead"), "th").map(text), [
    "Attribute",
    "Filename",
    "Radarr / Sonarr",
    "Media server",
    "MediaInfo",
    "Used",
  ]);
  // The table scrolls on its own.
  same(classes(byClass(tree.props.children, "v2-table-scroll")[0]), [
    "v2-table-scroll",
  ]);
});

test("the evidence menu is a popover menu of sources", async () => {
  const runtime = createHookRuntime();
  const { EvidenceSourceMenu } = loadSource(
    "components/EvidenceSourceMenu.tsx",
    {
      modules: {
        "preact/hooks": runtime.hooks,
        "../evidence-source": loadSource("evidence-source.ts"),
        "../i18n": i18n,
        "../ui": { ICON },
        "./frame/Popover": { Popover: "Popover" },
      },
    },
  );
  const chosen = [];
  const props = {
    evidence: {
      filename: "1080p",
      api: "720p",
      emby: "1080p",
      origin: "filename",
      conflict: true,
      confirmed: { source: "api", value: "720p", at: 0 },
    },
    field: "Resolution",
    ruleConflict: false,
    busy: false,
    choose: async (source) => chosen.push(source),
  };
  const render = () => runtime.settle(() => EvidenceSourceMenu(props));
  let tree = render();
  const [trigger] = ofType(tree, "button");
  same(classes(trigger), ["v2-text-btn"]);
  assert.equal(trigger.props["aria-label"], "Choose source for Resolution");
  assert.equal(trigger.props["aria-haspopup"], "menu");
  assert.equal(trigger.props["aria-expanded"], false);
  assert.ok(nodes(trigger).some((n) => n.type === icons.ChevronDown));
  // The confirmed mark names the confirmation.
  const mark = nodes(trigger).find((n) => n.props?.role === "img");
  assert.match(
    mark.props["aria-label"],
    /^Confirmed manually: Radarr \/ Sonarr · 720p · /,
  );
  const anchor = { focus: () => chosen.push("focus anchor") };
  trigger.props.onClick({ currentTarget: anchor });
  tree = render();
  const [pop] = ofType(tree, "Popover");
  assert.equal(pop.props.role, "menu");
  assert.equal(pop.props.label, "Choose source for Resolution");
  assert.equal(pop.props.placement, "bottom-end");
  assert.equal(pop.props.anchor, anchor);
  assert.equal(ofType(tree, "button")[0].props["aria-expanded"], true);
  const items = ofType(pop, "button");
  same(
    items.map((b) => [
      b.props.role,
      b.props["aria-checked"],
      text(b),
      b.props.class,
    ]),
    [
      ["menuitemradio", false, "Filename · 1080p", "v2-menu-item"],
      ["menuitemradio", true, "Radarr / Sonarr · 720p", "v2-menu-item"],
      ["menuitemradio", false, "Media server · 1080p", "v2-menu-item"],
      ["menuitem", undefined, "Automatic", "v2-menu-item"],
    ],
  );
  // Automatic comes after a separator.
  const children = nodes(pop);
  const sep = children.find((n) => n.props?.role === "separator");
  same(classes(sep), ["v2-menu-sep"]);
  assert.ok(children.indexOf(sep) < children.indexOf(items[3]));
  items[2].props.onClick();
  await settle();
  same(chosen, ["focus anchor", "mediaServer"]);
  assert.equal(ofType(render(), "Popover").length, 0, "the menu closes");
  ofType(render(), "button")[0].props.onClick({ currentTarget: anchor });
  ofType(ofType(render(), "Popover")[0], "button")[3].props.onClick();
  await settle();
  same(chosen.slice(2), ["focus anchor", null]);
  // The Popover's close closes it.
  ofType(render(), "button")[0].props.onClick({ currentTarget: anchor });
  ofType(render(), "Popover")[0].props.close();
  assert.equal(ofType(render(), "Popover").length, 0);
  // Without a confirmation: no separator, no Automatic.
  props.evidence = { ...props.evidence, confirmed: undefined };
  ofType(render(), "button")[0].props.onClick({ currentTarget: anchor });
  const plain = ofType(render(), "Popover")[0];
  assert.equal(
    nodes(plain).filter((n) => n.props?.role === "separator").length,
    0,
  );
  same(
    ofType(plain, "button").map((b) => b.props.role),
    ["menuitemradio", "menuitemradio", "menuitemradio"],
  );
  // The dialog toasts what was chosen (literal).
  const dialog = src("components/FileDialog.tsx");
  assert.match(dialog, /t\("Confirmed: \{field\} uses \{source\}\.", \{/);
  assert.match(dialog, /t\("Confirmation removed\."\)/);
  assert.match(dialog, /"files\/confirmation",\s*"PUT"/);
  assert.match(dialog, /"DELETE",/);
});

test("MediaInfo keeps its sections, key and track tables", () => {
  const session = new Map();
  // A fresh mount: its own hook state, the session as it stands.
  const mount = () => {
    const runtime = createHookRuntime();
    const { MediaInfoPanel } = loadSource("components/MediaInfoPanel.tsx", {
      modules: {
        "preact/hooks": runtime.hooks,
        "../i18n": i18n,
        "../browser-storage": {
          readSessionPreference: (key) => session.get(key) ?? "",
          writeSessionPreference: (key, value) => session.set(key, value),
        },
        "../languages": { audioLanguageLabel: (value) => value },
        "../ui": { labels },
        "./dialog/Tabs": { Tabs: "Tabs" },
        "../mediainfo": loadSource("mediainfo.ts", {
          modules: {
            "./audio-channels.ts": loadSource("audio-channels.ts", {
              modules: {
                "./confirmation-summary.ts": loadSource(
                  "confirmation-summary.ts",
                ),
              },
            }),
          },
        }),
      },
    });
    return { runtime, MediaInfoPanel };
  };
  const file = (mediaInfo) => baseFile({ resolution: "1080p", mediaInfo });
  // Not read yet: the hint, no tabs.
  let { runtime, MediaInfoPanel } = mount();
  let tree = runtime.settle(() => MediaInfoPanel({ file: file(undefined) }));
  assert.equal(tree.props.id, "file-detail-panel-mediainfo");
  assert.equal(tree.props.role, "tabpanel");
  assert.equal(
    text(byClass(tree, "v2-modal-hint")),
    "Not read yet. Use Read with MediaInfo below.",
  );
  assert.equal(ofType(tree, "Tabs").length, 0);
  const result = {
    scannedAt: 0,
    version: "24.06",
    values: { resolution: "1080p" },
    tracks: [
      { type: "General", fields: { Format: "Matroska" } },
      {
        type: "Audio",
        fields: { Language: "de", Default: "Yes", Format: "DTS" },
      },
      { type: "Audio", fields: { Language: "en", Format: "AAC" } },
    ],
  };
  session.set("scopearr-mediainfo-section", "Audio");
  ({ runtime, MediaInfoPanel } = mount());
  tree = runtime.settle(() =>
    MediaInfoPanel({ file: file(result), error: "Failed" }),
  );
  const [error] = byClass(tree, "v2-notice");
  same(classes(error), ["v2-notice", "v2-notice--error"]);
  assert.equal(error.props.role, "alert");
  const [tabs] = ofType(tree, "Tabs");
  assert.equal(tabs.props.id, "mediainfo-section");
  assert.equal(tabs.props.label, "MediaInfo sections");
  assert.match(tabs.props.accessory, /^Last read: .* · MediaInfo 24\.06$/);
  // Only sections with data.
  same(
    tabs.props.items.map((i) => [i.value, i.label]),
    [
      ["result", "Result"],
      ["General", "General"],
      ["Audio", "Audio (2)"],
    ],
  );
  assert.equal(tabs.props.value, "Audio");
  // Several tracks: one table in a named, focusable region, its first
  // column sticky, a track per column.
  const region = nodes(tree).find((n) => n.props?.role === "region");
  assert.equal(region.props["aria-label"], "Audio (2)");
  assert.equal(region.props.tabIndex, 0);
  const [table] = ofType(region, "table");
  same(classes(table), ["v2-table", "v2-table--sticky-first"]);
  same(ofType(ofType(table, "thead"), "th").map(text), [
    "Attribute",
    "#1 · de Default",
    "#2 · en",
  ]);
  const panel = nodes(tree).find(
    (n) => n.props?.id === "mediainfo-section-panel-Audio",
  );
  assert.equal(panel.props.role, "tabpanel");
  // The choice is kept for the session under its 1.7.0 key.
  tabs.props.change("General");
  assert.equal(session.get("scopearr-mediainfo-section"), "General");
  tree = runtime.settle(() => MediaInfoPanel({ file: file(result) }));
  const single = ofType(tree, "table")[0];
  same(classes(single), ["v2-table"]);
  same(ofType(ofType(single, "thead"), "th").map(text), ["Attribute", "Value"]);
  // A section without data falls back to Result.
  session.set("scopearr-mediainfo-section", "Text");
  tabs.props.change("Text");
  tree = runtime.settle(() => MediaInfoPanel({ file: file(result) }));
  assert.equal(ofType(tree, "Tabs")[0].props.value, "result");
  assert.equal(session.get("scopearr-mediainfo-section"), "result");
  same(ofType(ofType(ofType(tree, "table")[0], "thead"), "th").map(text), [
    "Attribute",
    "Scopearr value",
    "MediaInfo",
  ]);
});

test("the companion dialog renames with or without companions", () => {
  const saved = [];
  const preview = (override = {}) => ({
    filename: "New.mkv",
    device: "disk1",
    userShare: true,
    companions: [
      {
        from: "Old.de.srt",
        to: "New.de.srt",
        conflict: false,
        device: "cache",
      },
    ],
    ...override,
  });
  const dialog = (p) => {
    const r = createHookRuntime();
    const loaded = loadSource("components/RenameCompanionsDialog.tsx", {
      modules: {
        "preact/hooks": r.hooks,
        "../i18n": i18n,
        "../ui": { ICON },
        "../file-rename": rename,
        "./settings/Check": loadSource("components/settings/Check.tsx"),
      },
      stubs: PRESENTATION_MODULES,
    });
    const props = {
      preview: p,
      close: () => saved.push("close"),
      save: (c) => saved.push(c),
    };
    return () => r.settle(() => loaded.RenameCompanionsDialog(props));
  };
  // Companions that can all be renamed: the box is on.
  let render = dialog(preview());
  let tree = render();
  assert.equal(tree.type, "Modal");
  assert.equal(tree.props.id, "renameCompanions");
  assert.equal(tree.props.title, "Companion files found");
  const box = () => ofType(render(), "input")[0];
  assert.equal(box().props.checked, true);
  assert.equal(box().props.disabled, false);
  const label = nodes(tree).find((n) => classes(n).includes("v2-ff-check"));
  assert.match(text(label), /Rename companion files too/);
  // Every file with its disk.
  const disks = ofType(tree, "ToolDiskTag").map((d) => d.props.disk);
  same(disks, ["disk1", "cache"]);
  same(ofType(tree, "code").map(text), ["New.mkv", "Old.de.srt → New.de.srt"]);
  const hint = byClass(tree, "v2-modal-hint")[0];
  assert.equal(text(hint), "Renamed through the user share");
  assert.equal(
    hint.props.title,
    "Set up Unraid under Settings → Services → Unraid to rename directly on the disk.",
  );
  // One button renames: with the box, without it unchecked.
  const buttons = () => ofType(render().props.foot, "button");
  same(buttons().map(text), ["Cancel", "Rename file"]);
  buttons()[1].props.onClick();
  box().props.onChange({ currentTarget: { checked: false } });
  buttons()[1].props.onClick();
  buttons()[0].props.onClick();
  same(saved.splice(0), [true, false, "close"]);
  // A conflict: the box off and locked, the notice, the mark named.
  render = dialog(
    preview({
      companions: [{ from: "a.srt", to: "b.srt", conflict: true, device: "" }],
    }),
  );
  tree = render();
  assert.equal(box().props.checked, false);
  assert.equal(box().props.disabled, true);
  const [notice] = byClass(tree, "v2-notice");
  same(classes(notice), ["v2-notice", "v2-notice--warn"]);
  assert.equal(text(notice), "A target name already exists");
  const mark = nodes(tree).find((n) => n.type === icons.TriangleAlert);
  assert.equal(mark.props["aria-label"], "A target name already exists");
  buttons()[1].props.onClick();
  same(saved.splice(0), [false]);
  // No companions: Rename file, no box.
  render = dialog(preview({ companions: [], userShare: false }));
  tree = render();
  assert.equal(tree.props.title, "Rename file");
  assert.equal(ofType(tree, "input").length, 0);
  assert.equal(byClass(tree, "v2-modal-hint").length, 0);
  buttons()[1].props.onClick();
  same(saved.splice(0), [false]);
});

test("the file dialog loads as a chunk of its own", () => {
  // The library preloads it at idle and opens it through useLazyChunk; a
  // chunk that cannot load closes it (the hook's notice).
  const chunk = src("components/library/file-dialog-chunk.ts");
  assert.match(chunk, /lazyChunk<typeof FileDialog>\(\(\) =>/);
  assert.match(
    chunk,
    /import\("\.\.\/FileDialog"\)\.then\(\s*\(chunk\) => chunk\.FileDialog,\s*\(\) => null,/,
  );
  const library = src("components/LibraryPage.tsx");
  assert.doesNotMatch(library, /from "\.\/FileDialog"/);
  assert.match(library, /\{filename && FileDialog && \(/);
  // It preloads only where it can open: the libraries (M5).
  assert.match(
    library,
    /useLazyChunk\(\s*fileDialogChunk,\s*!!filename,\s*\(\) => setFilename\(null\),\s*navigation\.view === "library",?\s*\)/,
  );
});
