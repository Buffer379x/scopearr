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
import { between, squash, src } from "./helpers/sources.mjs";

// Settings → Services on the v2 blocks (Phase 5c, task 4): the band, the
// Synchronization card, the row of the service tabs with Add service and
// one ServiceCard of the chosen tab; MKVToolNix, MediaInfo and Unraid as
// ServiceCards whose first section is their status. The components run as
// real code with the hook runtime; the blocks they place are named stubs,
// so a tree shows what each one receives.

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const i18n = { t, useI18n: () => ({ locale: "en" }) };
const ui = {
  ICON: { label: 15, button: 16 },
  labels: {},
  bytes: (n) => n + " B",
  compactBytes: (n) => n + " B",
};

let current = createHookRuntime();
const hooks = new Proxy({}, { get: (_, name) => current.hooks[name] });

const model = loadSource("settings-model.ts", {
  modules: {
    "./themes": loadSource("themes.ts"),
    "./event-log": loadSource("event-log.ts"),
  },
});
const blocks = {
  ServiceCard: "ServiceCard",
  ServiceSection: "ServiceSection",
};

function mount(component, props) {
  const runtime = createHookRuntime();
  const view = {
    runtime,
    props,
    render() {
      current = runtime;
      return runtime.render(() => component(view.props));
    },
    flush() {
      current = runtime;
      runtime.flush();
    },
    unmount() {
      current = runtime;
      runtime.unmount();
    },
  };
  return view;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const data = (value) => JSON.parse(JSON.stringify(value ?? null));
const classes = (node) => String(node?.props?.class ?? "").split(" ");
const byClass = (tree, name) =>
  nodes(tree).filter((n) => classes(n).includes(name));
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
const one = (tree, type) => {
  const found = ofType(tree, type);
  assert.equal(found.length, 1, "one " + String(type?.name ?? type));
  return found[0];
};
// A button's shown label: its text without a hidden stacked label (10.3).
const shown = (node) =>
  text(node).slice(
    0,
    text(node).length - text(byClass(node, "v2-btn-alt")).length,
  );
const button = (tree, label) =>
  nodes(tree).find((n) => n.type === "button" && text(n).trim() === label);
const component = (path, modules, browser = {}) =>
  loadSource(path, {
    modules: {
      "preact/hooks": hooks,
      "../ui": ui,
      "../i18n": i18n,
      "../settings-model": model,
      "./settings/Field": loadSource("components/settings/Field.tsx"),
      "./settings/Check": loadSource("components/settings/Check.tsx"),
      ...modules,
    },
    browser,
    stubs: PRESENTATION_MODULES,
  });

// The MKVToolNix tab of the demo: MKVToolNix and Unraid, no library.
function services({ api = () => new Promise(() => {}), settings } = {}) {
  const cfg = settings ?? { instances: [], mux: { enabled: true } };
  const { ConnectionSettings } = component(
    "components/ConnectionSettings.tsx",
    {
      "../browser-storage": {
        readSessionPreference: () => "",
        writeSessionPreference() {},
      },
      "../api": { api },
      "../confirmation": {
        confirmDeletion: async () => true,
        confirmDiscard: async () => true,
      },
      "../notifications": { notify() {} },
      "./WebhookSettings": { WebhookSettings: "WebhookSettings" },
      "../instances": loadSource("instances.ts"),
      "./UnraidSettings": { UnraidSettings: "UnraidSettings" },
      "./MediaInfoSettings": { MediaInfoSettings: "MediaInfoSettings" },
      "./MuxToolSettings": { MuxToolSettings: "MuxToolSettings" },
      "../mux-spec": { defaultMuxSettings: () => ({}) },
      "./list/Segmented": { Segmented: "Segmented" },
      "../hooks/useManualSync": {
        useManualSync: () => ({ syncing: {}, sync: async () => {} }),
      },
      "./settings/ServiceCard": blocks,
      "./settings/ServiceStatus": {
        ServiceStatus: "ServiceStatus",
        StatusValue: "StatusValue",
      },
      "./ExternalTagStatus": {
        ExternalTagCheck: "ExternalTagCheck",
        externalTagText: () => "",
      },
      "./settings/LibraryStatus": loadSource(
        "components/settings/LibraryStatus.tsx",
        {
          modules: {
            "../../i18n": i18n,
            "./ServiceStatus": { StatusValue: "StatusValue" },
            "../ExternalTagStatus": { externalTagText: () => "" },
          },
        },
      ),
    },
    { document: { querySelector: () => null } },
  );
  return mount(ConnectionSettings, {
    cfg,
    setCfg() {},
    settings: cfg,
    demo: true,
    hidden: false,
    tab: "",
    setTab() {},
  });
}

test("services build the band, the timezone card and one service card", () => {
  // The band: SettingsPage renders the area's SettingsHeader (title,
  // description, Save settings of the form) instead of the page title and
  // the 1.7.0 section heading; the demo notice is a v2 notice, the first
  // block of the form's v2-set.
  const page = squash(src("components/SettingsPage.tsx"));
  // Since Phase 5c task 6 Display shares it, since task 7 Widgets and
  // Custom tags (Custom tags renders its own band), since task 9 System
  // (without Save settings): every area is on the v2 blocks.
  assert.match(
    page,
    /\/\/ Every area is on the v2 blocks \(Phase 5c\);[^]*? const ownBand = section === "custom" \|\| section === "recognition";/,
  );
  assert.match(
    page,
    /\{!ownBand && \( <SettingsHeader section=\{section as SettingsSectionId\} save=\{ section === "system" \? undefined : \{ form: settingsFormId, busy, disabled: !dirty, dirty \} \}[\s\S]*?\/> \)\}/,
  );
  assert.match(page, /<form id=\{settingsFormId\} class="v2-set"/);
  assert.doesNotMatch(page, /SettingsSectionHeading|<PageHeader/);
  assert.match(
    between(page, "{demo &&", "</div>"),
    /\{demo && !ownBand && section !== "system" && \( <div class="v2-notice">/,
  );
  const view = services();
  const tree = view.render();
  // The page column: the Synchronization card, the tab row, one card.
  assert.equal(tree.type, "div");
  assert.equal(tree.props.class, "v2-set");
  const [sync, bar, card] = tree.props.children.filter(
    (child) => child && typeof child === "object",
  );
  assert.deepEqual(classes(sync), ["v2-card", "v2-svc-sync"]);
  assert.equal(sync.type, "section");
  assert.equal(sync.props["aria-labelledby"], "sync-timezone-title");
  const title = one(sync, "h2");
  assert.equal(title.props.id, "sync-timezone-title");
  assert.equal(text(title), "Synchronization");
  const field = one(sync, "input");
  assert.equal(field.props.id, "sync-timezone");
  assert.equal(field.props.class, "v2-input");
  assert.equal(field.props["aria-describedby"], "sync-timezone-hint");
  const label = one(sync, "label");
  assert.equal(label.props.for, "sync-timezone");
  assert.equal(text(label), "Sync timezone");
  assert.equal(
    one(sync, "small").props.id,
    "sync-timezone-hint",
    "the 1.7.0 hint describes the field",
  );
  assert.match(text(one(sync, "small")), /^Clock schedules use this IANA/);
  assert.equal(byClass(sync, "v2-field").length, 1);
  // The tab row: the segment and Add service (locked in the demo).
  assert.equal(bar.props.class, "v2-svc-bar");
  const tabs = one(bar, "Segmented");
  assert.equal(tabs.props.kind, "tabs");
  assert.equal(tabs.props.label, "Configured services");
  assert.equal(tabs.props.idPrefix, "service-settings");
  assert.equal(tabs.props.value, "mux");
  const add = button(bar, "Add service");
  assert.equal(add.props.class, "v2-btn");
  assert.equal(add.props.type, "button");
  assert.equal(add.props.disabled, true);
  assert.equal(ofType(add, icons.Plus).length, 1);
  // One card, the chosen tab's.
  assert.equal(card.type, "MuxToolSettings");
  assert.equal(ofType(tree, "UnraidSettings").length, 0);
  // No 1.7.0 parts of the page.
  for (const gone of [
    "settings-section",
    "settings-section-heading",
    "connection",
    "connection-heading",
    "service-instance-toolbar",
    "sync-timezone",
  ])
    assert.equal(byClass(tree, gone).length, 0, gone);
  assert.equal(ofType(tree, "SegmentedTabs").length, 0);
  assert.equal(ofType(tree, "CardHeading").length, 0);
  // Without any service: the 1.7.0 hint as a v2 notice.
  assert.match(
    squash(src("components/ConnectionSettings.tsx")),
    /<p class="v2-notice"> \{t\("Add a service to connect your libraries and media servers\."\)\} <\/p>/,
  );
  // A hidden area stays mounted and hidden.
  view.props = { ...view.props, hidden: true };
  assert.equal(view.render().props.hidden, true);
});

test("service tabs mark their state and keep their width", async () => {
  const tool = (installed, extra = {}) => ({ installed, ...extra });
  const answers = {
    "mux/tool": tool(true),
    "mediainfo/tool": tool(false, { error: "Download failed" }),
  };
  const view = services({
    api: async (path) => answers[path],
    settings: {
      instances: [
        {
          id: "radarr",
          type: "radarr",
          name: "",
          enabled: true,
          url: "",
          interval: 60,
        },
      ],
      mux: { enabled: true },
      mediaInfo: { enabled: true },
    },
  });
  const items = () => data(one(view.render(), "Segmented").props.items);
  // Every tab carries its dot from the first paint (neutral until its
  // state is known), so no tab grows when the state arrives; its name is
  // its label alone.
  const first = items();
  assert.deepEqual(
    first.map((item) => item.value),
    ["mediainfo", "mux", "radarr", "unraid"],
  );
  for (const item of first) {
    assert.equal(item.dot, "neutral", item.value);
    assert.equal(item.dirty, undefined, item.value);
  }
  view.flush();
  await settle();
  const known = Object.fromEntries(
    items().map((item) => [item.value, item.dot]),
  );
  assert.deepEqual(known, {
    mediainfo: "error",
    mux: "ok",
    radarr: "neutral",
    unraid: "neutral",
  });
  assert.deepEqual(
    items().map((item) => item.label),
    ["MediaInfo", "MKVToolNix", "Radarr", "Unraid"],
  );
  // The real segment: the dot is hidden, so the tab is named by its label.
  const { Segmented } = loadSource("components/list/Segmented.tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../i18n": i18n,
      "../frame/NavLink": { NavLink: "NavLink" },
    },
  });
  const segment = mount(Segmented, {
    ...one(view.render(), "Segmented").props,
  }).render();
  for (const tab of ofType(segment, "button")) {
    const dot = byClass(tab, "v2-seg-dot");
    assert.equal(dot.length, 1);
    assert.equal(dot[0].props["aria-hidden"], "true");
    assert.ok(
      ["MediaInfo", "MKVToolNix", "Radarr", "Unraid"].includes(
        tab.props.children.filter((c) => typeof c === "string").join(""),
      ),
    );
    assert.match(tab.props["aria-controls"], /^service-settings-panel-/);
  }
});

// --- MKVToolNix and MediaInfo ------------------------------------------------

function toolCard({ status, api, actions, label = "MKVToolNix" }) {
  const asked = [];
  const { ToolPackageCard } = component("components/ToolPackageCard.tsx", {
    "../hooks/usePolling": { usePolling() {} },
    "../api": { api },
    "../confirmation": {
      confirmDeletion: async (message) => (asked.push(message), true),
    },
    "../tool-package": { toolPackageActions: () => actions },
    "./settings/ServiceCard": blocks,
    "./settings/ServiceStatus": {
      ServiceStatus: "ServiceStatus",
      StatusValue: "StatusValue",
    },
  });
  const heads = [];
  const view = mount(ToolPackageCard, {
    endpoint: label === "MKVToolNix" ? "mux/tool" : "mediainfo/tool",
    label,
    status,
    enabled: true,
    channel: "stable",
    changeChannel() {},
    demo: false,
    head: (next) => heads.push(data(next)),
  });
  return { view, asked, heads };
}

test("the tool cards show tool status first", async () => {
  const asked = [];
  const changes = [];
  const { MuxToolSettings } = component("components/MuxToolSettings.tsx", {
    "../mux-spec": {
      defaultMuxSettings: () => ({
        enabled: true,
        channel: "stable",
        workDir: "",
        deleteOriginal: true,
        notifyMedia: true,
        keepFinished: 7,
      }),
    },
    "../confirmation": {
      confirmDeletion: async (message) => (asked.push(message), true),
    },
    "./ToolPackageCard": { ToolPackageCard: "ToolPackageCard" },
    "./PathMappingsCard": { PathMappingsCard: "PathMappingsCard" },
    "./settings/ServiceCard": blocks,
  });
  const view = mount(MuxToolSettings, {
    cfg: {},
    change: (next) => changes.push(data(next)),
    demo: false,
  });
  const tree = view.render();
  const card = one(tree, "ServiceCard");
  assert.equal(card.props.id, "mux");
  assert.equal(card.props.name, "MKVToolNix");
  assert.equal(card.props.sub, undefined);
  assert.equal(ofType(card.props.icon, icons.Scissors).length, 1);
  assert.deepEqual(data(card.props.status), {
    tone: "neutral",
    text: "—",
    long: "—",
  });
  assert.equal(card.props.actions, undefined, "the tool actions sit below");
  // Sections in this order: Tool and updates, Path mappings, Processing.
  const sections = [card.props.children]
    .flat(Infinity)
    .filter((child) => child && typeof child === "object");
  assert.deepEqual(
    sections.map((child) => child.type),
    ["ToolPackageCard", "PathMappingsCard", "ServiceSection"],
  );
  assert.equal(sections[0].props.label, "MKVToolNix");
  assert.equal(sections[2].props.title, "Processing");
  // The tool card reports the head tag.
  sections[0].props.head({ tone: "ok", text: "Installed", long: "Installed" });
  assert.equal(
    one(view.render(), "ServiceCard").props.status.text,
    "Installed",
  );
  // The switch: "Enable service"; off asks first with the 1.7.0 text.
  const active = one(view.render(), "ServiceCard").props.active;
  assert.equal(active.label, "Enable service");
  assert.equal(active.checked, true);
  assert.equal(active.disabled, false);
  await active.change(false);
  assert.deepEqual(asked, ["Disable MKVToolNix and cancel the running job?"]);
  assert.equal(changes.at(-1).enabled, false);
  await active.change(true);
  assert.equal(asked.length, 1, "switching on asks nothing");
  // Processing keeps its 1.7.0 fields: the directory radios, the separate
  // directory, delete original, notify media servers and the job age.
  const processing = sections[2];
  const radios = ofType(processing, "input").filter(
    (n) => n.props.type === "radio",
  );
  assert.equal(radios.length, 2);
  for (const radio of radios) assert.equal(radio.props.class, "v2-check");
  const group = nodes(processing).find((n) => n.props?.role === "radiogroup");
  assert.equal(group.props["aria-labelledby"], "mux-directory-label");
  assert.match(text(processing), /Same folder as the media file/);
  assert.match(text(processing), /Delete original after success/);
  assert.match(text(processing), /Notify media servers/);
  assert.match(text(processing), /Remove successful jobs after days/);
  for (const check of ofType(processing, "input").filter(
    (n) => n.props.type === "checkbox",
  ))
    assert.equal(check.props.class, "v2-check");

  // Tool and updates: the status rows, the package actions in its heading
  // line, the channel; Remove asks first with the 1.7.0 text.
  const calls = [];
  const tool = toolCard({
    status: undefined,
    actions: [
      { action: "update", disabled: false },
      { action: "check", disabled: false },
      { action: "remove", disabled: false },
    ],
    api: async (path, method = "GET") => {
      calls.push([path, method]);
      return { installed: true, version: "88.0" };
    },
  });
  let section = tool.view.render();
  assert.equal(section.type, "ServiceSection");
  assert.equal(section.props.title, "Tool and updates");
  const buttons = ofType(section.props.actions, "button");
  assert.deepEqual(
    buttons.map((b) => [shown(b), b.props.class]),
    [
      ["Update", "v2-btn v2-btn--sm"],
      ["Check for updates", "v2-btn v2-btn--sm"],
      ["Remove", "v2-btn v2-btn--sm"],
    ],
  );
  // Before the answer every value reads "—" (KeyValues), the head too.
  let status = one(section, "ServiceStatus");
  assert.equal(status.props.kind, "mux");
  for (const key of [
    "status",
    "installed",
    "available",
    "upstream",
    "checked",
    "size",
  ])
    assert.equal(status.props.values[key], undefined, key);
  tool.view.flush();
  assert.deepEqual(tool.heads, [{ tone: "neutral", text: "—", long: "—" }]);
  await buttons[2].props.onClick();
  await settle();
  assert.deepEqual(tool.asked, [
    "Remove the downloaded MKVToolNix tools? Media files and jobs are kept.",
  ]);
  assert.deepEqual(calls, [
    ["mux/tool?action=remove", "POST"],
    ["mux/tool", "GET"],
  ]);
  section = tool.view.render();
  tool.view.flush();
  assert.deepEqual(tool.heads.at(-1), {
    tone: "ok",
    text: "Installed",
    long: "Installed",
  });
  status = one(section, "ServiceStatus");
  assert.equal(text(status.props.values.installed), "88.0 · Installed");
  assert.equal(
    one(status.props.values.status, "StatusValue").props.view.text,
    "Installed",
  );
  assert.equal(text(status.props.values.checked), "Not checked yet");
  // A tool error stands in the status value, in the error tone, with no
  // notice of its own; a polite visually hidden live region carries it, so
  // an error that arrives by polling is announced (1.7.0 had a status
  // notice). Without an error the region is there and empty.
  const live = (tree) =>
    nodes(tree).filter((n) => n.props?.["aria-live"] === "polite");
  assert.equal(live(section).length, 1);
  assert.equal(live(section)[0].props.class, "v2-sr-only");
  assert.equal(text(live(section)[0]), "");
  const failed = toolCard({
    status: { installed: false, error: "Download failed" },
    actions: [],
    api: async () => ({}),
  });
  const failure = failed.view.render();
  const value = one(failure, "ServiceStatus").props.values.status;
  assert.equal(one(value, "StatusValue").props.view.tone, "error");
  assert.equal(one(value, "StatusValue").props.view.long, "Download failed");
  assert.equal(byClass(failure, "notice").length, 0);
  assert.equal(
    nodes(failure).filter((n) => n.props?.role === "status").length,
    0,
  );
  assert.equal(live(failure).length, 1);
  assert.equal(text(live(failure)[0]), "Download failed");
  // The package channel is a labelled select in the form grid.
  const channel = one(failure, "select");
  assert.equal(channel.props.class, "v2-select");
  assert.equal(channel.props.id, "mux-channel");
  const channelLabel = nodes(failure).find(
    (n) => n.type === "label" && n.props.for === channel.props.id,
  );
  assert.equal(text(channelLabel), "Package channel");
  assert.equal(byClass(failure, "v2-form").length, 1);
  assert.match(
    text(failure),
    /Edit tracks with a local tool downloaded into Appdata\./,
  );
});

test("the tool actions keep three places before and after the answer", async () => {
  // Download or Update, Check for updates and Remove are always there, in
  // this order, so the heading line never gains or loses a button: Remove
  // is locked before the answer and while the tool is not installed.
  const { toolPackageActions } = loadSource("tool-package.ts");
  const row = async (status, { demo = false, enabled = true } = {}) => {
    const { ToolPackageCard } = component("components/ToolPackageCard.tsx", {
      "../hooks/usePolling": { usePolling() {} },
      "../api": { api: async () => ({}) },
      "../confirmation": { confirmDeletion: async () => true },
      "../tool-package": { toolPackageActions },
      "./settings/ServiceCard": blocks,
      "./settings/ServiceStatus": {
        ServiceStatus: "ServiceStatus",
        StatusValue: "StatusValue",
      },
    });
    const view = mount(ToolPackageCard, {
      endpoint: "mux/tool",
      label: "MKVToolNix",
      status,
      enabled,
      channel: "stable",
      changeChannel() {},
      demo,
    });
    const actions = view.render().props.actions;
    // The hidden label never names the button.
    for (const alt of byClass(actions, "v2-btn-alt"))
      assert.equal(alt.props["aria-hidden"], "true");
    return data(
      ofType(actions, "button").map((b) => [
        shown(b),
        b.props.disabled,
        text(byClass(b, "v2-btn-alt")),
      ]),
    );
  };
  // The first place holds both labels, the other one hidden, so it is as
  // wide before and after an install (10.3).
  assert.deepEqual(await row(undefined), [
    ["Download", false, "Update"],
    ["Check for updates", false, ""],
    ["Remove", true, ""],
  ]);
  assert.deepEqual(await row({ installed: false }), [
    ["Download", false, "Update"],
    ["Check for updates", false, ""],
    ["Remove", true, ""],
  ]);
  assert.deepEqual(await row({ installed: true }), [
    ["Update", false, "Download"],
    ["Check for updates", false, ""],
    ["Remove", false, ""],
  ]);
  // The 1.7.0 locks stay: busy and the demo lock every place; a disabled
  // tool can still be removed.
  for (const locked of [
    await row({ installed: true, busy: "checking" }),
    await row({ installed: true }, { demo: true }),
  ])
    assert.deepEqual(
      locked.map(([, disabled]) => disabled),
      [true, true, true],
    );
  assert.deepEqual(
    (await row({ installed: true }, { enabled: false })).map(([, d]) => d),
    [true, true, false],
  );
});

test("MediaInfo keeps read-only path mappings", () => {
  const changes = [];
  const { MediaInfoSettings } = component("components/MediaInfoSettings.tsx", {
    "./ToolPackageCard": { ToolPackageCard: "ToolPackageCard" },
    "./PathMappingsCard": { PathMappingsCard: "PathMappingsCard" },
    "./settings/ServiceCard": blocks,
  });
  const view = mount(MediaInfoSettings, {
    cfg: { mediaInfo: { enabled: true, channel: "edge" } },
    change: (next) => changes.push(data(next)),
    changeMux() {},
    demo: false,
  });
  const card = one(view.render(), "ServiceCard");
  assert.equal(card.props.id, "mediainfo");
  assert.equal(card.props.name, "MediaInfo");
  assert.equal(ofType(card.props.icon, icons.ScanSearch).length, 1);
  const sections = [card.props.children]
    .flat(Infinity)
    .filter((child) => child && typeof child === "object");
  assert.deepEqual(
    sections.map((child) => child.type),
    ["ToolPackageCard", "PathMappingsCard"],
  );
  assert.equal(sections[0].props.label, "MediaInfo");
  assert.equal(sections[0].props.endpoint, "mediainfo/tool");
  assert.equal(sections[0].props.channel, "edge");
  assert.equal(sections[1].props.readOnly, true);
  // Switching MediaInfo off asks nothing.
  card.props.active.change(false);
  assert.deepEqual(changes, [{ enabled: false, channel: "edge" }]);
  assert.equal(card.props.active.label, "Enable service");
  // The tool card's description is MediaInfo's.
  const tool = toolCard({
    status: undefined,
    actions: [],
    label: "MediaInfo",
    api: async () => ({}),
  });
  assert.match(
    text(tool.view.render()),
    /Read media metadata locally when you choose Read file in file details\./,
  );
});

// --- Unraid --------------------------------------------------------------

const UNRAID = {
  enabled: true,
  diskRoot: "/unraid",
  shareRoot: "/media",
  stateDir: "",
  muxSameDisk: false,
  verifyChecksum: false,
  ownerUid: 99,
  ownerGid: 100,
};
function unraid({ api, demo = false, value = UNRAID }) {
  const { UnraidSettings } = component(
    "components/UnraidSettings.tsx",
    {
      "./FileCheckNamesDialog": {
        FileCheckNamesDialog: "FileCheckNamesDialog",
      },
      "../filecheck": { defaultFileCheckSettings: { allowed: [], ignore: [] } },
      "../placement-messages": { placementMessage: () => "" },
      "../api": { api },
      "../placement": { defaultUnraidSettings: UNRAID },
      "./MuxPathDialog": { PathCheckRow: "PathCheckRow" },
      "./UnraidShares": { UnraidShares: "UnraidShares" },
      "./settings/ServiceCard": blocks,
      "./settings/ServiceStatus": {
        ServiceStatus: "ServiceStatus",
        StatusValue: "StatusValue",
      },
    },
    { AbortController },
  );
  return mount(UnraidSettings, {
    cfg: { unraid: value },
    demo,
    change() {},
    changeFileCheck() {},
  });
}

test("the Unraid card reads its status once and shows one mover and parity line", async () => {
  const calls = [];
  let answer;
  const view = unraid({
    api: (path, method = "GET", body, signal, options) => {
      calls.push({ path, method, signal, options });
      if (path === "unraid/status")
        return new Promise((resolve) => (answer = resolve));
      if (path === "unraid/check")
        return Promise.resolve({
          root: true,
          share: true,
          checked: 0,
          found: 0,
          disks: [],
          state: { known: true },
          warnings: [],
        });
      return Promise.resolve({});
    },
  });
  let tree = view.render();
  const card = one(tree, "ServiceCard");
  assert.equal(card.props.id, "unraid");
  assert.equal(card.props.name, "Unraid");
  assert.equal(ofType(card.props.icon, icons.HardDrive).length, 1);
  assert.equal(card.props.active.label, "Enable Unraid disk placement");
  // The sections: Status first, then Paths, Files & permissions, Shares.
  const titles = ofType(tree, "ServiceSection").map((s) => s.props.title);
  assert.deepEqual(titles, ["Status", "Paths", "Files & permissions"]);
  assert.equal(ofType(tree, "UnraidShares").length, 1);
  const status = one(tree, "ServiceStatus");
  assert.equal(status.props.kind, "unraid");
  assert.deepEqual(Object.keys(status.props.values), [
    "status",
    "mover",
    "disks",
  ]);
  // KeyValues shows "—" for an empty value until the answer.
  for (const value of Object.values(status.props.values))
    assert.equal(value, null, "— until the answer");
  view.flush();
  view.render();
  view.flush();
  const reads = calls.filter((c) => c.path === "unraid/status");
  assert.equal(reads.length, 1, "one read per opening");
  assert.equal(reads[0].method, "GET");
  assert.equal(reads[0].options.notifyErrors, false);
  answer({
    enabled: true,
    ready: true,
    disks: [
      { name: "disk1", kind: "array" },
      { name: "disk2", kind: "array" },
      { name: "cache", kind: "pool" },
    ],
    state: { known: true, mover: false, parity: true },
    fileWork: "",
  });
  await settle();
  tree = view.render();
  const values = one(tree, "ServiceStatus").props.values;
  assert.equal(text(values.mover), "Parity operation in progress");
  assert.equal(text(values.disks), "2 array disks · 1 pools");
  assert.equal(one(values.status, "StatusValue").props.view.text, "Ready");
  assert.equal(one(tree, "ServiceCard").props.status.text, "Ready");
  // One mover/parity line in the card.
  assert.equal(
    (JSON.stringify(data(tree)).match(/Parity operation in progress/g) || [])
      .length,
    1,
  );
  view.render();
  view.flush();
  assert.equal(calls.filter((c) => c.path === "unraid/status").length, 1);
  // Check paths, the head's action, opens the 1.7.0 dialog.
  const check = button(one(tree, "ServiceCard").props.actions, "Check paths");
  assert.equal(check.props.class, "v2-btn");
  await check.props.onClick();
  await settle();
  tree = view.render();
  const dialog = one(tree, "Modal");
  assert.equal(dialog.props.title, "Unraid path check");
  // Leaving aborts a read that has not answered.
  const late = unraid({
    api: (path, method, body, signal) => {
      calls.push({ path, signal });
      return new Promise(() => {});
    },
  });
  late.render();
  late.flush();
  const signal = calls.at(-1).signal;
  assert.equal(
    calls.filter((c) => c.signal === signal && c.path === "unraid/status")
      .length,
    1,
  );
  assert.equal(signal.aborted, false);
  late.unmount();
  assert.equal(signal.aborted, true);
});

test("Unraid shares become a v2 table with card rows", async () => {
  const { UnraidShares } = component("components/UnraidShares.tsx", {
    "../api": {
      api: async () => ({
        rootFolders: [
          {
            arrPath: "/movies",
            instances: ["Radarr"],
            status: "resolved",
            shareDir: "movies",
            automaticShareDir: "movies",
          },
        ],
        choices: ["movies", "shows"],
      }),
    },
    "../hooks/useTableOverflow": { useTableOverflow: () => false },
    "./settings/ServiceCard": blocks,
  });
  const view = mount(UnraidShares, {
    value: UNRAID,
    mappings: "",
    demo: false,
    change() {},
  });
  view.render();
  view.flush();
  await settle();
  const tree = view.render();
  assert.equal(tree.type, "ServiceSection");
  assert.equal(tree.props.title, "Shares");
  const refresh = nodes(tree.props.actions).find((n) => n.type === "button");
  assert.equal(refresh.props["aria-label"], "Refresh shares");
  assert.equal(refresh.props.class, "v2-icon-btn v2-icon-btn--sm");
  const table = one(tree, "table");
  assert.equal(table.props.class, "v2-table");
  assert.deepEqual(
    ofType(table, "th").map((th) => [text(th), th.props.scope]),
    [
      ["Root folder", "col"],
      ["Instances", "col"],
      ["Share folder", "col"],
      ["Status", "col"],
    ],
  );
  const row = one(table, "tbody").props.children[0];
  assert.deepEqual(
    ofType(row, "td").map((td) => td.props["data-label"]),
    ["Root folder", "Instances", "Share folder", "Status"],
  );
  const share = one(table, "select");
  assert.equal(share.props["aria-label"], "Share folder for /movies");
  assert.equal(share.props.class, "v2-select");
  assert.equal(one(table, "StatusTag").props.view.tone, "ok");
  assert.equal(byClass(tree, "detail-table").length, 0);
  assert.equal(byClass(tree, "tag").length, 0);
});
