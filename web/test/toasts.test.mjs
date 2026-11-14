import test from "node:test";
import assert from "node:assert/strict";
import { nodes, text } from "./helpers/component-harness.mjs";
import { catalog, browser } from "./helpers/toast-window.mjs";
import { src } from "./helpers/sources.mjs";
import { loadSource } from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";

// The v2 toasts (Phase 5d, Task 4; docs/STYLEGUIDE.md, Part 1, 10.8): the
// region is a named region, each toast keeps its 1.7.0 behavior in the v2
// look, and a link's text follows the language. Notifications runs as real
// code over one fake window.

const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const cls = (node) => String(node?.props?.class ?? "").split(" ");
const byClass = (tree, name) =>
  nodes(tree).filter((n) => cls(n).includes(name));
const MUXING = { label: "Open Muxing", hash: "#/tools/mux" };

test("the toast region is a named region", () => {
  const view = browser({ popover: true });
  const { tree } = view.render();
  assert.equal(tree.type, "div");
  assert.equal(tree.props.role, "region");
  assert.equal(tree.props["aria-label"], "Notifications");
  assert.equal(tree.props.popover, "manual");
  assert.ok(cls(tree).includes("v2-toasts"));
  assert.ok(!cls(tree).includes("toast-region"), "no 1.7.0 region class");
  // The name follows the language.
  catalog["Notifications"] = "Meldungen";
  try {
    assert.equal(view.render().tree.props["aria-label"], "Meldungen");
  } finally {
    delete catalog["Notifications"];
  }
});

test("toasts keep their 1.7.0 behavior in the v2 look", () => {
  const view = browser();
  view.notify("Filter view saved.");
  view.notify("Sync failed.", "warning", { source: ["sync"] });
  view.notify("Request failed.", "error");
  const { toasts } = view.render();
  // One toast: tile, text, link, dismiss; tone and role by kind.
  const looks = toasts.map(([vnode, toast]) => ({
    message: vnode.props.item.message,
    remaining: vnode.props.item.remaining,
    tone: toast.props["data-tone"],
    role: toast.props.role,
    classes: [...cls(toast)].filter(Boolean),
    parts: [...toast.props.children]
      .flat(Infinity)
      .filter(Boolean)
      .map((n) => n.type + "." + [...cls(n)].filter(Boolean).join(".")),
  }));
  assert.deepEqual(
    looks.map((l) => [l.message, l.tone, l.role, l.remaining]),
    [
      ["Filter view saved.", "ok", "status", 5000],
      ["Sync failed.", "warn", "status", 8000],
      ["Request failed.", "error", "alert", 8000],
    ],
  );
  for (const look of looks) assert.deepEqual(look.classes, ["v2-toast"]);
  assert.deepEqual(looks[0].parts, [
    "span.v2-toast-tile",
    "p.v2-toast-text",
    "button.v2-icon-btn.v2-icon-btn--sm",
  ]);
  assert.deepEqual(looks[1].parts, [
    "span.v2-toast-tile",
    "p.v2-toast-text",
    "button.v2-text-btn",
    "button.v2-icon-btn.v2-icon-btn--sm",
  ]);
  // The tile and the text (the icon is aria-hidden in the tile).
  const [, success] = toasts[0];
  assert.equal(
    text(byClass(success, "v2-toast-text")[0]),
    "Filter view saved.",
  );
  const tile = byClass(success, "v2-toast-tile")[0];
  assert.equal(tile.props["aria-hidden"], "true");
  // The dismiss button is named.
  const dismiss = byClass(success, "v2-icon-btn")[0];
  assert.equal(dismiss.props["aria-label"], "Dismiss notification");
  assert.equal(dismiss.props.type, "button");

  // At most four, the oldest goes; one of the same message and kind.
  const crowd = browser();
  for (const n of [1, 2, 3, 4, 5]) crowd.notify("Message " + n);
  crowd.notify("Message 5");
  assert.deepEqual(
    crowd.render().toasts.map(([v]) => v.props.item.message),
    ["Message 2", "Message 3", "Message 4", "Message 5"],
  );
  crowd.notify("Message 5", "error");
  assert.equal(crowd.render().toasts.length, 4);
  assert.equal(crowd.render().toasts.at(-1)[0].props.item.kind, "error");
});

test("a toast pauses on hover and focus and resumes with what is left", () => {
  const view = browser();
  view.notify("Filter view saved.");
  const [[vnode]] = view.render().toasts;
  const { tree } = view.mount(vnode);
  const live = () => view.timers.filter((timer) => timer.live);
  assert.equal(live().length, 1, "its time runs");
  assert.equal(live()[0].ms, 5000);
  tree.props.onMouseEnter();
  assert.equal(live().length, 0, "hover pauses");
  tree.props.onMouseLeave();
  assert.equal(live().length, 1, "leaving resumes");
  tree.props.onFocusIn();
  assert.equal(live().length, 0, "focus pauses");
  // Focus moving within the toast keeps the pause, leaving it resumes.
  tree.props.onFocusOut({
    relatedTarget: {},
    currentTarget: { contains: () => true },
  });
  assert.equal(live().length, 0);
  tree.props.onFocusOut({
    relatedTarget: null,
    currentTarget: { contains: () => false },
  });
  assert.equal(live().length, 1);
});

test("a toast link follows its target and closes the toast", () => {
  const view = browser();
  view.notify("Marked for muxing.", undefined, undefined, MUXING);
  let [[vnode, toast]] = view.render().toasts;
  // A link lasts 8 s like an error (F3).
  assert.equal(vnode.props.item.remaining, 8000);
  assert.deepEqual(byClass(toast, "v2-text-btn").map(text), ["Open Muxing"]);
  // The link text is the catalog's when the toast shows: another language
  // changes it without a new toast.
  catalog["Open Muxing"] = "Zum Muxen";
  try {
    const [[again, german]] = view.render().toasts;
    assert.equal(again.props.item.id, vnode.props.item.id);
    assert.deepEqual(byClass(german, "v2-text-btn").map(text), ["Zum Muxen"]);
    // The press follows the hash, not the text.
    byClass(german, "v2-text-btn")[0].props.onClick();
  } finally {
    delete catalog["Open Muxing"];
  }
  assert.deepEqual(view.links, [["#/tools/mux", true]]);
  assert.equal(view.render().toasts.length, 0, "the press closes the toast");
  // Show in log comes first, at the same place, and a link needs no log.
  view.notify("Both.", "warning", { level: ["error"] }, MUXING);
  [[, toast]] = view.render().toasts;
  assert.deepEqual(byClass(toast, "v2-text-btn").map(text), ["Show in log"]);
});

test("marking from the file dialog offers Open Muxing", () => {
  // markedForMuxing builds the one toast of a marking; the mux selection
  // and the file dialog send the same message, kind and action, so a
  // marking from either dedupes with the other. The label is a catalog key.
  const { markedForMuxing } = loadSource("mux-selection.ts", {
    modules: { "./file-selection.ts": loadSource("file-selection.ts") },
  });
  const t = (key, values = {}) =>
    key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
  assert.deepEqual(plain(markedForMuxing(1, true, t)), [
    "Marked for muxing.",
    "success",
    null,
    MUXING,
  ]);
  assert.deepEqual(plain(markedForMuxing(3, false, t)), [
    "3 items marked for muxing.",
    "success",
    null,
    MUXING,
  ]);
  // One file, as a selection counted by `ok` (a partly marked selection).
  assert.equal(markedForMuxing(2, true, t)[0], "Marked for muxing.");
  const dialog = src("components/FileDialog.tsx");
  assert.match(dialog, /notify\(\.\.\.markedForMuxing\(1, true, t\)\)/);
  assert.doesNotMatch(dialog, /notify\(t\("Marked for muxing\."\)/);
  assert.match(
    src("hooks/useMuxSelection.ts"),
    /notify\(\.\.\.markedForMuxing\(result\.ok, n === 1, t\)\)/,
  );
  // Notifications translates the label when it shows.
  assert.match(src("components/Notifications.tsx"), /t\(item\.action\.label\)/);
});

test("a press in the toasts is not one outside a menu, and the toast takes none of the focus", () => {
  const notifications = src("notifications.ts");
  assert.match(notifications, /closest\?\.\("\.v2-toasts"\)/);
  assert.doesNotMatch(notifications, /toast-region/);
  // The rail's flyout (E25): focus moving into a toast keeps it open.
  assert.match(src("components/frame/Sidebar.tsx"), /!inToasts\(next\)/);
  // A press on the toast's text keeps the focus where it was.
  assert.match(src("components/Notifications.tsx"), /onMouseDown/);
});
