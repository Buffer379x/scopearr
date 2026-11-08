import test from "node:test";
import assert from "node:assert/strict";
import * as preact from "preact";
import { loadSource, nodes, text } from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { channelRows } from "../src/audio-channels.ts";
import * as color from "../src/color.ts";
import * as languages from "../src/languages.ts";
import * as resolution from "../src/resolution-groups.ts";
import * as tagDisplay from "../src/tag-display.ts";
import * as tagLabels from "../src/tag-labels.ts";
import * as tracks from "../src/tracks.ts";
import * as units from "../src/units.ts";

// The audio tracks of the libraries (Phase 5a, task 4; docs/STYLEGUIDE.md,
// Part 1, 2.5 and 10.10): TrackChip and LooseChip, TracksCell, TrackMenu
// and TracksPopover, built but not mounted yet. Each component runs as real
// code with the hook runtime; Popover and LanguageFlag are named stubs, so
// a tree shows what they receive.

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const i18n = { t, getLocale: () => "en", useI18n: () => ({ locale: "en" }) };

// Every module shares one hooks object; it calls the runtime that renders.
let current = createHookRuntime();
const hooks = new Proxy({}, { get: (_, name) => current.hooks[name] });
// The real ui.tsx: its tag contexts.
const ui = loadSource("ui.tsx", {
  modules: {
    "./units": units,
    "./i18n": i18n,
    "./resolution-groups": resolution,
    "./tag-labels": tagLabels,
    "./color": color,
    "./tag-display": tagDisplay,
    preact,
    "preact/compat": { createPortal: (vnode) => vnode },
    "preact/hooks": hooks,
  },
});

// The tag contexts with the defaults of their providers' absence.
const CONTEXTS = [
  ["TagVisibility", "visibility", null],
  ["TagLabels", "labels", {}],
  ["SDListGrouping", "groupSD", false],
  ["TagInformation", "information", {}],
  ["TagColors", "colors", {}],
  ["TagTextColors", "textColors", {}],
  ["HiddenTags", "hidden", {}],
  ["CustomTagNames", "names", {}],
];
const tagContexts = (values = {}) =>
  new Map(
    CONTEXTS.map(([name, key, fallback]) => [
      ui[name],
      values[key] ?? fallback,
    ]),
  );
// A component with its own runtime; render() renders it again with the same
// state (after a click), as Preact would.
function mount(component, props, contexts) {
  const runtime = createHookRuntime({ contexts: tagContexts(contexts) });
  return {
    runtime,
    render() {
      current = runtime;
      return runtime.render(() => component(props));
    },
  };
}
const once = (component, props, contexts) =>
  mount(component, props, contexts).render();
// A tree with every function component rendered (each with its own runtime
// and the same contexts); string stubs stay as they are.
function expand(node, contexts) {
  if (Array.isArray(node)) return node.map((child) => expand(child, contexts));
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function")
    return expand(once(node.type, node.props, contexts), contexts);
  return {
    type: node.type,
    props: { ...node.props, children: expand(node.props.children, contexts) },
  };
}
// A VNode as plain data: type, props and children; undefined props and
// functions drop out, as they set nothing in the DOM, and so do the holes
// (null, false) a condition leaves.
function shape(node) {
  if (Array.isArray(node)) {
    const children = node
      .flat(Infinity)
      .map(shape)
      .filter((child) => child !== null);
    return children.length === 1 ? children[0] : children;
  }
  if (node === false || node === undefined || node === null) return null;
  if (typeof node !== "object") return node;
  const { children, ...props } = node.props;
  return { type: node.type, props, children: shape(children) };
}
// A value of the sandbox as data of this realm.
const data = (value) => JSON.parse(JSON.stringify(value ?? null));
const plain = (node) => data(shape(node));
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
const byRole = (tree, role) =>
  nodes(tree).filter((n) => n.props?.role === role);
const byClass = (tree, name) =>
  nodes(tree).filter((n) => (n.props?.class ?? "").split(" ").includes(name));
// The segments of a chip: class, text and inline style.
const segments = (chip) =>
  nodes(chip)
    .filter((n) => /^v2-trk-[fac]\b/.test(n.props?.class ?? ""))
    .map((n) => [n.props.class, text(n), data(n.props.style)]);

const library = (name, modules = {}) =>
  loadSource("components/library/" + name + ".tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../ui": ui,
      "../../i18n": i18n,
      "../../color": color,
      "../../tag-display": tagDisplay,
      "../../tag-labels": tagLabels,
      "../../languages": languages,
      "../../tracks": tracks,
      "../LanguageFlag": { LanguageFlag: "LanguageFlag" },
      "../frame/Popover": { Popover: "Popover" },
      ...modules,
    },
  });
// The four modules as the cell uses them.
function modules() {
  const chip = library("TrackChip");
  const menu = library("TrackMenu", { "./TrackChip": chip });
  const popover = library("TracksPopover", { "./TrackChip": chip });
  const cell = library("TracksCell", {
    "./TrackChip": chip,
    "./TrackMenu": menu,
    "./TracksPopover": popover,
  });
  return { ...chip, ...menu, ...popover, ...cell };
}

// Three measured tracks; the codecs of the first two fit one row (7
// characters).
const measured = [
  {
    index: 1,
    language: "Deutsch",
    codec: "DTS",
    channels: 6,
    channelLayout: "5.1(side)",
    title: "",
    default: true,
  },
  {
    index: 2,
    language: "Englisch",
    codec: "AC-3",
    channels: 2,
    channelLayout: "stereo",
    title: "Commentary",
    default: false,
  },
  {
    index: 3,
    language: "Französisch",
    codec: "AAC",
    channels: 2,
    channelLayout: "stereo",
    title: "",
    default: false,
  },
];
const file = (fields) => ({
  title: "Arrival",
  language: "",
  audio: "",
  channels: "",
  evidence: {},
  ...fields,
});
const reported = {
  language: "Deutsch, Englisch, Französisch",
  audio: "DTS + AC-3 + AAC",
  channels: "5.1 + 2.0 + 2.0",
  audioTracks: measured,
};
const confirmed = (field, value) => ({
  [field]: {
    confirmed: { source: "filename", value, at: 1 },
    filename: value,
    api: "",
    origin: "filename",
    conflict: false,
  },
});
const NAMES = [
  "Track 1 · German · DTS · 5.1 · Default track",
  "Track 2 · English · AC-3 · 2.0 · Commentary",
  "Track 3 · French · AAC · 2.0",
];
const anchor = () => {
  const element = { focused: 0, focus: () => element.focused++ };
  return element;
};
const cell = (props, contexts) => {
  const { TracksCell } = modules();
  return mount(
    TracksCell,
    { stacked: false, onFilter() {}, ...props },
    contexts,
  );
};

test("compact tracks show at most two chips and a more button", () => {
  const { TrackChip } = modules();
  const view = cell({ file: file(reported) });
  let tree = view.render();
  assert.equal(tree.type, "div");
  assert.equal(tree.props.class, "v2-trk-row");
  // Two chips (DTS and AC-3 have 7 characters), each named after its track
  // and opening its menu; the third track waits behind +1.
  const chips = nodes(tree).filter((n) => n.type?.name === "TrackChip");
  assert.deepEqual(
    chips.map((chip) => [
      chip.props.track.position,
      chip.props.name,
      chip.props.expanded,
      chip.props.stretch,
      typeof chip.props.onOpen,
    ]),
    [
      [1, NAMES[0], false, false, "function"],
      [2, NAMES[1], false, false, "function"],
    ],
  );
  const [more] = byClass(tree, "v2-trk--more");
  assert.deepEqual(plain(more), {
    type: "button",
    props: {
      type: "button",
      class: "v2-trk v2-trk--more",
      "aria-haspopup": "dialog",
      "aria-expanded": false,
      "aria-label": "Show all 3 audio tracks",
      title: "Show all 3 audio tracks",
    },
    children: ["+", 1],
  });
  assert.equal(byClass(tree, "v2-trk--loose").length, 0);

  // The chip itself: a button with the flag (no focus of its own), the
  // codec and the channels, in the audio tag surface.
  assert.deepEqual(plain(expand(chips[0])), {
    type: "button",
    props: {
      type: "button",
      class: "v2-trk",
      "aria-haspopup": "menu",
      "aria-expanded": false,
      "aria-label": NAMES[0],
      title: NAMES[0],
    },
    children: [
      {
        type: "span",
        props: { class: "v2-trk-f" },
        children: {
          type: "LanguageFlag",
          props: { value: "Deutsch", focusable: false },
          children: null,
        },
      },
      { type: "span", props: { class: "v2-trk-a" }, children: "DTS" },
      { type: "span", props: { class: "v2-trk-c" }, children: "5.1" },
    ],
  });
  // Without a menu it is a span with the same name as its title.
  assert.deepEqual(
    plain(
      expand(once(TrackChip, { track: chips[1].props.track, name: NAMES[1] })),
    ),
    {
      type: "span",
      props: { class: "v2-trk", title: NAMES[1] },
      children: [
        {
          type: "span",
          props: { class: "v2-trk-f" },
          children: {
            type: "LanguageFlag",
            props: { value: "Englisch", focusable: false },
            children: null,
          },
        },
        { type: "span", props: { class: "v2-trk-a" }, children: "AC-3" },
        { type: "span", props: { class: "v2-trk-c" }, children: "2.0" },
      ],
    },
  );

  // +1 opens the popover of every track and closes it again.
  const button = anchor();
  more.props.onClick({ currentTarget: button });
  tree = view.render();
  assert.equal(byClass(tree, "v2-trk--more")[0].props["aria-expanded"], true);
  const [popover] = nodes(tree).filter((n) => n.type?.name === "TracksPopover");
  assert.equal(popover.props.anchor, button);
  assert.equal(popover.props.file.title, "Arrival");
  assert.deepEqual(
    popover.props.tracks.map((track) => track.position),
    [1, 2, 3],
  );
  byClass(tree, "v2-trk--more")[0].props.onClick({ currentTarget: button });
  tree = view.render();
  assert.equal(
    nodes(tree).filter((n) => n.type?.name === "TracksPopover").length,
    0,
  );
  assert.equal(byClass(tree, "v2-trk--more")[0].props["aria-expanded"], false);
  // An open popover goes with its button when the cell turns stacked.
  const props = { file: file(reported), stacked: false, onFilter() {} };
  const turning = mount(modules().TracksCell, props);
  byClass(turning.render(), "v2-trk--more")[0].props.onClick({
    currentTarget: button,
  });
  assert.equal(
    nodes(turning.render()).filter((n) => n.type?.name === "TracksPopover")
      .length,
    1,
  );
  props.stacked = true;
  assert.equal(
    nodes(turning.render()).filter((n) => n.type?.name === "TracksPopover")
      .length,
    0,
  );

  // Long codecs show one chip; a single track needs no more button.
  const long = cell({
    file: file({
      ...reported,
      audioTracks: [
        { ...measured[0], codec: "DTS-HD MA" },
        { ...measured[1], codec: "E-AC-3" },
        measured[2],
      ],
    }),
  }).render();
  assert.equal(
    nodes(long).filter((n) => n.type?.name === "TrackChip").length,
    1,
  );
  assert.deepEqual(data(byClass(long, "v2-trk--more")[0].props.children), [
    "+",
    2,
  ]);
  const single = cell({
    file: file({
      language: "Deutsch",
      audio: "DTS",
      channels: "5.1",
      audioTracks: [measured[0]],
    }),
  }).render();
  assert.equal(
    nodes(single).filter((n) => n.type?.name === "TrackChip").length,
    1,
  );
  assert.equal(byClass(single, "v2-trk--more").length, 0);
});

test("stacked tracks show every track", () => {
  const tree = cell({ file: file(reported), stacked: true }).render();
  assert.equal(tree.type, "div");
  assert.equal(tree.props.class, "v2-trk-stack");
  const chips = nodes(tree).filter((n) => n.type?.name === "TrackChip");
  assert.deepEqual(
    chips.map((chip) => [chip.props.name, chip.props.stretch]),
    NAMES.map((name) => [name, true]),
  );
  assert.equal(byClass(tree, "v2-trk--more").length, 0);
  // A stretched chip fills the stack's width.
  assert.equal(expand(chips[2]).props.class, "v2-trk v2-trk--stretch");
});

test("unassigned values form one dashed chip", () => {
  const { LooseChip } = modules();
  const looseChips = (tree) =>
    nodes(tree).filter((n) => n.type?.name === "LooseChip");
  // Beside the tracks: the values no track has, named by the 1.7.0 hint.
  const beside = cell({
    file: file({
      ...reported,
      language: "Deutsch, Englisch, Französisch, Italienisch",
      audio: "DTS + AC-3 + AAC + FLAC",
    }),
  }).render();
  let [chip] = looseChips(beside);
  assert.equal(looseChips(beside).length, 1);
  assert.deepEqual(data(chip.props.loose), {
    languages: ["Italienisch"],
    codecs: ["FLAC"],
    channels: [],
  });
  assert.equal(
    chip.props.name,
    "Additional reported values without track attribution · Italian · FLAC",
  );
  assert.equal(typeof chip.props.onOpen, "function");
  assert.deepEqual(plain(expand(chip)), {
    type: "button",
    props: {
      type: "button",
      class: "v2-trk v2-trk--loose",
      "aria-haspopup": "menu",
      "aria-expanded": false,
      "aria-label":
        "Additional reported values without track attribution · Italian · FLAC",
      title:
        "Additional reported values without track attribution · Italian · FLAC",
    },
    children: [
      {
        type: "span",
        props: { class: "v2-trk-f" },
        children: {
          type: "LanguageFlag",
          props: { value: "Italienisch", focusable: false },
          children: null,
        },
      },
      { type: "span", props: { class: "v2-trk-a" }, children: "FLAC" },
    ],
  });

  // Without measured tracks every value is in the one chip, named by them:
  // a flag each, a segment per codec and per channel value.
  const without = cell({
    file: file({
      language: "Deutsch, Englisch",
      audio: "AC-3",
      channels: "5.1 + 2.0",
    }),
  }).render();
  assert.equal(
    nodes(without).filter((n) => n.type?.name === "TrackChip").length,
    0,
  );
  [chip] = looseChips(without);
  assert.equal(looseChips(without).length, 1);
  assert.equal(chip.props.name, "German, English · AC-3 · 5.1, 2.0");
  assert.deepEqual(
    ofType(expand(chip), "LanguageFlag").map((flag) => flag.props.value),
    ["Deutsch", "Englisch"],
  );
  assert.deepEqual(segments(expand(chip)), [
    ["v2-trk-f", "", null],
    ["v2-trk-a", "AC-3", null],
    ["v2-trk-c", "5.1", null],
    ["v2-trk-c", "2.0", null],
  ]);

  // An active audio confirmation shows the file's values the same way.
  const confirmedAudio = cell({
    file: file({ ...reported, evidence: confirmed("audio", "DTS") }),
  }).render();
  assert.equal(
    nodes(confirmedAudio).filter((n) => n.type?.name === "TrackChip").length,
    0,
  );
  assert.equal(
    looseChips(confirmedAudio)[0].props.name,
    "German, English, French · DTS, AC-3, AAC · 5.1, 2.0",
  );

  // Without a menu the loose chip is a span.
  assert.deepEqual(
    plain(
      expand(
        once(LooseChip, {
          loose: { languages: [], codecs: ["AAC"], channels: [] },
          name: "AAC",
        }),
      ),
    ),
    {
      type: "span",
      props: { class: "v2-trk v2-trk--loose", title: "AAC" },
      children: { type: "span", props: { class: "v2-trk-a" }, children: "AAC" },
    },
  );
});

// Ruling P11/M6: a file without any audio value shows "—" as in 1.7.0
// (the brief's "shows Unknown" predates the ruling).
test("a file without audio data shows a dash", () => {
  const dash = {
    type: "span",
    props: { class: "v2-trk-quiet" },
    children: "—",
  };
  assert.deepEqual(plain(cell({ file: file({}) }).render()), dash);
  assert.deepEqual(
    plain(cell({ file: file({ audioTracks: [] }), stacked: true }).render()),
    dash,
  );
  // One known value is enough for a chip.
  const channels = cell({ file: file({ channels: "5.1" }) }).render();
  assert.equal(channels.props.class, "v2-trk-row");
  assert.equal(
    nodes(channels).find((n) => n.type?.name === "LooseChip").props.name,
    "5.1",
  );
});

test("the track menu offers only known parts", () => {
  const { TrackMenu } = modules();
  const menuOf = (tree) =>
    nodes(tree).find((n) => n.type?.name === "TrackMenu");
  const entries = (menu, contexts) =>
    byRole(once(TrackMenu, menu.props, contexts), "menuitem").map((entry) => [
      entry.type,
      entry.props.type,
      entry.props.class,
      text(entry),
    ]);
  const view = cell({
    file: file({
      ...reported,
      language: "Deutsch, Englisch, Französisch, Italienisch",
      audio: "DTS + AC-3 + AAC + FLAC",
    }),
  });
  let tree = view.render();
  const chips = nodes(tree).filter((n) => n.type?.name === "TrackChip");
  const button = anchor();
  chips[0].props.onOpen(button);
  tree = view.render();
  assert.equal(
    nodes(tree).filter((n) => n.type?.name === "TrackChip")[0].props.expanded,
    true,
  );
  let menu = menuOf(tree);
  assert.equal(menu.props.anchor, button);
  assert.deepEqual(data(menu.props.actions), [
    { kind: "language", value: "Deutsch" },
    { kind: "codec", value: "DTS" },
    { kind: "channels", value: "5.1" },
    { kind: "combo", language: "Deutsch", codec: "DTS" },
  ]);
  const popover = once(TrackMenu, menu.props);
  assert.equal(popover.type, "Popover");
  assert.equal(popover.props.role, "menu");
  assert.equal(popover.props.label, "Filter by this track");
  assert.equal(popover.props.anchor, button);
  assert.deepEqual(entries(menu), [
    ["button", "button", "v2-menu-item", "Only German"],
    ["button", "button", "v2-menu-item", "Only DTS"],
    ["button", "button", "v2-menu-item", "Only 5.1"],
    ["button", "button", "v2-menu-item", "German with DTS (same track)"],
  ]);
  // The entries name a value as its tag reads (the user's tag label).
  assert.deepEqual(entries(menu, { labels: { "audio:DTS": "DTS Core" } }), [
    ["button", "button", "v2-menu-item", "Only German"],
    ["button", "button", "v2-menu-item", "Only DTS Core"],
    ["button", "button", "v2-menu-item", "Only 5.1"],
    ["button", "button", "v2-menu-item", "German with DTS Core (same track)"],
  ]);

  // A second press closes it; the loose chip offers each value on its own,
  // without "same track".
  nodes(tree)
    .find((n) => n.type?.name === "TrackChip")
    .props.onOpen(button);
  tree = view.render();
  assert.equal(menuOf(tree), undefined);
  nodes(tree)
    .find((n) => n.type?.name === "LooseChip")
    .props.onOpen(button);
  tree = view.render();
  menu = menuOf(tree);
  assert.equal(
    nodes(tree).find((n) => n.type?.name === "LooseChip").props.expanded,
    true,
  );
  assert.deepEqual(entries(menu), [
    ["button", "button", "v2-menu-item", "Only Italian"],
    ["button", "button", "v2-menu-item", "Only FLAC"],
  ]);

  // An unknown language and unknown channels offer nothing; a track
  // without any known part has no menu.
  const unknown = cell({
    file: file({
      audio: "AAC",
      audioTracks: [
        {
          index: 1,
          language: "und",
          codec: "AAC",
          channels: 0,
          channelLayout: "",
          title: "",
          default: false,
        },
        {
          index: 2,
          language: "",
          codec: "",
          channels: 0,
          channelLayout: "",
          title: "",
          default: false,
        },
      ],
    }),
  });
  tree = unknown.render();
  const [known, none] = nodes(tree).filter((n) => n.type?.name === "TrackChip");
  assert.equal(none.props.onOpen, undefined);
  assert.equal(
    none.props.name,
    "Track 2 · Unknown · Unknown · Unknown channels",
  );
  known.props.onOpen(button);
  assert.deepEqual(entries(menuOf(unknown.render())), [
    ["button", "button", "v2-menu-item", "Only AAC"],
  ]);
});

test("the more popover lists every track with its default", () => {
  const { TracksPopover, TrackChip } = modules();
  const views = tracks.fileTracks(file(reported)).tracks;
  const button = anchor();
  const closed = [];
  const tree = once(TracksPopover, {
    file: file(reported),
    tracks: views,
    anchor: button,
    close: (returnFocus) => closed.push(returnFocus),
  });
  assert.equal(tree.type, "Popover");
  assert.deepEqual(
    [
      tree.props.role,
      tree.props.label,
      tree.props.wide,
      tree.props.placement,
      tree.props.anchor === button,
    ],
    ["dialog", "Audio tracks of Arrival", "track", "bottom-end", true],
  );
  tree.props.close(true);
  assert.deepEqual(closed, [true]);
  const [title] = byClass(tree, "v2-pop-title");
  assert.equal(title.type, "p");
  assert.equal(text(title), "Audio tracks of Arrival");
  const [table] = ofType(tree, "table");
  assert.equal(table.props.class, "v2-trk-table");
  assert.deepEqual(
    ofType(table, "th").map((th) => [th.props.scope, text(th)]),
    [
      ["col", "Track"],
      ["col", "Language"],
      ["col", "Title"],
      ["col", "Default"],
    ],
  );
  const rows = ofType(ofType(table, "tbody")[0], "tr");
  assert.equal(rows.length, 3);
  // Each row: the static chip, the language, the title ("—" without one)
  // and the default.
  assert.deepEqual(
    rows.map((row) => {
      const [chip, language, name, isDefault] = ofType(row, "td");
      const [trackChip] = ofType(chip, TrackChip);
      return [
        trackChip.props.track.position,
        trackChip.props.name,
        trackChip.props.onOpen,
        text(language),
        text(name),
        byClass(name, "v2-trk-quiet").length,
        text(isDefault),
      ];
    }),
    [
      [1, NAMES[0], undefined, "German", "—", 1, "Yes"],
      [2, NAMES[1], undefined, "English", "Commentary", 0, "No"],
      [3, NAMES[2], undefined, "French", "—", 1, "No"],
    ],
  );
  assert.equal(
    ofType(table, "td").filter((td) => text(td) === "Yes").length,
    1,
    "Yes exactly once",
  );
  // The static chips render as spans.
  assert.equal(expand(ofType(rows[0], TrackChip)[0]).type, "span");
});

test("choosing a menu entry filters and returns focus", () => {
  const { TrackMenu } = modules();
  const steps = [];
  const button = {
    focus: () => steps.push("focus"),
  };
  const combo = { kind: "combo", language: "Deutsch", codec: "DTS" };
  const menu = once(TrackMenu, {
    anchor: button,
    actions: [{ kind: "codec", value: "DTS" }, combo],
    choose: (action) => steps.push(["choose", data(action)]),
    close: (returnFocus) => steps.push(["close", returnFocus]),
  });
  byRole(menu, "menuitem")[1].props.onClick();
  assert.deepEqual(steps, ["focus", ["close", true], ["choose", combo]]);

  // Through the cell: the action reaches onFilter and the menu closes.
  const filtered = [];
  const view = cell({
    file: file(reported),
    onFilter: (action) => filtered.push(data(action)),
  });
  let tree = view.render();
  const chip = nodes(tree).find((n) => n.type?.name === "TrackChip");
  const target = anchor();
  chip.props.onOpen(target);
  tree = view.render();
  const open = nodes(tree).find((n) => n.type?.name === "TrackMenu");
  byRole(once(TrackMenu, open.props), "menuitem")[2].props.onClick();
  assert.deepEqual(filtered, [{ kind: "channels", value: "5.1" }]);
  assert.equal(target.focused, 1, "focus back on the chip");
  tree = view.render();
  assert.equal(
    nodes(tree).find((n) => n.type?.name === "TrackMenu"),
    undefined,
  );
  assert.equal(
    nodes(tree).find((n) => n.type?.name === "TrackChip").props.expanded,
    false,
  );
});

// --- The 1.7.0 tag rules of the audio cell (ruling P4) -----------------------

const track = tracks.fileTracks(file(reported)).tracks[0];
const loose = {
  languages: ["Deutsch"],
  codecs: ["FLAC", "AAC"],
  channels: ["5.1"],
};
function chips(contexts) {
  const { TrackChip, LooseChip } = modules();
  return [
    once(TrackChip, { track, name: NAMES[0] }, contexts),
    once(LooseChip, { loose, name: "loose" }, contexts),
  ];
}

test("track chips leave hidden values out", () => {
  // As the 1.7.0 Tag with respectHidden: a hidden codec or channel value
  // leaves its segment out; the flag stays.
  const [chip, looseChip] = chips({
    hidden: { "audio:DTS": true, "audio:FLAC": true, "channels:5.1": true },
  });
  assert.deepEqual(segments(chip), [["v2-trk-f", "", null]]);
  assert.deepEqual(segments(looseChip), [
    ["v2-trk-f", "", null],
    ["v2-trk-a", "AAC", null],
  ]);
  // An unknown value hides as "Unknown" (__unknown__).
  const { TrackChip } = modules();
  const unknown = { ...track, codec: "", channels: "" };
  assert.deepEqual(segments(once(TrackChip, { track: unknown, name: "x" })), [
    ["v2-trk-f", "", null],
    ["v2-trk-a", "Unknown", null],
    ["v2-trk-c", "Unknown", null],
  ]);
  assert.deepEqual(
    segments(
      once(
        TrackChip,
        { track: unknown, name: "x" },
        { hidden: { "audio:__unknown__": true } },
      ),
    ),
    [
      ["v2-trk-f", "", null],
      ["v2-trk-c", "Unknown", null],
    ],
  );
  // The name still names the whole track.
  const named = cell(
    { file: file(reported) },
    { hidden: { "audio:DTS": true } },
  ).render();
  assert.equal(
    nodes(named).find((n) => n.type?.name === "TrackChip").props.name,
    NAMES[0],
  );
});

test("track chips show information-only values as plain text", () => {
  // As the 1.7.0 Tag: an information-only value, or one outside the visible
  // list, is plain text in its segment, without a user color.
  const [chip, looseChip] = chips({
    information: { audio: ["DTS", "FLAC"] },
    visibility: { channels: ["2.0"] },
    colors: { "audio:DTS": "#336699" },
  });
  assert.deepEqual(segments(chip), [
    ["v2-trk-f", "", null],
    ["v2-trk-a v2-trk-text", "DTS", null],
    ["v2-trk-c v2-trk-text", "5.1", null],
  ]);
  assert.deepEqual(segments(looseChip), [
    ["v2-trk-f", "", null],
    ["v2-trk-a v2-trk-text", "FLAC", null],
    ["v2-trk-a", "AAC", null],
    ["v2-trk-c v2-trk-text", "5.1", null],
  ]);
});

test("track chips take the user colors and labels of their values", () => {
  // A user color sets only the segment's background and text inline (the
  // text the user's or black or white), as MediaTag; no 1.7.0 default color.
  const [chip, looseChip] = chips({
    colors: { "audio:DTS": "#336699", "channels:5.1": "#ffeeaa" },
    textColors: { "channels:5.1": "#000000", "audio:AAC": "#ffffff" },
    labels: { "audio:DTS": "DTS Core" },
  });
  assert.deepEqual(segments(chip), [
    ["v2-trk-f", "", null],
    ["v2-trk-a", "DTS Core", { backgroundColor: "#336699", color: "#ffffff" }],
    ["v2-trk-c", "5.1", { backgroundColor: "#ffeeaa", color: "#000000" }],
  ]);
  assert.deepEqual(segments(looseChip), [
    ["v2-trk-f", "", null],
    ["v2-trk-a", "FLAC", null],
    ["v2-trk-a", "AAC", { color: "#ffffff" }],
    ["v2-trk-c", "5.1", { backgroundColor: "#ffeeaa", color: "#000000" }],
  ]);
  // An invalid color sets nothing.
  assert.deepEqual(segments(chips({ colors: { "audio:DTS": "red" } })[0]), [
    ["v2-trk-f", "", null],
    ["v2-trk-a", "DTS", null],
    ["v2-trk-c", "5.1", null],
  ]);
  // The language's color stays the 1.7.0 flag edge: the flag is the 1.7.0
  // LanguageFlag of the track's language, which reads it.
  assert.deepEqual(data(ofType(chip, "LanguageFlag")[0].props), {
    value: "Deutsch",
    focusable: false,
  });
  // The name reads the label too.
  const labeled = cell(
    { file: file(reported) },
    { labels: { "audio:DTS": "DTS Core", "channels:5.1": "5.1 surround" } },
  ).render();
  assert.equal(
    nodes(labeled).find((n) => n.type?.name === "TrackChip").props.name,
    "Track 1 · German · DTS Core · 5.1 surround · Default track",
  );
  const looseLabeled = cell(
    { file: file({ language: "Deutsch", audio: "DTS", channels: "5.1" }) },
    { labels: { "audio:DTS": "DTS Core", "channels:5.1": "5.1 surround" } },
  ).render();
  assert.equal(
    nodes(looseLabeled).find((n) => n.type?.name === "LooseChip").props.name,
    "German · DTS Core · 5.1 surround",
  );
});

// Task 2 review, carried to task 4 (L30): the tracks follow an audio or a
// language confirmation only. A confirmed channel value keeps the measured
// tracks, so chips and popover show the measured channels, the ones the
// track filter matches, while the Channels column shows the confirmed one.
test("a channel confirmation keeps the measured channels on chips and popover", () => {
  const { TracksPopover } = modules();
  const confirmedFile = file({
    ...reported,
    channels: "7.1",
    evidence: confirmed("channels", "7.1"),
  });
  assert.deepEqual(channelRows(confirmedFile), ["7.1"]);
  const view = cell({ file: confirmedFile });
  let tree = view.render();
  const shown = nodes(tree).filter((n) => n.type?.name === "TrackChip");
  assert.deepEqual(
    shown.map((chip) => segments(expand(chip))[2]),
    [
      ["v2-trk-c", "5.1", null],
      ["v2-trk-c", "2.0", null],
    ],
  );
  assert.deepEqual(
    shown.map((chip) => chip.props.name),
    NAMES.slice(0, 2),
  );
  byClass(tree, "v2-trk--more")[0].props.onClick({ currentTarget: anchor() });
  tree = view.render();
  const popover = nodes(tree).find((n) => n.type?.name === "TracksPopover");
  const listed = nodes(expand(popover)).filter(
    (n) => n.props?.class === "v2-trk",
  );
  assert.deepEqual(
    listed.map((chip) => [chip.props.title, segments(chip)[2]]),
    [
      [NAMES[0], ["v2-trk-c", "5.1", null]],
      [NAMES[1], ["v2-trk-c", "2.0", null]],
      [NAMES[2], ["v2-trk-c", "2.0", null]],
    ],
  );
  // With an audio confirmation too, the chip shows the confirmed values.
  const both = cell({
    file: file({
      ...confirmedFile,
      evidence: {
        ...confirmed("channels", "7.1"),
        ...confirmed("audio", "DTS"),
      },
    }),
  }).render();
  assert.equal(
    nodes(both).find((n) => n.type?.name === "LooseChip").props.name,
    "German, English, French · DTS, AC-3, AAC · 7.1",
  );
});
