import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSource, nodes, text } from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { squash, src } from "./helpers/sources.mjs";
import { browser, i18n, t } from "./helpers/toast-window.mjs";

// V14 (Phase 5b, task 11; docs/STYLEGUIDE.md, Part 1, 10.8): after files
// are marked for muxing, the success toast offers Open Muxing, which
// follows the in-app link of Show in log (openHash, LINK_EVENT) to the
// Muxing page and closes the toast. Notifications and the mux selection
// run as real code with the hook runtime; notify, openHash and openLog
// are the real modules over one fake window. Without an action a toast
// renders the VNodes recorded when Task 4 of Phase 5d gave it the v2 look
// (goldens/).

const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const classes = (node) => String(node?.props?.class ?? "").split(" ");
const MUXING = { label: "Open Muxing", hash: "#/tools/mux" };

// --- useMuxSelection -----------------------------------------------------

// The mux selection with a notify that records every argument.
function muxSelection({ files, jobs = [], translate = t }) {
  const runtime = createHookRuntime();
  const toasts = [];
  const fileSelection = loadSource("file-selection.ts");
  const { useMuxSelection } = loadSource("hooks/useMuxSelection.ts", {
    modules: {
      "preact/hooks": runtime.hooks,
      "../api": {
        async api(path, method, body) {
          if (body?.fileId === 13) throw new Error("locked");
          return {};
        },
      },
      "../confirmation": {
        confirmAction: async () => true,
        confirmDeletion: async () => true,
      },
      "../file-selection": fileSelection,
      "../i18n": { ...i18n, t: translate },
      "../mux-selection": loadSource("mux-selection.ts", {
        modules: { "./file-selection.ts": fileSelection },
      }),
      "../notifications": {
        notify: (...args) => toasts.push(plain(args)),
      },
    },
  });
  const props = {
    files,
    jobs,
    installed: true,
    changed: async () => {},
    busyChanged: () => {},
  };
  return {
    toasts,
    run: (remove) => runtime.settle(() => useMuxSelection(props)).run(remove),
  };
}
const key = (id) => ({ service: "radarr", id });

test("marking files offers a link to Muxing", async () => {
  // One file and several: the success toast carries Open Muxing.
  let h = muxSelection({ files: [key(1)] });
  await h.run(false);
  assert.deepEqual(h.toasts, [["Marked for muxing.", "success", null, MUXING]]);
  h = muxSelection({
    files: [key(1), key(2), key(3)],
    jobs: [{ service: "radarr", fileId: 2, id: 9, status: "draft" }],
  });
  await h.run(false);
  assert.deepEqual(h.toasts, [
    ["2 items marked for muxing.", "success", null, MUXING],
  ]);
  // Its label is a catalog key (the toast translates it when it shows),
  // its message is translated at once.
  const de = { "Open Muxing": "Zum Muxen", "Marked for muxing.": "Vorgemerkt" };
  h = muxSelection({ files: [key(1)], translate: (k, v) => de[k] ?? t(k, v) });
  await h.run(false);
  assert.deepEqual(h.toasts, [["Vorgemerkt", "success", null, MUXING]]);
  // A failure, even a partial one, and a removal carry none.
  h = muxSelection({ files: [key(12), key(13)] });
  await h.run(false);
  assert.deepEqual(h.toasts, [["1 marked, 1 not possible: locked", "warning"]]);
  h = muxSelection({ files: [key(13)] });
  await h.run(false);
  assert.deepEqual(h.toasts, [["0 marked, 1 not possible: locked", "warning"]]);
  h = muxSelection({
    files: [key(4)],
    jobs: [{ service: "radarr", fileId: 4, id: 4, status: "draft" }],
  });
  await h.run(true);
  assert.deepEqual(h.toasts, [["Mux marking removed."]]);
});

// --- Notifications -------------------------------------------------------

const buttons = (tree) => nodes(tree).filter((n) => n.type === "button");
const textButton = (tree) =>
  buttons(tree).filter((n) => classes(n).includes("v2-text-btn"));

// The shape of a VNode tree, as goldens/ records it: every prop, an
// undefined one and a function by a marker, so a new prop key shows even
// when its value is undefined.
function shape(node) {
  if (Array.isArray(node)) return node.map(shape);
  if (node == null || typeof node === "boolean") return null;
  if (typeof node !== "object") return String(node);
  const type =
    typeof node.type === "function"
      ? "fn:" + (node.type.displayName || node.type.name)
      : node.type;
  const props = {};
  for (const [key, value] of Object.entries(node.props ?? {})) {
    if (key === "children") continue;
    props[key] =
      value === undefined
        ? "<undefined>"
        : typeof value === "function"
          ? "<function>"
          : key === "item"
            ? plain(value)
            : value;
  }
  return {
    type,
    key: node.key ?? null,
    props,
    children: shape(node.props?.children),
  };
}
const GOLDEN = JSON.parse(
  readFileSync(new URL("./goldens/toast-v2.json", import.meta.url), "utf8"),
);
// The toasts the golden records: a success, a warning with a log filter
// and an error, shown together.
function goldenToasts(view) {
  view.notify("Filter view saved.");
  view.notify("Sync failed.", "warning", { source: ["sync"] });
  view.notify("Request failed.", "error");
  const { tree, toasts } = view.render();
  return plain({
    region: shape(tree),
    toasts: toasts.map(([, toast]) => shape(toast)),
  });
}

test("the toast action navigates like Show in log", () => {
  // Without an action a toast keeps its v2 tree.
  assert.deepEqual(goldenToasts(browser()), GOLDEN.toasts);
  // Open Muxing: a text button as Show in log, after the message.
  let view = browser();
  view.notify("Marked for muxing.", undefined, undefined, MUXING);
  let [[vnode, toast]] = view.render().toasts;
  assert.deepEqual(plain(vnode.props.item.action), MUXING);
  const [open] = textButton(toast);
  assert.equal(text(open), "Open Muxing");
  assert.equal(open.props.type, "button");
  assert.deepEqual(
    buttons(toast).map((b) => text(b) || b.props["aria-label"]),
    ["Open Muxing", "Dismiss notification"],
  );
  // A press sends the link event, sets the hash and closes the toast.
  open.props.onClick();
  assert.deepEqual(view.links, [["#/tools/mux", true]]);
  assert.equal(view.win.location.hash, "#/tools/mux");
  assert.equal(view.render().toasts.length, 0);
  // A link to the shown route is cancelled by the route history: the
  // hash stays, the toast still closes.
  view = browser();
  view.win.location.hash = "#/tools/mux?q=Alien";
  view.win.addEventListener("scopearr:link", (event) => event.preventDefault());
  view.notify("Marked for muxing.", undefined, undefined, MUXING);
  textButton(view.render().toasts[0][1])[0].props.onClick();
  assert.deepEqual(view.links, [["#/tools/mux", true]]);
  assert.equal(view.win.location.hash, "#/tools/mux?q=Alien");
  assert.equal(view.render().toasts.length, 0);
  // Show in log takes the same way, and closes its toast as well.
  view = browser();
  view.notify("Sync failed.", "warning", { source: ["mux"] });
  [[, toast]] = view.render().toasts;
  const [log] = textButton(toast);
  assert.equal(text(log), "Show in log");
  log.props.onClick();
  assert.deepEqual(view.links, [["#/settings/system/log?source=mux", true]]);
  assert.equal(view.win.location.hash, "#/settings/system/log?source=mux");
  assert.equal(view.render().toasts.length, 0);
  // A toast offers one link in that place: with a log filter Show in log.
  view = browser();
  view.notify("Both.", "warning", { level: ["error"] }, MUXING);
  assert.deepEqual(textButton(view.render().toasts[0][1]).map(text), [
    "Show in log",
  ]);
});

test("openLog keeps its links", () => {
  const view = browser();
  const { openHash, openLog } = view.eventLog;
  for (const [filter, hash] of [
    [
      { source: ["sync"], instance: ["radarr"] },
      "#/settings/system/log?source=sync&instance=radarr",
    ],
    [
      { q: "A & B #1", level: ["error", "warning"], source: ["mux"] },
      "#/settings/system/log?q=A+%26+B+%231&level=error&level=warning&source=mux",
    ],
    [{}, "#/settings/system/log"],
  ]) {
    openLog(filter);
    assert.deepEqual(view.links.at(-1), [hash, true]);
    assert.equal(view.win.location.hash, hash);
  }
  // openHash is that link for any hash; openLog builds its hash and calls it.
  openHash("#/tools/files?q=Alien");
  assert.deepEqual(view.links.at(-1), ["#/tools/files?q=Alien", true]);
  assert.equal(view.win.location.hash, "#/tools/files?q=Alien");
  view.win.addEventListener("scopearr:link", (event) => event.preventDefault());
  openLog({ level: ["error"] });
  assert.deepEqual(view.links.at(-1), [
    "#/settings/system/log?level=error",
    true,
  ]);
  assert.equal(view.win.location.hash, "#/tools/files?q=Alien");
  assert.match(
    squash(src("event-log.ts")),
    /export function openLog\(filter: LogFilter = \{\}\) \{ const query = logQuery\(filter\); const hash = "#\/settings\/system\/log" \+ \(query \? "\?" \+ query : ""\); openHash\(hash\); \}/,
  );
});
