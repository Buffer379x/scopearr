import test from "node:test";
import assert from "node:assert/strict";
import * as preact from "preact";
import * as icons from "lucide-preact";
import {
  loadSource,
  nodes,
  PRESENTATION_MODULES,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import * as color from "../src/color.ts";
import * as instances from "../src/instances.ts";
import * as navLink from "../src/nav-link.ts";
import * as resolution from "../src/resolution-groups.ts";
import * as tagDisplay from "../src/tag-display.ts";
import * as tagLabels from "../src/tag-labels.ts";
import * as units from "../src/units.ts";

// The v2 base building blocks of the lists (Phase 5a, task 3;
// docs/STYLEGUIDE.md, Part 1, 2.5, 10.3, 10.6–10.8 and 10.10), built but not
// mounted yet, and the 1.7.0 Tag they share tagPresentation with. Each
// component runs as real code with the hook runtime; each module is loaded
// inside its test, so a missing one fails only its own cases.

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const i18n = { t, getLocale: () => "en", useI18n: () => ({ locale: "en" }) };

// Every module shares one hooks object; it calls the runtime that renders.
let current = createHookRuntime();
const hooks = new Proxy({}, { get: (_, name) => current.hooks[name] });
const notifications = loadSource("notifications.ts");
// The real ui.tsx: its tag contexts, ICON, count and defaultColor.
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

// A VNode as plain data: type, props and children; undefined props drop out,
// as they set nothing in the DOM.
function shape(node) {
  if (Array.isArray(node)) return node.map(shape);
  if (!node || typeof node !== "object") return node ?? null;
  const { children, ...props } = node.props;
  return { type: node.type, props, children: shape(children) };
}
const plain = (node) => data(shape(node));
// A value of the sandbox as data of this realm, so deepEqual compares only
// its content.
const data = (value) => JSON.parse(JSON.stringify(value));
const byRole = (tree, role) =>
  nodes(tree).filter((n) => n.props?.role === role);
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);

const listModule = (name, modules = {}) =>
  loadSource("components/list/" + name + ".tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../ui": ui,
      "../../i18n": i18n,
      "../../color": color,
      "../../tag-display": tagDisplay,
      ...modules,
    },
    stubs: PRESENTATION_MODULES,
  });

// --- The 1.7.0 Tag -----------------------------------------------------------

// Sixteen cases of the 1.7.0 Tag and their VNodes, recorded at 3e11148 from
// Tag in ui.tsx before it moved to components/Tag.tsx (ruling P1) and began
// to share tagPresentation (ruling P11/M4: golden VNodes); the last four
// were added in fix round 1, recorded the same way.
const TAG_CASES = {
  "a plain source": { props: { value: "BluRay" } },
  "a resolution with its label": {
    props: { value: "2160p", kind: "resolution r2160p", respectHidden: true },
    context: { labels: { "resolution:2160p": "4K UHD" } },
  },
  "an SD resolution in the SD group": {
    props: { value: "576p", kind: "resolution r576p", respectHidden: true },
    context: { groupSD: true },
  },
  "the SD group value": {
    props: { value: "__sd__", kind: "resolution r__sd__" },
  },
  "a hidden value": {
    props: { value: "x264", kind: "codec", respectHidden: true },
    context: { hidden: { "codec:x264": true } },
  },
  "an information-only value": {
    props: { value: "WEB", kind: "source", title: "Web download" },
    context: { information: { source: ["WEB"] } },
  },
  "a value outside the visible list": {
    props: { value: "DV", kind: "hdr" },
    context: { visibility: { hdr: ["HDR10"] } },
  },
  "a forced tag": {
    props: { value: "WEB", kind: "source", forceTag: true },
    context: {
      information: { source: ["WEB"] },
      colors: { "source:WEB": "#336699" },
    },
  },
  "a custom tag": {
    props: { value: "7", kind: "custom", label: "fallback" },
    context: { names: { 7: "Favorites" } },
  },
  "an empty value": {
    props: { value: "", kind: "codec", respectHidden: true },
  },
  "user colors": {
    props: { value: "HEVC", kind: "codec" },
    context: {
      colors: { "codec:HEVC": "#336699" },
      textColors: { "codec:HEVC": "#000000" },
    },
  },
  "default colors and children": {
    props: { value: "10", kind: "bitDepth", children: "10 bit" },
  },
  // The Settings previews pass their own colors (SettingsPage.tsx, the
  // color table); they win over the context, an empty map included.
  "explicit colors win over the context": {
    props: {
      value: "HEVC",
      kind: "codec",
      forceTag: true,
      colors: { "codec:HEVC": "#aa3355" },
      textColors: { "codec:HEVC": "#ffffff" },
    },
    context: {
      colors: { "codec:HEVC": "#00ff00" },
      textColors: { "codec:HEVC": "#000000" },
    },
  },
  "explicit empty colors hide the context's": {
    props: {
      value: "5.1",
      kind: "channels",
      forceTag: true,
      colors: {},
      textColors: {},
    },
    context: {
      colors: { "channels:5.1": "#336699" },
      textColors: { "channels:5.1": "#ffffff" },
    },
  },
  "a hidden SD group": {
    props: { value: "480p", kind: "resolution r480p", respectHidden: true },
    context: { groupSD: true, hidden: { "resolution:__sd__": true } },
  },
  "the SD group needs respectHidden": {
    props: { value: "480p", kind: "resolution r480p" },
    context: { groupSD: true, hidden: { "resolution:__sd__": true } },
  },
};
const GOLDEN = {
  "a plain source": {
    type: "span",
    props: { class: "tag source" },
    children: "BluRay",
  },
  "a resolution with its label": {
    type: "span",
    props: { class: "tag resolution r2160p" },
    children: "4K UHD",
  },
  "an SD resolution in the SD group": {
    type: "span",
    props: { class: "tag resolution r576p", title: "576p" },
    children: "SD",
  },
  "the SD group value": {
    type: "span",
    props: { class: "tag resolution r__sd__" },
    children: "SD",
  },
  "a hidden value": null,
  "an information-only value": {
    type: "span",
    props: { class: "tag-info-only", title: "Web download" },
    children: "WEB",
  },
  "a value outside the visible list": {
    type: "span",
    props: { class: "tag-info-only" },
    children: "DV",
  },
  "a forced tag": {
    type: "span",
    props: {
      style: {
        "--tag-border": "#24476b",
        backgroundColor: "#336699",
        borderColor: "#24476b",
        color: "#ffffff",
      },
      class: "tag source",
    },
    children: "WEB",
  },
  "a custom tag": {
    type: "span",
    props: { class: "tag custom" },
    children: "Favorites",
  },
  "an empty value": {
    type: "span",
    props: { class: "tag codec unknown" },
    children: "Unknown",
  },
  "user colors": {
    type: "span",
    props: {
      style: {
        "--tag-border": "#24476b",
        backgroundColor: "#336699",
        borderColor: "#24476b",
        color: "#000000",
      },
      class: "tag codec",
    },
    children: "HEVC",
  },
  "default colors and children": {
    type: "span",
    props: {
      style: {
        "--tag-border": "#7b838a",
        backgroundColor: "#b0bbc5",
        borderColor: "#7b838a",
        color: "#000000",
      },
      class: "tag bitDepth",
    },
    children: "10 bit",
  },
  "explicit colors win over the context": {
    type: "span",
    props: {
      style: {
        "--tag-border": "#77243b",
        backgroundColor: "#aa3355",
        borderColor: "#77243b",
        color: "#ffffff",
      },
      class: "tag codec",
    },
    children: "HEVC",
  },
  "explicit empty colors hide the context's": {
    type: "span",
    props: {
      style: {
        "--tag-border": "#7b838a",
        backgroundColor: "#b0bbc5",
        borderColor: "#7b838a",
        color: "#000000",
      },
      class: "tag channels",
    },
    children: "5.1",
  },
  "a hidden SD group": null,
  "the SD group needs respectHidden": {
    type: "span",
    props: { class: "tag resolution r480p" },
    children: "480p",
  },
};

test("the 1.7.0 tag renders as before", () => {
  const { Tag } = loadSource("components/Tag.tsx", {
    modules: {
      "preact/hooks": hooks,
      "../ui": ui,
      "../i18n": i18n,
      "../color": color,
      "../tag-display": tagDisplay,
    },
  });
  assert.equal(Object.keys(TAG_CASES).length, 16);
  assert.deepEqual(Object.keys(GOLDEN), Object.keys(TAG_CASES));
  for (const [name, { props, context }] of Object.entries(TAG_CASES))
    assert.deepEqual(plain(once(Tag, props, context)), GOLDEN[name], name);
  // Ruling P1: Tag left ui.tsx (the start chunk) without a re-export.
  assert.equal(ui.Tag, undefined, "ui.tsx exports no Tag");
});

// --- MediaTag and tagPresentation -------------------------------------------

test("media tags keep colors, hidden and information-only values", () => {
  const { MediaTag } = listModule("MediaTag");
  const tag = (props, context) => once(MediaTag, props, context);

  // A media palette by its kind; 2160p, 4320p and 720p add their own.
  assert.deepEqual(plain(tag({ value: "HEVC", kind: "codec" })), {
    type: "span",
    props: { class: "v2-tag v2-tag--codec" },
    children: "HEVC",
  });
  assert.equal(tag({ value: "BluRay" }).props.class, "v2-tag v2-tag--source");
  for (const value of ["2160p", "4320p", "720p"])
    assert.equal(
      tag({ value, kind: "resolution" }).props.class,
      "v2-tag v2-tag--resolution v2-tag--r" + value,
      value,
    );
  assert.equal(
    tag({ value: "1080p", kind: "resolution" }).props.class,
    "v2-tag v2-tag--resolution",
  );
  // The 1.7.0 kind form ("resolution r2160p") reads the same.
  assert.equal(
    tag({ value: "2160p", kind: "resolution r2160p" }).props.class,
    "v2-tag v2-tag--resolution v2-tag--r2160p",
  );

  // A user color sets only the background and the text inline: the text
  // color is the user's or black or white by luminance, never --tag-border.
  const colors = { "codec:HEVC": "#336699" };
  assert.deepEqual(plain(tag({ value: "HEVC", kind: "codec" }, { colors })), {
    type: "span",
    props: {
      class: "v2-tag v2-tag--codec",
      style: { backgroundColor: "#336699", color: "#ffffff" },
    },
    children: "HEVC",
  });
  assert.deepEqual(
    data(
      tag(
        { value: "HEVC", kind: "codec" },
        { colors, textColors: { "codec:HEVC": "#000000" } },
      ).props.style,
    ),
    { backgroundColor: "#336699", color: "#000000" },
  );
  // A text color alone, and no color for an invalid one, as in 1.7.0.
  assert.deepEqual(
    data(
      tag(
        { value: "HEVC", kind: "codec" },
        { textColors: { "codec:HEVC": "#ffffff" } },
      ).props.style,
    ),
    { color: "#ffffff" },
  );
  assert.equal(
    tag({ value: "HEVC", kind: "codec" }, { colors: { "codec:HEVC": "red" } })
      .props.style,
    undefined,
  );

  // Hidden with respectHidden renders nothing; without it (a preview) the
  // tag shows.
  const hidden = { "codec:x264": true };
  assert.equal(
    tag({ value: "x264", kind: "codec", respectHidden: true }, { hidden }),
    null,
  );
  assert.equal(
    tag({ value: "x264", kind: "codec" }, { hidden }).props.class,
    "v2-tag v2-tag--codec",
  );

  // An information-only value, or one outside the visible list, is plain
  // text; forceTag keeps the tag.
  const information = { source: ["WEB"] };
  assert.deepEqual(
    plain(tag({ value: "WEB", kind: "source", title: "Web" }, { information })),
    {
      type: "span",
      props: { class: "v2-tag-text", title: "Web" },
      children: "WEB",
    },
  );
  assert.equal(
    tag({ value: "DV", kind: "hdr" }, { visibility: { hdr: ["HDR10"] } }).props
      .class,
    "v2-tag-text",
  );
  assert.equal(
    tag({ value: "HDR10", kind: "hdr" }, { visibility: { hdr: ["HDR10"] } })
      .props.class,
    "v2-tag v2-tag--hdr",
  );
  assert.equal(
    tag({ value: "WEB", kind: "source", forceTag: true }, { information }).props
      .class,
    "v2-tag v2-tag--source",
  );

  // The SD group: an SD resolution shows SD in the resolution palette with
  // its value as title; hiding SD hides it.
  assert.deepEqual(
    plain(
      tag(
        { value: "576p", kind: "resolution", respectHidden: true },
        { groupSD: true },
      ),
    ),
    {
      type: "span",
      props: { class: "v2-tag v2-tag--resolution", title: "576p" },
      children: "SD",
    },
  );
  assert.equal(
    tag(
      { value: "576p", kind: "resolution", respectHidden: true },
      { groupSD: true, hidden: { "resolution:__sd__": true } },
    ),
    null,
  );

  // SDR is the HDR value in the neutral tone; an empty value is unknown.
  assert.equal(
    tag({ value: "SDR", kind: "hdr" }).props.class,
    "v2-tag v2-tag--hdr v2-tag--neutral",
  );
  assert.deepEqual(plain(tag({ value: "", kind: "codec" })), {
    type: "span",
    props: { class: "v2-tag v2-tag--codec v2-tag--unknown" },
    children: "Unknown",
  });
  // A kind without a palette of its own takes the neutral base tone, not the
  // 1.7.0 inline default color (ruling P11/M5).
  for (const kind of ["bitDepth", "channels", "language"]) {
    const node = tag({ value: "10", kind });
    assert.equal(node.props.class, "v2-tag v2-tag--" + kind, kind);
    assert.equal(node.props.style, undefined, kind);
  }

  // Labels: tag labels, custom tag names, the label, then children.
  assert.equal(
    text(
      tag(
        { value: "2160p", kind: "resolution" },
        { labels: { "resolution:2160p": "4K UHD" } },
      ),
    ),
    "4K UHD",
  );
  assert.equal(
    text(tag({ value: "7", kind: "custom" }, { names: { 7: "Favorites" } })),
    "Favorites",
  );
  assert.equal(
    text(tag({ value: "10", kind: "bitDepth", children: "10 bit" })),
    "10 bit",
  );

  // tagPresentation is the one decision both tags render.
  const input = {
    value: "576p",
    kind: "resolution r576p",
    respectHidden: true,
    visibility: null,
    information: {},
    hidden: {},
    colors: { "resolution:__sd__": "#123456" },
    textColors: {},
    customNames: {},
    tagLabels: {},
    groupSD: true,
    translate: t,
  };
  assert.deepEqual(data(tagDisplay.tagPresentation(input)), {
    asTag: true,
    text: "SD",
    kindKey: "resolution",
    unknown: false,
    sd: true,
    title: "576p",
    color: "#123456",
  });
  assert.equal(
    tagDisplay.tagPresentation({
      ...input,
      hidden: { "resolution:576p": true },
    }),
    null,
  );
});

// --- CustomTag ---------------------------------------------------------------

test("custom tags use the user color and keep the auto mark", () => {
  const auto = loadSource("components/AutoTagMark.tsx", {
    modules: {
      "preact/hooks": hooks,
      "../ui": ui,
      "../instances": instances,
      "../i18n": i18n,
    },
    stubs: PRESENTATION_MODULES,
  });
  const { CustomTag } = listModule("CustomTag", { "../AutoTagMark": auto });
  const settings = { instances: [] };
  const tag = (custom, context) =>
    once(CustomTag, { tag: custom, settings }, context);

  // A user color is --ct, which v2-ctag--user mixes; the name is the title.
  const colors = { "custom:3": "#aa5500" };
  assert.deepEqual(
    plain(
      tag(
        { id: 3, name: "kids", displayName: "Kids", manual: true },
        { colors },
      ),
    ),
    {
      type: "span",
      props: {
        class: "v2-ctag v2-ctag--user",
        style: { "--ct": "#aa5500" },
        title: "Kids",
      },
      children: [false, "Kids", false],
    },
  );
  // Without a user color (or with an invalid one) the neutral tone, also
  // with a stored text color.
  for (const context of [
    {},
    { colors: { "custom:3": "orange" } },
    { textColors: { "custom:3": "#000000" } },
  ]) {
    const node = tag({ id: 3, name: "Kids", manual: true }, context);
    assert.equal(node.props.class, "v2-ctag");
    assert.equal(node.props.style, undefined);
  }
  // The user's black or white text color stays the text, as in 1.7.0
  // (fix round 1); without one, or with another value (colorStyle's rule),
  // the mixes derive the text from --ct.
  const kids = (textColors) =>
    tag({ id: 3, name: "Kids", manual: true }, { colors, textColors });
  for (const textColor of ["#000000", "#ffffff"]) {
    const node = kids({ "custom:3": textColor });
    assert.equal(node.props.class, "v2-ctag v2-ctag--user", textColor);
    assert.deepEqual(
      data(node.props.style),
      { "--ct": "#aa5500", color: textColor },
      textColor,
    );
  }
  for (const textColors of [{}, { "custom:3": "#123456" }])
    assert.deepEqual(data(kids(textColors).props.style), {
      "--ct": "#aa5500",
    });

  // An auto tag: its explanation is the title, and the auto mark opens it in
  // the 1.7.0 dialog.
  const protectedTag = {
    id: 5,
    name: "4K",
    protected: true,
    rules: ["radarr · Resolution is 2160p"],
  };
  const hint = auto.autoTagHint(protectedTag, settings);
  assert.match(hint, /^Used by external auto-tag rules\n/);
  const mounted = mount(CustomTag, { tag: protectedTag, settings });
  let node = mounted.render();
  assert.equal(node.props.title, hint);
  const mark = ofType(node, "button")[0];
  assert.equal(mark.props.class, "v2-ctag-auto");
  assert.equal(mark.props.type, "button");
  assert.equal(mark.props["aria-label"], hint);
  assert.equal(mark.props.title, hint);
  assert.equal(ofType(node, "Modal").length, 0);
  const calls = [];
  mark.props.onClick({
    preventDefault: () => calls.push("preventDefault"),
    stopPropagation: () => calls.push("stopPropagation"),
  });
  assert.deepEqual(calls, ["preventDefault", "stopPropagation"]);
  node = mounted.render();
  const [modal] = ofType(node, "Modal");
  assert.equal(modal.props.title, "External auto-tag");
  assert.equal(text(modal), hint);
  modal.props.close();
  assert.equal(ofType(mounted.render(), "Modal").length, 0);
  // With a user color and text color an auto tag takes both; its mark is
  // unchanged (it draws in the tag's text color).
  const colored = tag(protectedTag, {
    colors: { "custom:5": "#4fa3e0" },
    textColors: { "custom:5": "#ffffff" },
  });
  assert.deepEqual(data(colored.props.style), {
    "--ct": "#4fa3e0",
    color: "#ffffff",
  });
  const coloredMark = ofType(colored, "button")[0];
  assert.deepEqual(
    [
      coloredMark.props.class,
      coloredMark.props["aria-label"],
      coloredMark.props.style,
      text(coloredMark),
    ],
    ["v2-ctag-auto", hint, undefined, "A"],
  );

  // Hidden custom tags render nothing; an information-only one is text,
  // unless it is manual or an auto tag.
  assert.equal(
    tag(
      { id: 3, name: "Kids", manual: true },
      { hidden: { "custom:3": true } },
    ),
    null,
  );
  const information = { custom: ["3"] };
  assert.deepEqual(plain(tag({ id: 3, name: "Kids" }, { information })), {
    type: "span",
    props: { class: "v2-tag-text", title: "Kids" },
    children: "Kids",
  });
  assert.equal(
    tag({ id: 3, name: "Kids", manual: true }, { information }).props.class,
    "v2-ctag",
  );
});

// --- RowButton and RowMark ---------------------------------------------------

test("row buttons and marks always carry a name", () => {
  const { RowButton } = listModule("RowButton");
  const { RowMark } = listModule("RowMark", { "../../nav-link": navLink });
  const named = (node, label, title = label) => {
    assert.equal(node.props["aria-label"], label);
    assert.equal(node.props.title, title);
  };

  // A button: named by its label, its title the label unless given.
  const calls = [];
  const ref = { current: null };
  let node = RowButton({
    label: "Filename and metadata: Arrival",
    icon: "film",
    onClick: (event) => calls.push(event),
    buttonRef: ref,
  });
  assert.equal(node.type, "button");
  assert.equal(node.props.type, "button");
  assert.equal(node.props.class, "v2-row-btn");
  assert.equal(node.ref, ref);
  named(node, "Filename and metadata: Arrival");
  assert.equal(node.props.children, "film");
  node.props.onClick("click");
  assert.deepEqual(calls, ["click"]);
  // A link into another app opens a new tab without referrer.
  node = RowButton({
    label: "Open Radarr entry in a new tab",
    icon: "link",
    href: "https://radarr.local/movie/arrival",
    newTab: true,
  });
  assert.equal(node.type, "a");
  assert.equal(node.props.href, "https://radarr.local/movie/arrival");
  assert.equal(node.props.target, "_blank");
  assert.equal(node.props.rel, "noopener noreferrer");
  assert.equal(node.props.referrerPolicy, "no-referrer");
  named(node, "Open Radarr entry in a new tab");
  // A link inside the app stays in the tab.
  node = RowButton({ label: "Open", icon: "x", href: "#/movies" });
  assert.equal(node.type, "a");
  assert.equal(node.props.target, undefined);
  assert.equal(node.props.rel, undefined);
  // A locked one keeps its place as a disabled button, its reason the title.
  node = RowButton({
    label: "Open Radarr entry in a new tab",
    title: "Entry link unavailable.",
    icon: "link",
    href: "https://radarr.local/movie/arrival",
    newTab: true,
    disabled: true,
  });
  assert.equal(node.type, "button");
  assert.equal(node.props.disabled, true);
  assert.equal(node.props.href, undefined);
  named(node, "Open Radarr entry in a new tab", "Entry link unavailable.");
  // sm and on; a menu trigger is on while open.
  node = RowButton({ label: "Tags", icon: "t", size: "sm", on: true });
  assert.equal(node.props.class, "v2-row-btn v2-row-btn--sm v2-row-btn--on");
  node = RowButton({ label: "Media server", icon: "m", popup: "menu" });
  assert.equal(node.props["aria-haspopup"], "menu");
  assert.equal(node.props["aria-expanded"], false);
  assert.equal(node.props.class, "v2-row-btn");
  node = RowButton({
    label: "Media server",
    icon: "m",
    popup: "menu",
    expanded: true,
  });
  assert.equal(node.props["aria-expanded"], true);
  assert.equal(node.props.class, "v2-row-btn v2-row-btn--on");
  assert.equal(
    RowButton({ label: "x", icon: "x" }).props["aria-expanded"],
    undefined,
    "no popup, no aria-expanded",
  );

  // A mark without an action is an image, with one a button or a link;
  // each is named.
  node = RowMark({ tone: "info", label: "Technical outliers", icon: "i" });
  assert.equal(node.type, "span");
  assert.equal(node.props.role, "img");
  assert.equal(node.props.class, "v2-mark v2-mark--info");
  assert.equal(node.props.style, undefined);
  named(node, "Technical outliers");
  const opened = [];
  node = RowMark({
    tone: "warn",
    label: "Show conflicting metadata",
    icon: "w",
    color: "#d9a870",
    onClick: () => opened.push("details"),
  });
  assert.equal(node.type, "button");
  assert.equal(node.props.type, "button");
  assert.equal(node.props.role, undefined);
  assert.equal(node.props.class, "v2-mark v2-mark--warn");
  // A user warning color replaces the tone.
  assert.deepEqual(data(node.props.style), { "--tone": "#d9a870" });
  named(node, "Show conflicting metadata");
  node.props.onClick({});
  assert.deepEqual(opened, ["details"]);
  node = RowMark({
    tone: "accent",
    label: "Marked for muxing",
    icon: "s",
    href: "#/mux",
  });
  assert.equal(node.type, "a");
  assert.equal(node.props.href, "#/mux");
  assert.equal(node.props.class, "v2-mark v2-mark--accent");
  named(node, "Marked for muxing");
});

// --- ListEmpty -----------------------------------------------------------------

test("the list empty state shows its icon, heading and content", () => {
  const { ListEmpty } = listModule("ListEmpty");
  const tree = ListEmpty({
    icon: "search icon",
    title: "No matching files",
    children: ["explanation", "reset"],
  });
  assert.equal(tree.type, "div");
  assert.equal(tree.props.class, "v2-empty");
  const [tile, heading, ...rest] = tree.props.children.flat();
  // The icon in a 48 tile, hidden from assistive technology.
  assert.equal(tile.type, "span");
  assert.equal(tile.props.class, "v2-tile v2-tile--lg");
  assert.equal(tile.props["aria-hidden"], "true");
  assert.equal(tile.props.children, "search icon");
  assert.equal(heading.type, "h3");
  assert.equal(heading.props.class, "v2-empty-title");
  assert.equal(text(heading), "No matching files");
  assert.deepEqual(rest, ["explanation", "reset"]);
});

// --- Segmented ---------------------------------------------------------------

test("segmented tabs and links mark the current item", () => {
  const { Segmented } = listModule("Segmented");
  const chosen = [];
  const props = {
    label: "Statistics scope",
    kind: "tabs",
    value: "all",
    items: [
      { value: "all", label: "Entire library" },
      { value: "radarr", label: "Movies" },
      { value: "sonarr", label: "TV series" },
    ],
    select: (value) => chosen.push(value),
    idPrefix: "scope",
  };
  const mounted = mount(Segmented, props);
  let tree = mounted.render();
  assert.equal(tree.type, "div");
  assert.equal(tree.props.role, "tablist");
  assert.equal(tree.props["aria-label"], "Statistics scope");
  assert.equal(tree.props.class, "v2-seg");
  let tabs = byRole(tree, "tab");
  assert.deepEqual(
    tabs.map((tab) => [
      tab.type,
      tab.props.type,
      tab.props.class,
      tab.props.id,
      tab.props["aria-controls"],
      tab.props["aria-selected"],
      tab.props.tabIndex,
      text(tab),
    ]),
    [
      [
        "button",
        "button",
        "v2-seg-item",
        "scope-tab-all",
        "scope-panel-all",
        true,
        0,
        "Entire library",
      ],
      [
        "button",
        "button",
        "v2-seg-item",
        "scope-tab-radarr",
        "scope-panel-radarr",
        false,
        -1,
        "Movies",
      ],
      [
        "button",
        "button",
        "v2-seg-item",
        "scope-tab-sonarr",
        "scope-panel-sonarr",
        false,
        -1,
        "TV series",
      ],
    ],
  );
  tabs[2].props.onClick();
  assert.deepEqual(chosen.splice(0), ["sonarr"]);

  // ←/→ wrap, Home and End jump; each selects and focuses its tab.
  const focused = [];
  tree.ref.current = {
    querySelectorAll: (selector) =>
      selector === '[role="tab"]'
        ? props.items.map((item) => ({ focus: () => focused.push(item.value) }))
        : [],
  };
  const press = (key) => {
    const event = {
      key,
      prevented: 0,
      preventDefault() {
        this.prevented++;
      },
    };
    tree.props.onKeyDown(event);
    return event;
  };
  assert.equal(press("ArrowRight").prevented, 1);
  press("ArrowLeft");
  press("End");
  press("Home");
  assert.deepEqual(chosen.splice(0), ["radarr", "sonarr", "sonarr", "all"]);
  assert.deepEqual(focused.splice(0), ["radarr", "sonarr", "sonarr", "all"]);
  assert.equal(press("Enter").prevented, 0, "other keys stay the tab's");
  assert.deepEqual(chosen, []);
  // The current tab follows the value.
  props.value = "sonarr";
  tree = mounted.render();
  tabs = byRole(tree, "tab");
  assert.deepEqual(
    tabs.map((tab) => [tab.props["aria-selected"], tab.props.tabIndex]),
    [
      [false, -1],
      [false, -1],
      [true, 0],
    ],
  );
  press("ArrowRight");
  assert.deepEqual(chosen.splice(0), ["all"]);
  assert.deepEqual(focused.splice(0), ["all"]);

  // Links: a named nav of NavLinks, the current one aria-current="page"
  // (NavLink's current), each opening its value; on the band.
  const links = once(Segmented, {
    label: "Instances",
    kind: "links",
    value: "radarr-4k",
    items: [
      { value: "", label: "All", href: "#/movies" },
      { value: "radarr-4k", label: "4K", href: "#/movies?instance=radarr-4k" },
    ],
    select: (value) => chosen.push(value),
    onBand: true,
  });
  assert.equal(links.type, "nav");
  assert.equal(links.props["aria-label"], "Instances");
  assert.equal(links.props.class, "v2-seg v2-seg--on-band");
  assert.equal(byRole(links, "tab").length, 0);
  const anchors = ofType(links, "NavLink");
  assert.deepEqual(
    anchors.map((link) => [
      link.props.class,
      link.props.href,
      link.props.current,
      text(link),
    ]),
    [
      ["v2-seg-item", "#/movies", false, "All"],
      ["v2-seg-item", "#/movies?instance=radarr-4k", true, "4K"],
    ],
  );
  anchors[0].props.open();
  assert.deepEqual(chosen.splice(0), [""]);
});

// --- HelpTip -------------------------------------------------------------------

// The real Popover in a small fake DOM: one listener per event type.
function fakeDom() {
  const dom = {
    activeElement: null,
    body: { name: "body" },
    documentElement: { clientWidth: 1440 },
    listeners: new Map(),
    querySelector: () => null,
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    },
    removeEventListener(type) {
      this.listeners.delete(type);
    },
  };
  const win = {
    innerHeight: 900,
    addEventListener() {},
    removeEventListener() {},
  };
  const element = (name, rect) => ({
    name,
    rect,
    style: {},
    offsetWidth: 240,
    offsetHeight: 120,
    isConnected: true,
    focus() {
      dom.activeElement = this;
    },
    getBoundingClientRect() {
      return this.rect;
    },
    contains(node) {
      return node === this;
    },
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  class ResizeObserver {
    observe() {}
    disconnect() {}
  }
  return { dom, win, element, ResizeObserver };
}

test("the help tip opens a dialog and returns focus", () => {
  const { dom, win, element, ResizeObserver } = fakeDom();
  const { Popover } = loadSource("components/frame/Popover.tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../notifications": notifications,
      "preact/compat": {
        createPortal: (vnode, host) => ({
          type: "Portal",
          props: { host, children: vnode },
        }),
      },
    },
    browser: { document: dom, window: win, ResizeObserver },
  });
  const { HelpTip } = listModule("HelpTip", {
    "../frame/Popover": { Popover },
  });
  const props = {
    label: "Filter logic",
    sections: [
      { heading: "Within a field", text: "Values combine with or." },
      { heading: "Raw", text: "Shown as is", raw: true },
    ],
  };
  const tip = mount(HelpTip, props);
  let tree = tip.render();
  const trigger = () => ofType(tree, "button")[0];
  // An sm icon button named by its label, announcing a dialog.
  assert.equal(trigger().props.type, "button");
  assert.equal(trigger().props.class, "v2-icon-btn v2-icon-btn--sm");
  assert.equal(trigger().props["aria-label"], "Filter logic");
  assert.equal(trigger().props.title, "Filter logic");
  assert.equal(trigger().props["aria-haspopup"], "dialog");
  assert.equal(trigger().props["aria-expanded"], false);
  assert.equal(ofType(tree, Popover).length, 0);

  // A press opens the dialog at the button.
  const button = element("help", {
    top: 100,
    bottom: 128,
    left: 400,
    right: 428,
  });
  trigger().props.onClick({ currentTarget: button });
  tree = tip.render();
  assert.equal(trigger().props["aria-expanded"], true);
  const [pop] = ofType(tree, Popover);
  assert.equal(pop.props.anchor, button);
  assert.equal(pop.props.role, "dialog");
  assert.equal(pop.props.label, "Filter logic");
  assert.deepEqual(
    ofType(pop, "h3").map((h) => [h.props.class, text(h)]),
    [
      ["v2-pop-title", "Within a field"],
      ["v2-pop-title", "Raw"],
    ],
  );
  assert.deepEqual(
    ofType(pop, "p").map((p) => [p.props.class, text(p)]),
    [
      ["v2-pop-text", "Values combine with or."],
      ["v2-pop-text", "Shown as is"],
    ],
  );

  // The popover itself: focus moves into it; Escape returns focus to the
  // button and closes the tip.
  const runtime = createHookRuntime();
  current = runtime;
  const portal = runtime.render(() => Popover(pop.props));
  const panel = element("panel", {
    top: 134,
    bottom: 254,
    left: 188,
    right: 428,
  });
  nodes(portal).find((n) => n.props?.role === "dialog").ref.current = panel;
  runtime.flush();
  assert.equal(dom.activeElement, panel, "focus in the dialog");
  const escape = {
    key: "Escape",
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  dom.listeners.get("keydown")(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(dom.activeElement, button, "focus back on the button");
  tree = tip.render();
  assert.equal(ofType(tree, Popover).length, 0);
  assert.equal(trigger().props["aria-expanded"], false);
  runtime.unmount();

  // A second press closes it as well; a text instead of sections.
  const text1 = mount(HelpTip, { label: "Help", text: "One text." });
  tree = text1.render();
  trigger().props.onClick({ currentTarget: button });
  tree = text1.render();
  assert.deepEqual(
    ofType(ofType(tree, Popover)[0], "p").map((p) => text(p)),
    ["One text."],
  );
  trigger().props.onClick({ currentTarget: button });
  tree = text1.render();
  assert.equal(ofType(tree, Popover).length, 0);
});

// --- SortHeader ----------------------------------------------------------------

test("sort headers cycle and their menu sorts by its fields", () => {
  const { nextTableSort } = loadSource("components/SortableHeader.tsx", {
    modules: { "../ui": ui, "../i18n": i18n },
  });
  const { SortHeader } = listModule("SortHeader", {
    "../frame/Popover": { Popover: "Popover" },
  });
  const header = (props) => once(SortHeader, props);
  const sortButton = (th) => ofType(th, "button")[0];

  // The cycle of the libraries: ascending, descending, back to the default
  // (title ascending), with aria-sort and the 1.7.0 titles.
  const fallback = { field: "title", direction: "asc" };
  let stored = null;
  const year = () =>
    header({
      label: "Year",
      field: "year",
      numeric: true,
      sort: stored || fallback,
      onSort: (field) => (stored = nextTableSort(stored, field)),
    });
  const states = [];
  for (let step = 0; step < 4; step++) {
    const th = year();
    const button = sortButton(th);
    states.push([th.props["aria-sort"], button.props.title]);
    if (step === 0) {
      assert.equal(th.type, "th");
      assert.equal(th.props.scope, "col");
      assert.equal(th.props.class, "v2-table-num");
      assert.equal(button.props.type, "button");
      assert.equal(button.props.class, "v2-sort v2-sort--num");
      assert.equal(button.props["aria-label"], "Sort by Year");
      assert.equal(button.props["aria-haspopup"], undefined);
      assert.match(text(button), /^Year$/);
      assert.equal(ofType(th, icons.ArrowDownUp).length, 1);
    }
    button.props.onClick({ currentTarget: {} });
  }
  assert.deepEqual(states, [
    ["none", "Sort Year ascending"],
    ["ascending", "Sort Year descending"],
    ["descending", "Restore default sort"],
    ["none", "Sort Year ascending"],
  ]);
  stored = { field: "year", direction: "desc" };
  assert.equal(ofType(year(), icons.ArrowDown).length, 1);
  stored = { field: "year", direction: "asc" };
  assert.equal(ofType(year(), icons.ArrowUp).length, 1);
  // The default sort marks the title column; a text column has no num class.
  const title = header({
    label: "Title",
    field: "title",
    sort: fallback,
    onSort() {},
  });
  assert.equal(title.props["aria-sort"], "ascending");
  assert.equal(title.props.class, undefined);
  assert.equal(sortButton(title).props.class, "v2-sort");

  // A sort menu: the button opens a menu of radio entries, one per field;
  // a choice sorts by it and returns focus to the button.
  const sorted = [];
  const props = {
    label: "Audio tracks",
    field: "audio",
    sort: fallback,
    onSort: (field) => sorted.push(field),
    menu: {
      fields: [
        { field: "audio", label: "Audio tracks" },
        { field: "channels", label: "Channels" },
      ],
    },
  };
  const tracks = mount(SortHeader, props);
  let th = tracks.render();
  let button = sortButton(th);
  assert.equal(th.props["aria-sort"], "none");
  assert.equal(button.props["aria-label"], "Sort by Audio tracks");
  assert.equal(button.props.title, "Sort by Audio tracks");
  assert.equal(button.props["aria-haspopup"], "menu");
  assert.equal(button.props["aria-expanded"], false);
  assert.equal(ofType(th, "Popover").length, 0);
  let focused = 0;
  const anchor = { focus: () => focused++ };
  button.props.onClick({ currentTarget: anchor });
  assert.deepEqual(sorted, [], "opening sorts nothing");
  th = tracks.render();
  assert.equal(sortButton(th).props["aria-expanded"], true);
  let [menu] = ofType(th, "Popover");
  assert.equal(menu.props.anchor, anchor);
  assert.equal(menu.props.role, "menu");
  assert.equal(menu.props.label, "Sort by Audio tracks");
  let entries = byRole(menu, "menuitemradio");
  assert.deepEqual(
    entries.map((entry) => [
      entry.type,
      entry.props.type,
      entry.props.class,
      entry.props["aria-checked"],
      text(entry),
      entry.props.title,
    ]),
    [
      [
        "button",
        "button",
        "v2-menu-item",
        false,
        "Sort by Audio tracks",
        "Sort Audio tracks ascending",
      ],
      [
        "button",
        "button",
        "v2-menu-item",
        false,
        "Sort by Channels",
        "Sort Channels ascending",
      ],
    ],
  );
  entries[1].props.onClick();
  assert.deepEqual(sorted, ["channels"]);
  assert.equal(focused, 1, "focus back on the button");
  th = tracks.render();
  assert.equal(ofType(th, "Popover").length, 0);
  assert.equal(sortButton(th).props["aria-expanded"], false);

  // aria-sort follows the active entry; the menu marks it.
  props.sort = { field: "channels", direction: "desc" };
  th = tracks.render();
  assert.equal(th.props["aria-sort"], "descending");
  assert.equal(ofType(th, icons.ArrowDown).length, 1);
  sortButton(th).props.onClick({ currentTarget: anchor });
  [menu] = ofType(tracks.render(), "Popover");
  entries = byRole(menu, "menuitemradio");
  assert.deepEqual(
    entries.map((entry) => [entry.props["aria-checked"], entry.props.title]),
    [
      [false, "Sort Audio tracks ascending"],
      [true, "Restore default sort"],
    ],
  );
  // Escape or a press outside closes it without a sort; a second press on
  // the button too.
  menu.props.close(true);
  th = tracks.render();
  assert.equal(ofType(th, "Popover").length, 0);
  sortButton(th).props.onClick({ currentTarget: anchor });
  th = tracks.render();
  sortButton(th).props.onClick({ currentTarget: anchor });
  assert.equal(ofType(tracks.render(), "Popover").length, 0);
  assert.deepEqual(sorted, ["channels"]);
});

// --- PageNav ---------------------------------------------------------------------

test("page numbers keep the first, last and nearby pages", () => {
  const { PageNav, pageWindow } = listModule("PageNav");
  // Fix round 1: the slots stay as many for a page count (all pages up to
  // seven, else seven), so paging moves no button, and a gap hides at least
  // two pages (never 1 … 3). Every position at 1, 5, 7 and 20 pages:
  const windows = (pages) =>
    Array.from({ length: pages }, (_, i) => data(pageWindow(i + 1, pages)));
  assert.deepEqual(windows(1), [[1]]);
  assert.deepEqual(windows(5), [
    [1, 2, 3, 4, 5],
    [1, 2, 3, 4, 5],
    [1, 2, 3, 4, 5],
    [1, 2, 3, 4, 5],
    [1, 2, 3, 4, 5],
  ]);
  assert.deepEqual(windows(7), [
    [1, 2, 3, 4, 5, 6, 7],
    [1, 2, 3, 4, 5, 6, 7],
    [1, 2, 3, 4, 5, 6, 7],
    [1, 2, 3, 4, 5, 6, 7],
    [1, 2, 3, 4, 5, 6, 7],
    [1, 2, 3, 4, 5, 6, 7],
    [1, 2, 3, 4, 5, 6, 7],
  ]);
  assert.deepEqual(windows(20), [
    [1, 2, 3, 4, 5, "gap", 20],
    [1, 2, 3, 4, 5, "gap", 20],
    [1, 2, 3, 4, 5, "gap", 20],
    [1, 2, 3, 4, 5, "gap", 20],
    [1, "gap", 4, 5, 6, "gap", 20],
    [1, "gap", 5, 6, 7, "gap", 20],
    [1, "gap", 6, 7, 8, "gap", 20],
    [1, "gap", 7, 8, 9, "gap", 20],
    [1, "gap", 8, 9, 10, "gap", 20],
    [1, "gap", 9, 10, 11, "gap", 20],
    [1, "gap", 10, 11, 12, "gap", 20],
    [1, "gap", 11, 12, 13, "gap", 20],
    [1, "gap", 12, 13, 14, "gap", 20],
    [1, "gap", 13, 14, 15, "gap", 20],
    [1, "gap", 14, 15, 16, "gap", 20],
    [1, "gap", 15, 16, 17, "gap", 20],
    [1, "gap", 16, 17, 18, 19, 20],
    [1, "gap", 16, 17, 18, 19, 20],
    [1, "gap", 16, 17, 18, 19, 20],
    [1, "gap", 16, 17, 18, 19, 20],
  ]);
  // Eight pages, the fewest with a gap: each gap hides two pages.
  assert.deepEqual(data(pageWindow(4, 8)), [1, 2, 3, 4, 5, "gap", 8]);
  assert.deepEqual(data(pageWindow(5, 8)), [1, "gap", 4, 5, 6, 7, 8]);
  assert.deepEqual(data(pageWindow(5, 12)), [1, "gap", 4, 5, 6, "gap", 12]);
  // Out of range pages clamp; there is always one page.
  assert.deepEqual(data(pageWindow(25, 20)), [1, "gap", 16, 17, 18, 19, 20]);
  assert.deepEqual(data(pageWindow(0, 20)), [1, 2, 3, 4, 5, "gap", 20]);
  assert.deepEqual(data(pageWindow(1, 0)), [1]);
  // For every count up to 40: one slot count per count, the first and the
  // last page and the current one always shown, each gap two pages or more.
  for (let pages = 1; pages <= 40; pages++)
    for (let page = 1; page <= pages; page++) {
      const shown = data(pageWindow(page, pages));
      const where = page + "/" + pages;
      assert.equal(shown.length, Math.min(pages, 7), where);
      assert.equal(shown[0], 1, where);
      assert.equal(shown.at(-1), pages, where);
      assert.ok(shown.includes(page), where);
      shown.forEach((entry, i) => {
        if (entry === "gap")
          assert.ok(shown[i + 1] - shown[i - 1] >= 3, where + " gap");
      });
    }

  const calls = [];
  const nav = (page, pages) =>
    PageNav({
      page,
      pages,
      setPage: (value) => calls.push(value),
      summary: "401–500 of 1,200 files",
    });
  const tree = nav(5, 12);
  assert.equal(tree.type, "nav");
  assert.equal(tree.props.class, "v2-pager");
  assert.equal(tree.props["aria-label"], "Page 5 / 12");
  assert.match(text(tree), /^401–500 of 1,200 files/);
  const buttons = ofType(tree, "button");
  const [previous, ...rest] = buttons;
  const next = rest.pop();
  assert.equal(previous.props["aria-label"], "Previous page");
  assert.equal(previous.props.title, "Previous page");
  assert.equal(next.props["aria-label"], "Next page");
  assert.equal(next.props.title, "Next page");
  assert.deepEqual(
    rest.map((b) => [text(b), b.props["aria-current"], b.props.class]),
    [
      ["1", undefined, "v2-pager-btn"],
      ["4", undefined, "v2-pager-btn"],
      ["5", "page", "v2-pager-btn"],
      ["6", undefined, "v2-pager-btn"],
      ["12", undefined, "v2-pager-btn"],
    ],
  );
  for (const b of buttons) assert.equal(b.props.type, "button");
  const gaps = nodes(tree).filter((n) => n.props?.class === "v2-pager-gap");
  assert.equal(gaps.length, 2);
  for (const gap of gaps) assert.equal(gap.props["aria-hidden"], "true");
  rest[1].props.onClick();
  previous.props.onClick();
  next.props.onClick();
  rest[2].props.onClick();
  assert.deepEqual(calls, [4, 4, 6], "the current page is no jump");
  assert.equal(previous.props.disabled, false);
  assert.equal(next.props.disabled, false);
  // The first and the last page lock their direction.
  const first = ofType(nav(1, 12), "button");
  assert.equal(first[0].props.disabled, true);
  assert.equal(first.at(-1).props.disabled, false);
  const last = ofType(nav(12, 12), "button");
  assert.equal(last[0].props.disabled, false);
  assert.equal(last.at(-1).props.disabled, true);
  const single = ofType(nav(1, 1), "button");
  assert.deepEqual(
    single.map((b) => b.props.disabled),
    [true, undefined, true],
  );
});
