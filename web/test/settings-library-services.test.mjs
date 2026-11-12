import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as icons from "lucide-preact";
import {
  loadSource,
  nodes,
  PRESENTATION_MODULES,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { squash, src } from "./helpers/sources.mjs";

// Settings → Services, the library (Radarr, Sonarr) and media server
// (Emby, Jellyfin) cards (Phase 5c, task 5): one ServiceCard of the chosen
// tab with its status first, then Connection, External tags, the outbound
// tag groups, Realtime updates (libraries) or Contributing libraries
// (media servers); Test connection and Sync now / Match now in its head.
// The components run as real code with the hook runtime; the blocks they
// place are named stubs, so a tree shows what each one receives.

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const i18n = { t, useI18n: () => ({ locale: "en" }) };
const GROUPS = {
  resolution: "Resolution",
  codec: "Codec / encoder",
  source: "Source",
  hdr: "HDR",
  bitDepth: "Bit depth",
  audio: "Audio",
  channels: "Channels",
  language: "Language",
  custom: "Custom tags",
};
const ui = {
  ICON: { label: 15, button: 16 },
  labels: GROUPS,
  date: (s) => (s ? "D(" + s + ")" : "Not synced yet"),
  count: (n) => "#" + n,
};

let current = createHookRuntime();
const hooks = new Proxy({}, { get: (_, name) => current.hooks[name] });

const model = loadSource("settings-model.ts", {
  modules: {
    "./themes": loadSource("themes.ts"),
    "./event-log": loadSource("event-log.ts"),
  },
});

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
const button = (tree, label) =>
  nodes(tree).find((n) => n.type === "button" && text(n).trim() === label);
const objects = (children) =>
  [children]
    .flat(Infinity)
    .filter((child) => child && typeof child === "object");
// The field whose label (label[for]) reads `name`, with its control and hint.
function field(tree, name) {
  const label = nodes(tree).find(
    (n) => n.type === "label" && n.props.for && text(n) === name,
  );
  assert.ok(label, "a labelled field " + name);
  const control = nodes(tree).find(
    (n) =>
      ["input", "select", "textarea"].includes(n.type) &&
      n.props.id === label.props.for,
  );
  assert.ok(control, "the control of " + name);
  const hint = nodes(tree).find(
    (n) =>
      n.type === "small" && n.props.id === control.props["aria-describedby"],
  );
  return { label, control, hint: hint && text(hint) };
}
const check = (tree, name) => {
  const label = nodes(tree).find(
    (n) =>
      n.type === "label" &&
      classes(n).includes("v2-ff-check") &&
      text(n).trim() === name,
  );
  assert.ok(label, "a checkbox " + name);
  return one(label, "input");
};

const library = (id, type, extra = {}) => ({
  id,
  type,
  name: "",
  enabled: true,
  url: "",
  interval: 60,
  syncStart: "",
  tagImport: false,
  tagImportInterval: 5,
  webhookEnabled: false,
  tagSync: {},
  ...extra,
});
const RADARR = library("radarr", "radarr", {
  name: "Radarr HD",
  url: "http://radarr:7878",
  hasKey: true,
  apiKey: "",
});

// The ConnectionSettings of `cfg` on its `tab`, with the frame's status
// and sync summary; setCfg applies to the shown draft.
function services({
  cfg,
  settings = cfg,
  tab = "radarr",
  status,
  summary,
  demo = false,
  api = () => new Promise(() => {}),
  answer = true,
  refresh = async () => {},
  reviewTags,
} = {}) {
  const asked = [],
    notified = [],
    calls = [];
  const call = (path, method = "GET", body) => {
    calls.push([path, method, data(body)]);
    return api(path, method, body);
  };
  const notifications = {
    notify: (message, tone) => notified.push([message, tone]),
  };
  const { ConnectionSettings } = loadSource(
    "components/ConnectionSettings.tsx",
    {
      modules: {
        "preact/hooks": hooks,
        "../ui": ui,
        "../i18n": i18n,
        "../settings-model": model,
        "../browser-storage": {
          readSessionPreference: () => "",
          writeSessionPreference() {},
        },
        "../api": { api: call },
        "../confirmation": {
          confirmDeletion: async (message) => (asked.push(message), answer),
          confirmDiscard: async () => true,
        },
        "../notifications": notifications,
        "./WebhookSettings": { WebhookSettings: "WebhookSettings" },
        "../instances": loadSource("instances.ts"),
        "./UnraidSettings": { UnraidSettings: "UnraidSettings" },
        "./MediaInfoSettings": { MediaInfoSettings: "MediaInfoSettings" },
        "./MuxToolSettings": { MuxToolSettings: "MuxToolSettings" },
        "../mux-spec": { defaultMuxSettings: () => ({}) },
        "./list/Segmented": { Segmented: "Segmented" },
        "./settings/ServiceCard": {
          ServiceCard: "ServiceCard",
          ServiceSection: "ServiceSection",
        },
        "./settings/ServiceStatus": {
          ServiceStatus: "ServiceStatus",
          StatusValue: "StatusValue",
        },
        "./ExternalTagStatus": {
          ExternalTagStatus: "ExternalTagStatus",
          ExternalTagCheck: "ExternalTagCheck",
          externalTagText: (state) => "Last tag check: " + state?.lastTagCheck,
        },
        "../hooks/useManualSync": loadSource("hooks/useManualSync.ts", {
          modules: {
            "preact/hooks": hooks,
            "../api": { api: call },
            "../i18n": i18n,
            "../notifications": notifications,
          },
        }),
      },
      browser: { document: { querySelector: () => null } },
      stubs: PRESENTATION_MODULES,
    },
  );
  const view = mount(ConnectionSettings, {
    cfg,
    setCfg(next) {
      view.props = {
        ...view.props,
        cfg: typeof next === "function" ? next(view.props.cfg) : next,
      };
    },
    settings,
    demo,
    hidden: false,
    tab,
    setTab() {},
    status,
    summary,
    refresh,
    reviewTags,
  });
  const card = () => one(view.render(), "ServiceCard");
  const sections = () => objects(card().props.children);
  const section = (title) =>
    sections().find(
      (s) => s.type === "ServiceSection" && s.props.title === title,
    );
  const values = () => one(section("Status"), "ServiceStatus").props.values;
  return { view, card, sections, section, values, asked, notified, calls };
}
const summaryOf = (...rows) => ({
  state: "ok",
  text: "",
  services: rows.map(([id, state, text, enabled = true]) => ({
    id,
    label: id,
    media: false,
    enabled,
    state,
    text,
  })),
});

test("library cards show their status first", () => {
  const radarr = {
    ...RADARR,
    tagImport: true,
    webhookEnabled: true,
    tagSync: { resolution: true },
  };
  const cfg = { instances: [radarr] };
  const status = {
    sync: { radarr: { count: 1234, lastSuccess: "2026-11-06T08:00:00Z" } },
    nextSync: { radarr: "2026-11-06T10:00:00Z" },
    webhook: {
      radarr: { lastSuccess: "2026-11-06T09:00:00Z", pending: 2, error: "" },
    },
    tagSync: {
      radarr: {
        lastTagCheck: "2026-11-06T09:30:00Z",
        lastSuccess: "2026-11-06T09:31:00Z",
        retainedDefinitions: 3,
        running: false,
        pending: false,
        error: "",
        changed: 0,
      },
    },
  };
  const page = services({
    cfg,
    status,
    summary: summaryOf(["radarr", "ok", "Last sync: D(2026-11-06T08:00:00Z)"]),
  });
  const card = page.card();
  // The head: the 40 tile, the name with its provider below (an own name),
  // the status tag from the sync summary, Test connection and Sync now, the
  // switch.
  assert.equal(card.props.id, "radarr");
  assert.equal(card.props.name, "Radarr HD");
  assert.equal(card.props.sub, "Radarr");
  assert.equal(ofType(card.props.icon, icons.Film).length, 1);
  assert.deepEqual(data(card.props.status), {
    tone: "ok",
    text: "Ready",
    long: "Last sync: D(2026-11-06T08:00:00Z)",
  });
  assert.deepEqual(
    ofType(card.props.actions, "button").map((b) => [
      text(b).trim(),
      b.props.class,
      b.props.type,
    ]),
    [
      ["Test connection", "v2-btn", "button"],
      ["Sync now", "v2-btn", "button"],
    ],
  );
  assert.equal(card.props.active.label, "Enable service");
  assert.equal(card.props.active.checked, true);
  assert.equal(card.props.active.disabled, false);
  // Sections in this order, the status first.
  assert.deepEqual(
    page.sections().map((s) => s.props.title ?? s.type),
    [
      "Status",
      "Connection",
      "External tags",
      "Tag synchronization to Radarr HD",
      "WebhookSettings",
    ],
  );
  const statusView = one(page.section("Status"), "ServiceStatus");
  assert.equal(statusView.props.kind, "arr");
  assert.deepEqual(
    [...model.statusRows(statusView.props.kind)],
    ["status", "files", "next", "webhook", "external", "tags"],
  );
  const values = page.values();
  // Status: the frame's sync line, literal; the tag and the line in one.
  const value = one(values.status, "StatusValue");
  assert.equal(value.props.view.long, "Last sync: D(2026-11-06T08:00:00Z)");
  assert.equal(value.props.view.text, "Ready");
  assert.equal(byClass(values.status, "v2-kv-long").length, 0);
  assert.equal(text(values.files), "#1234 files in cache");
  assert.equal(text(values.next), "D(2026-11-06T10:00:00Z)");
  // Every long value is one line: cut with an ellipsis, whole in its title
  // and for screen readers.
  const line = (value) => {
    assert.ok(
      nodes(value).some((n) => classes(n).includes("v2-kv-line")),
      "a line",
    );
    const cut = byClass(value, "v2-kv-long");
    assert.equal(cut.length, 1);
    assert.equal(cut[0].props.title, text(cut[0]));
    return text(cut[0]);
  };
  assert.equal(
    line(values.webhook),
    "Last webhook update: D(2026-11-06T09:00:00Z) · 2 pending",
  );
  assert.equal(line(values.external), "Last tag check: 2026-11-06T09:30:00Z");
  const tags = values.tags;
  assert.equal(
    text(byClass(tags, "v2-kv-long")[0]),
    "Last sync: D(2026-11-06T09:31:00Z) · 3 tag definitions retained because the service still uses them.",
  );
  // Review tag removals is always there, locked without an approval; the
  // line may put it below its text where the column is narrow (phones),
  // the text keeping its ellipsis.
  assert.deepEqual(classes(tags), ["v2-kv-line", "v2-kv-line--act"]);
  const review = button(tags, "Review tag removals");
  assert.equal(review.props.class, "v2-btn v2-btn--sm");
  assert.equal(review.props.type, "button");
  assert.equal(review.props.disabled, true);

  // An error: the error line and, as a second line, the last success.
  const failed = services({
    cfg,
    status: {
      sync: {
        radarr: {
          count: 1,
          error: "Unauthorized",
          lastSuccess: "2026-11-05T08:00:00Z",
        },
      },
    },
    summary: summaryOf(["radarr", "error", "Sync failed · Unauthorized"]),
  });
  const error = failed.values().status;
  assert.equal(one(error, "StatusValue").props.view.tone, "error");
  assert.equal(
    one(error, "StatusValue").props.view.long,
    "Sync failed · Unauthorized",
  );
  const second = byClass(error, "v2-kv-long");
  assert.equal(second.length, 1);
  assert.equal(
    text(second[0]),
    "Last successful sync: D(2026-11-05T08:00:00Z)",
  );
  assert.equal(second[0].props.title, text(second[0]));
  assert.equal(failed.card().props.status.tone, "error");

  // Off in the saved settings: Disabled.
  const off = services({
    cfg: { instances: [RADARR] },
    status: {},
    summary: summaryOf(["radarr", "off", "Last sync: Not synced yet"]),
  });
  const offValues = off.values();
  assert.equal(offValues.webhook, "Disabled");
  assert.equal(offValues.external, "Disabled");
  assert.equal(
    text(offValues.tags).replace("Review tag removals", ""),
    "Disabled",
  );
  assert.equal(
    button(offValues.tags, "Review tag removals").props.disabled,
    true,
  );
  assert.equal(
    byClass(offValues.tags, "v2-kv-long")[0].props.title,
    "Disabled",
  );
  assert.equal(offValues.files, undefined, "— without a sync");
  assert.equal(offValues.next, undefined, "— without a next sync");
  assert.equal(off.card().props.status.text, "Not synced yet");

  // Before the frame's status and summary: every value and the head "—";
  // the head keeps both actions.
  const pending = services({ cfg });
  assert.deepEqual(data(pending.card().props.status), {
    tone: "neutral",
    text: "—",
    long: "—",
  });
  for (const key of model.statusRows("arr"))
    assert.equal(pending.values()[key], undefined, key);
  assert.equal(ofType(pending.card().props.actions, "button").length, 2);
  // No 1.7.0 parts of the card.
  for (const gone of [
    "connection",
    "connection-heading",
    "card-heading",
    "connection-grid",
    "sync-clock-grid",
    "tag-integration-settings",
    "external-tag-settings",
    "outbound-tag-settings",
    "tag-group-options",
    "check-field",
    "quiet",
  ])
    assert.equal(byClass(page.card(), gone).length, 0, gone);
  // Switched off, the service leaves the tabs, as in 1.7.0.
  page.card().props.active.change(false);
  assert.equal(page.view.props.cfg.instances[0].enabled, false);
});

test("library cards keep every connection field and test", async () => {
  let reply;
  const sonarr = library("sonarr", "sonarr", { interval: 0 });
  const page = services({
    cfg: { instances: [RADARR, sonarr], syncTimezone: "" },
    api: (path) =>
      path === "test"
        ? new Promise((resolve) => (reply = resolve))
        : new Promise(() => {}),
  });
  const connection = page.section("Connection");
  // The fields of 1.7.0 by their names, in this order, in the form grid.
  const labels = ofType(connection, "label")
    .filter((n) => n.props.for)
    .map((n) => text(n));
  assert.deepEqual(labels, [
    "Optional service name",
    "Server address",
    "API key",
    "Synchronize",
    "Starting at",
  ]);
  assert.ok(byClass(connection, "v2-form").length >= 1);
  const name = field(connection, "Optional service name").control;
  assert.equal(name.props.class, "v2-input");
  assert.equal(name.props.placeholder, "Radarr");
  assert.equal(name.props.maxLength, 80);
  assert.equal(name.props.value, "Radarr HD");
  const url = field(connection, "Server address");
  assert.equal(url.control.props.type, "url");
  assert.equal(url.control.props.placeholder, "http://192.168.1.10:7878");
  assert.equal(url.hint, "URL subpaths are supported, for example /radarr.");
  const key = field(connection, "API key");
  assert.equal(key.control.props.type, "password");
  assert.equal(key.control.props.autoComplete, "off");
  assert.equal(key.control.props.placeholder, "Saved · leave empty to keep");
  assert.equal(key.hint, "In each service under Settings → General.");
  const interval = field(connection, "Synchronize").control;
  assert.equal(interval.type, "select");
  assert.equal(interval.props.class, "v2-select");
  assert.deepEqual(
    ofType(interval, "option").map((o) => [o.props.value, text(o)]),
    [
      [0, "Manual only"],
      [15, "Every 15 minutes"],
      [30, "Every 30 minutes"],
      [60, "Hourly"],
      [360, "Every 6 hours"],
      [1440, "Daily"],
    ],
  );
  const start = field(connection, "Starting at").control;
  assert.equal(start.props.placeholder, "HH:MM");
  assert.equal(start.props.pattern, "([01][0-9]|2[0-3]):[0-5][0-9]");
  assert.equal(start.props.disabled, false);
  // A start time without a timezone takes the browser's.
  start.props.onInput({ currentTarget: { value: "03:00" } });
  assert.equal(page.view.props.cfg.instances[0].syncStart, "03:00");
  assert.equal(
    page.view.props.cfg.syncTimezone,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  name.props.onInput({ currentTarget: { value: "Movies" } });
  assert.equal(page.view.props.cfg.instances[0].name, "Movies");
  // Delete saved API key on save asks first; no turns it back off.
  const remove = check(
    page.section("Connection"),
    "Delete saved API key on save",
  );
  assert.equal(remove.props.class, "v2-check");
  const input = { checked: true };
  await remove.props.onChange({ currentTarget: input });
  assert.deepEqual(page.asked, ["Delete the saved API key when saving?"]);
  const saved = page.view.props.cfg.instances[0];
  assert.equal(saved.clearKey, true);
  assert.equal(saved.enabled, false);
  assert.equal(saved.apiKey, "");
  // Test connection: the 1.7.0 request and notice, locked while it runs.
  const tested = services({
    cfg: { instances: [{ ...RADARR, apiKey: "secret" }] },
    api: (path) =>
      path === "test"
        ? new Promise((resolve) => (reply = resolve))
        : new Promise(() => {}),
  });
  const testButton = () =>
    button(tested.card().props.actions, "Test connection");
  const done = testButton().props.onClick();
  assert.equal(testButton().props.disabled, true);
  assert.equal(ofType(testButton(), icons.LoaderCircle).length, 1);
  reply({ version: "5.14.0" });
  await done;
  assert.deepEqual(tested.calls, [
    [
      "test",
      "POST",
      {
        service: "radarr",
        type: "radarr",
        url: "http://radarr:7878",
        apiKey: "secret",
      },
    ],
  ]);
  assert.deepEqual(tested.notified, [
    ["Connected · version 5.14.0", undefined],
  ]);
  assert.equal(testButton().props.disabled, false);
  // No to the question keeps the box clear.
  const kept = services({ cfg: { instances: [RADARR] }, answer: false });
  const box = { checked: true };
  await check(
    kept.section("Connection"),
    "Delete saved API key on save",
  ).props.onChange({ currentTarget: box });
  assert.equal(box.checked, false);
  assert.equal(kept.view.props.cfg.instances[0].clearKey, undefined);
  // Per type: Sonarr's address, an unsaved key, a manual interval locks the
  // start time.
  const other = services({
    cfg: { instances: [RADARR, sonarr] },
    tab: "sonarr",
  });
  const sonarrConnection = other.section("Connection");
  assert.equal(
    field(sonarrConnection, "Server address").control.props.placeholder,
    "http://192.168.1.10:8989",
  );
  assert.equal(
    field(sonarrConnection, "API key").control.props.placeholder,
    "Enter API key",
  );
  assert.equal(
    field(sonarrConnection, "Starting at").control.props.disabled,
    true,
  );
  assert.equal(other.card().props.sub, undefined, "no own name");
  assert.equal(other.card().props.name, "Sonarr");
  assert.equal(ofType(other.card().props.icon, icons.Tv).length, 1);
  // The demo locks every field, the switch and both actions.
  const demo = services({ cfg: { instances: [RADARR] }, demo: true });
  const locked = demo.card();
  assert.equal(locked.props.active.disabled, true);
  for (const action of ofType(locked.props.actions, "button"))
    assert.equal(action.props.disabled, true, text(action));
  for (const control of [
    ...ofType(demo.section("Connection"), "input"),
    ...ofType(demo.section("Connection"), "select"),
  ])
    assert.equal(control.props.disabled, true, control.props.id);
});

test("library cards keep external tags, outbound groups and webhooks", async () => {
  const page = services({
    cfg: { instances: [RADARR] },
    settings: { instances: [{ ...RADARR, tagImport: true }] },
    status: { tagSync: {} },
  });
  // External tags: import, the check interval and the 1.7.0 hint; the check
  // itself with its conflicts (ExternalTagCheck).
  const external = page.section("External tags");
  const importing = check(external, "Import external tags as custom tags");
  assert.equal(importing.props.checked, false);
  const every = field(external, "Tag check interval").control;
  assert.equal(every.props.class, "v2-select");
  assert.equal(every.props.disabled, true);
  assert.deepEqual(
    ofType(every, "option").map((o) => [o.props.value, text(o)]),
    [
      [0, "Manual only"],
      [5, "Every 5 minutes"],
      [15, "Every 15 minutes"],
      [30, "Every 30 minutes"],
      [-1, "With library sync"],
    ],
  );
  assert.match(text(external), /Local edits are checked immediately\./);
  const tagCheck = one(external, "ExternalTagCheck");
  assert.equal(tagCheck.props.service, "radarr");
  assert.equal(tagCheck.props.disabled, false);
  importing.props.onChange({ currentTarget: { checked: true } });
  let radarr = page.view.props.cfg.instances[0];
  assert.equal(radarr.tagImport, true);
  assert.equal(radarr.tagImportInterval, 5);
  field(
    page.section("External tags"),
    "Tag check interval",
  ).control.props.onChange({ currentTarget: { value: "-1" } });
  assert.equal(page.view.props.cfg.instances[0].tagImportInterval, -1);
  // Unsaved import: the check stays locked until the import is saved.
  const unsaved = services({ cfg: { instances: [RADARR] }, status: {} });
  assert.equal(
    one(unsaved.section("External tags"), "ExternalTagCheck").props.disabled,
    true,
  );
  // Tag synchronization to the service: the nine groups in the 1.7.0
  // order, each a v2 checkbox.
  const outbound = page.section("Tag synchronization to Radarr HD");
  const boxes = ofType(outbound, "label").filter((n) =>
    classes(n).includes("v2-ff-check"),
  );
  assert.deepEqual(
    boxes.map((b) => text(b).trim()),
    Object.values(GROUPS),
  );
  for (const box of boxes)
    assert.equal(one(box, "input").props.class, "v2-check");
  one(boxes[3], "input").props.onChange({ currentTarget: { checked: true } });
  assert.deepEqual(data(page.view.props.cfg.instances[0].tagSync), {
    hdr: true,
  });
  assert.match(
    text(outbound),
    /Disabled by default\. When saving changes, choose whether existing tags/,
  );
  assert.match(
    text(outbound),
    /Source includes processing tags such as Remux\./,
  );
  // Realtime updates: WebhookSettings with the saved switch.
  const webhook = page.sections().at(-1);
  assert.equal(webhook.type, "WebhookSettings");
  assert.equal(webhook.props.service, "radarr");
  assert.equal(webhook.props.savedEnabled, false);
  assert.equal(webhook.props.demo, false);
  webhook.props.changed({ webhookEnabled: true });
  assert.equal(page.view.props.cfg.instances[0].webhookEnabled, true);

  // WebhookSettings itself: a section of the card with its 1.7.0 controls.
  const calls = [];
  const { WebhookSettings } = loadSource("components/WebhookSettings.tsx", {
    modules: {
      "preact/hooks": hooks,
      "../ui": ui,
      "../i18n": i18n,
      "../api": {
        api: async (path, method) => {
          calls.push([path, method]);
          return {
            username: "scopearr",
            password: "pw",
            endpoint: "/api/webhook/radarr",
          };
        },
      },
      "./settings/ServiceCard": {
        ServiceCard: "ServiceCard",
        ServiceSection: "ServiceSection",
      },
    },
    browser: { location: { origin: "http://host:8686" } },
  });
  const changes = [];
  const hook = mount(WebhookSettings, {
    service: "radarr",
    config: { ...RADARR, webhookEnabled: true },
    changed: (patch) => changes.push(data(patch)),
    savedEnabled: true,
    demo: false,
  });
  let tree = hook.render();
  assert.equal(tree.type, "ServiceSection");
  assert.equal(tree.props.title, "Realtime updates");
  const enable = check(tree, "Enable webhook");
  assert.equal(enable.props.checked, true);
  enable.props.onChange({ currentTarget: { checked: false } });
  assert.deepEqual(changes, [{ webhookEnabled: false }]);
  assert.match(text(tree), /Imports, upgrades and file deletions refresh/);
  const show = button(tree, "Show webhook connection");
  assert.equal(show.props.class, "v2-btn v2-btn--sm");
  assert.equal(show.props.disabled, false);
  await show.props.onClick();
  tree = hook.render();
  assert.deepEqual(calls, [["webhook-credentials?service=radarr", "POST"]]);
  const hookUrl = field(tree, "Webhook URL").control;
  assert.equal(hookUrl.props.value, "http://host:8686/api/webhook/radarr");
  assert.equal(hookUrl.props.readOnly, true);
  assert.equal(hookUrl.props.class, "v2-input");
  assert.equal(field(tree, "Username").control.props.value, "scopearr");
  const password = field(tree, "Password").control;
  assert.equal(password.props.type, "password");
  assert.equal(password.props.readOnly, true);
  const reveal = nodes(tree).find((n) => classes(n).includes("v2-reveal"));
  assert.equal(reveal.props["aria-label"], "Show password");
  assert.equal(reveal.props["aria-pressed"], false);
  assert.equal(reveal.props["aria-controls"], password.props.id);
  reveal.props.onClick();
  tree = hook.render();
  assert.equal(field(tree, "Password").control.props.type, "text");
  const hide = nodes(tree).find((n) => classes(n).includes("v2-reveal"));
  assert.equal(hide.props["aria-label"], "Hide password");
  assert.equal(hide.props["aria-pressed"], true);
  assert.match(
    text(tree),
    /In Radarr \/ Sonarr: Settings → Connect → Webhook\./,
  );
  button(tree, "Hide credentials").props.onClick();
  tree = hook.render();
  assert.equal(button(tree, "Hide credentials"), undefined);
  assert.equal(
    nodes(tree).filter((n) => n.type === "input" && n.props.readOnly).length,
    0,
  );
  // Locked without a saved webhook and in the demo.
  for (const props of [{ savedEnabled: false }, { demo: true }]) {
    const locked = mount(WebhookSettings, { ...hook.props, ...props }).render();
    assert.equal(
      button(locked, "Show webhook connection").props.disabled,
      true,
    );
  }
  for (const gone of ["webhook-settings", "check-field", "quiet", "button"])
    assert.equal(byClass(tree, gone).length, 0, gone);
});

test("media server cards keep mappings and contributing libraries", () => {
  const emby = library("emby", "emby", {
    pathMappings: "/movies => /media/movies",
    sourceIds: "",
    tagSync: { audio: true },
  });
  const sonarr = library("sonarr", "sonarr", { enabled: false });
  const cfg = { instances: [RADARR, sonarr, emby] };
  const page = services({
    cfg,
    tab: "emby",
    status: { sync: { emby: { count: 42 } } },
    summary: summaryOf(["emby", "ok", "Last match: D(1)"]),
  });
  const card = page.card();
  assert.equal(card.props.name, "Emby");
  assert.equal(card.props.sub, undefined);
  assert.equal(ofType(card.props.icon, icons.Server).length, 1);
  // The head: Test connection and Match now.
  assert.deepEqual(
    ofType(card.props.actions, "button").map((b) => text(b).trim()),
    ["Test connection", "Match now"],
  );
  assert.deepEqual(
    page.sections().map((s) => s.props.title ?? s.type),
    [
      "Status",
      "Connection",
      "Contributing libraries",
      "Tag synchronization to Emby",
    ],
  );
  assert.equal(
    one(page.section("Status"), "ServiceStatus").props.kind,
    "media",
  );
  assert.deepEqual(Object.keys(page.values()), [
    "status",
    "files",
    "next",
    "tags",
  ]);
  assert.equal(text(page.values().files), "42 files matched");
  // Connection: the media server's description, its fields, the mappings
  // and the 1.7.0 hints; no interval of its own.
  const connection = page.section("Connection");
  assert.match(
    text(connection),
    /Adds existing video and audio stream metadata\. No scans or media access\./,
  );
  assert.deepEqual(
    ofType(connection, "label")
      .filter((n) => n.props.for)
      .map((n) => text(n)),
    [
      "Optional service name",
      "Server address",
      "API key",
      "Optional path mappings",
    ],
  );
  assert.equal(
    field(connection, "Server address").control.props.placeholder,
    "http://192.168.1.10:8096",
  );
  assert.equal(
    field(connection, "API key").hint,
    "Create a dedicated API key in the selected media server dashboard.",
  );
  const mappings = field(connection, "Optional path mappings");
  assert.equal(mappings.control.type, "textarea");
  assert.equal(mappings.control.props.class, "v2-textarea");
  assert.equal(
    mappings.control.props["aria-label"],
    "Media server path mappings",
  );
  assert.equal(mappings.control.props.placeholder, "/movies => /media/movies");
  assert.equal(mappings.control.props.value, "/movies => /media/movies");
  assert.match(
    mappings.hint,
    /^One line per media path: Arr path => media server path\./,
  );
  mappings.control.props.onInput({
    currentTarget: { value: "/tv => /media/tv" },
  });
  assert.equal(
    page.view.props.cfg.instances[2].pathMappings,
    "/tv => /media/tv",
  );
  assert.match(
    text(page.section("Connection")),
    /Synced with Radarr and Sonarr\. An error preserves the last complete cache\./,
  );
  assert.equal(ofType(connection, "select").length, 0);
  check(page.section("Connection"), "Delete saved API key on save");
  // Contributing libraries: all enabled, or the chosen ones.
  const sources = page.section("Contributing libraries");
  const all = check(sources, "All enabled libraries");
  assert.equal(all.props.checked, true);
  assert.equal(all.props.disabled, false);
  const choices = (tree) =>
    ofType(tree, "label")
      .filter((n) => classes(n).includes("v2-ff-check"))
      .map((n) => text(n).trim());
  assert.deepEqual(choices(sources), ["All enabled libraries", "Radarr HD"]);
  assert.equal(check(sources, "Radarr HD").props.disabled, true);
  all.props.onChange({ currentTarget: { checked: false } });
  assert.equal(page.view.props.cfg.instances[2].sourceIds, "radarr");
  assert.equal(
    check(page.section("Contributing libraries"), "Radarr HD").props.disabled,
    true,
    "the last library stays",
  );
  // A chosen library that is disabled keeps its place, marked.
  const chosen = services({
    cfg: {
      instances: [RADARR, sonarr, { ...emby, sourceIds: "radarr,sonarr" }],
    },
    tab: "emby",
  });
  const picked = chosen.section("Contributing libraries");
  assert.deepEqual(choices(picked), [
    "All enabled libraries",
    "Radarr HD",
    "Sonarr · Disabled",
  ]);
  check(picked, "Sonarr · Disabled").props.onChange({
    currentTarget: { checked: false },
  });
  assert.equal(chosen.view.props.cfg.instances[2].sourceIds, "radarr");
  assert.match(
    text(page.section("Contributing libraries")),
    /Choose which libraries contribute matching files and tags to this media server\./,
  );
  // The outbound groups with the media server's hint.
  assert.match(
    text(page.section("Tag synchronization to Emby")),
    /Tags are sent only to matched movies and individual episodes\./,
  );
});

test("sync now starts the instance sync from its card", async () => {
  let release;
  const refreshed = [];
  const page = services({
    cfg: { instances: [RADARR] },
    status: { sync: {} },
    api: (path) =>
      path === "sync"
        ? new Promise((resolve) => (release = resolve))
        : new Promise(() => {}),
    refresh: async () => refreshed.push(true),
  });
  const now = () => button(page.card().props.actions, "Sync now");
  assert.equal(now().props.disabled, false);
  const run = now().props.onClick();
  // Locked while the request is on its way, its icon turning.
  assert.equal(now().props.disabled, true);
  assert.equal(ofType(now(), icons.RefreshCw)[0].props.class, "v2-spin");
  release({});
  await run;
  await settle();
  assert.deepEqual(page.calls, [["sync", "POST", { service: "radarr" }]]);
  assert.equal(refreshed.length, 1);
  assert.deepEqual(page.notified, [
    [
      "Sync queued. Services run one at a time; you can keep filtering.",
      undefined,
    ],
  ]);
  assert.equal(now().props.disabled, false);
  // Locked while it syncs, for a service disabled in the saved settings
  // and in the demo.
  for (const options of [
    { status: { sync: { radarr: { running: true } } } },
    { settings: { instances: [{ ...RADARR, enabled: false }] } },
    { demo: true },
  ]) {
    const locked = services({
      cfg: { instances: [RADARR] },
      status: {},
      ...options,
    });
    assert.equal(
      button(locked.card().props.actions, "Sync now").props.disabled,
      true,
      JSON.stringify(options),
    );
  }
});

// The shape of a VNode tree, as goldens/ records it: every prop, an
// undefined one and a function by a marker.
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
          : value;
  }
  return {
    type,
    key: node.key ?? null,
    props,
    children: shape(node.props?.children),
  };
}

test("add service and the disabled services keep their dialog", () => {
  // The dialog body as recorded at the BASE of this task (goldens/): the
  // type, the media server, the name, Add service and the disabled
  // services with Enable service and Remove service.
  const golden = JSON.parse(
    readFileSync(
      new URL("./goldens/services-add-dialog-ff0d9c2.json", import.meta.url),
      "utf8",
    ),
  );
  const cfg = {
    instances: [
      library("radarr", "radarr"),
      library("sonarr", "sonarr", { enabled: false }),
      library("emby", "emby", {
        enabled: false,
        name: "Living room",
        tagSync: { hdr: true },
      }),
    ],
    mux: { enabled: false },
  };
  const page = services({ cfg });
  page.view.render();
  page.view.flush();
  const add = button(page.view.render(), "Add service");
  assert.equal(add.props.class, "v2-btn");
  add.props.onClick();
  const modal = () => one(page.view.render(), "Modal");
  assert.deepEqual(data(shape(modal())), golden.opened);
  one(modal(), "select").props.onChange({ currentTarget: { value: "media" } });
  assert.deepEqual(data(shape(modal())), golden.media);
});

test("tag policy and review dialogs still open from the services", async () => {
  // Review tag removals in the card hands its service to the page, which
  // opens the 1.7.0 review for it.
  const reviewed = [];
  const page = services({
    cfg: { instances: [{ ...RADARR, tagSync: { resolution: true } }] },
    status: {
      tagSync: {
        radarr: {
          approvalRequired: true,
          running: false,
          pending: false,
          error: "",
          changed: 0,
        },
      },
    },
    reviewTags: (service) => reviewed.push(service),
  });
  const review = button(page.values().tags, "Review tag removals");
  assert.equal(review.props.disabled, false);
  review.props.onClick();
  assert.deepEqual(reviewed, ["radarr"]);
  const settingsPage = squash(src("components/SettingsPage.tsx"));
  assert.match(
    settingsPage,
    /<ConnectionSettings cfg=\{cfg\} setCfg=\{setCfg\} settings=\{settings\} status=\{status\} summary=\{summary\} refresh=\{refresh\} reviewTags=\{setPendingReview\}/,
  );
  assert.match(
    settingsPage,
    /\{pendingReview && \( <TagReview requests=\{\[ \{ service: pendingReview,/,
  );
  assert.match(
    settingsPage,
    /\{tagChanges && \( <TagPolicyDialog changes=\{tagChanges\}/,
  );
  // A changed tag group in the card asks the tag policy when saving: the
  // card's draft through the real settings draft.
  const saved = { instances: [RADARR], tagColors: {}, pageSize: 25 };
  const runtime = createHookRuntime();
  const window = { addEventListener() {}, removeEventListener() {} };
  const { useSettingsDraft } = loadSource("hooks/useSettingsDraft.ts", {
    browser: { window, structuredClone },
    modules: {
      "preact/hooks": runtime.hooks,
      "../api": {
        api: async () => {
          throw new Error("no request expected");
        },
      },
      "../browser-storage": { writeSessionPreference() {} },
      "../confirmation": { confirmDiscard: async () => true },
      "../i18n": {
        t: (key) => key,
        useI18n: () => ({ locale: "en", setLocale: async () => {} }),
      },
      "../instances": loadSource("instances.ts"),
      "../list-prefs": loadSource("list-prefs.ts", {
        modules: {
          "./browser-storage": loadSource("browser-storage.ts", {
            browser: { localStorage: { getItem: () => null, setItem() {} } },
          }),
        },
        browser: { window, Event },
      }),
      "../notifications": { notify() {} },
      "../settings-payload": loadSource("settings-payload.ts"),
      "../tag-policy": loadSource("tag-policy.ts"),
      "./useListPrefs": loadSource("hooks/useListPrefs.ts", {
        modules: {
          "preact/hooks": runtime.hooks,
          "../list-prefs": loadSource("list-prefs.ts", {
            modules: {
              "./browser-storage": loadSource("browser-storage.ts", {
                browser: {
                  localStorage: { getItem: () => null, setItem() {} },
                },
              }),
            },
            browser: { window, Event },
          }),
        },
        browser: { window },
      }),
    },
  });
  const args = {
    settings: saved,
    section: "connections",
    onDirty() {},
    saved: async () => {},
  };
  let draft = runtime.render(() => useSettingsDraft(args));
  runtime.flush();
  const card = services({ cfg: draft.cfg, settings: saved });
  card.view.props.setCfg = (next) => {
    draft.setCfg(next);
    draft = runtime.render(() => useSettingsDraft(args));
    runtime.flush();
    card.view.props = { ...card.view.props, cfg: draft.cfg };
  };
  const groups = ofType(
    card.section("Tag synchronization to Radarr HD"),
    "input",
  );
  groups[0].props.onChange({ currentTarget: { checked: true } });
  assert.equal(draft.dirty, true);
  await draft.submit({ preventDefault() {} });
  draft = runtime.render(() => useSettingsDraft(args));
  assert.deepEqual(
    data(draft.tagChanges).map((change) => change.service),
    ["radarr"],
  );
});

test("external tag checks keep check now and both conflict actions", async () => {
  const calls = [],
    asked = [],
    notified = [];
  const tagStatus = loadSource("components/ExternalTagStatus.tsx", {
    modules: {
      "preact/hooks": hooks,
      "../ui": ui,
      "../i18n": i18n,
      "../api": {
        api: async (path, method, body) => {
          calls.push([path, method, data(body)]);
        },
      },
      "../notifications": { notify: (message) => notified.push(message) },
      "../confirmation": {
        confirmDeletion: async (message) => (asked.push(message), true),
      },
    },
  });
  // The status value: the last check and the pending edits as one line.
  assert.equal(
    tagStatus.externalTagText({ lastTagCheck: "x" }, t),
    "Last tag check: D(x)",
  );
  assert.equal(
    tagStatus.externalTagText({ lastTagCheck: "x", importPending: 2 }, t),
    "Last tag check: D(x) · 2 pending external edits. Sending edits requires outbound Custom tag synchronization.",
  );
  const conflict = (label, desired) => ({
    service: "radarr",
    mediaId: 7,
    remoteId: label === "hdr" ? 3 : 4,
    label,
    desired,
  });
  const status = {
    tagSync: {
      radarr: {
        running: false,
        importConflicts: [conflict("hdr", false), conflict("4k", true)],
      },
    },
  };
  const view = mount(tagStatus.ExternalTagCheck, {
    service: "radarr",
    status,
    disabled: false,
  });
  let tree = view.render();
  const now = button(tree, "Check tags now");
  assert.equal(now.props.class, "v2-btn v2-btn--sm");
  assert.equal(now.props.disabled, false);
  await now.props.onClick();
  await settle();
  assert.deepEqual(calls.at(-1), ["tag-import", "POST", { service: "radarr" }]);
  assert.deepEqual(notified, ["Tag check queued."]);
  tree = view.render();
  const notices = byClass(tree, "v2-notice");
  assert.equal(notices.length, 2);
  for (const notice of notices)
    assert.ok(classes(notice).includes("v2-notice--warn"));
  assert.match(text(notices[0]), /^Tag conflict: hdr · entry 7/);
  // Keep local change asks before a pending removal, then sends it.
  await button(notices[0], "Keep local change").props.onClick();
  await settle();
  assert.deepEqual(asked, ["Apply the pending removal of hdr in the service?"]);
  assert.deepEqual(calls.at(-1), [
    "tag-import",
    "POST",
    { service: "radarr", mediaId: 7, remoteId: 3, resolution: "local" },
  ]);
  await button(notices[1], "Keep local change").props.onClick();
  await settle();
  assert.equal(asked.length, 1, "a desired tag asks nothing");
  const second = byClass(view.render(), "v2-notice")[1];
  await button(second, "Use service state").props.onClick();
  await settle();
  assert.deepEqual(calls.at(-1), [
    "tag-import",
    "POST",
    { service: "radarr", mediaId: 7, remoteId: 4, resolution: "remote" },
  ]);
  for (const b of ofType(view.render(), "button"))
    assert.equal(b.props.class, "v2-btn v2-btn--sm", text(b));
  // Locked while disabled or while a check runs.
  for (const props of [
    { disabled: true },
    { status: { tagSync: { radarr: { running: true } } } },
  ])
    assert.equal(
      button(
        mount(tagStatus.ExternalTagCheck, { ...view.props, ...props }).render(),
        "Check tags now",
      ).props.disabled,
      true,
    );
  // System → Info keeps the 1.7.0 block until it is rebuilt.
  const legacy = mount(tagStatus.ExternalTagStatus, view.props).render();
  assert.equal(legacy.props.class, "tag-sync-status");
  assert.equal(byClass(legacy, "external-tag-conflict").length, 2);
});

test("every service tab's dot follows its real status tone", async () => {
  const emby = library("emby", "emby");
  const sonarr = library("sonarr", "sonarr");
  const cfg = {
    instances: [RADARR, sonarr, emby],
    mux: { enabled: true },
    mediaInfo: { enabled: true },
    unraid: { enabled: true },
  };
  const page = services({
    cfg,
    tab: "mux",
    status: {},
    summary: summaryOf(
      ["radarr", "error", "Sync failed · x"],
      ["sonarr", "running", "Sync in progress …"],
      ["emby", "ok", "Last match: D(1)"],
    ),
    api: async (path) =>
      path === "mux/tool"
        ? { installed: true }
        : path === "mediainfo/tool"
          ? { installed: false }
          : new Promise(() => {}),
  });
  const dots = () =>
    Object.fromEntries(
      one(page.view.render(), "Segmented").props.items.map((item) => [
        item.value,
        item.dot,
      ]),
    );
  page.view.render();
  page.view.flush();
  await settle();
  // Libraries and media servers from their status; the tools from their
  // check until their card reports; Unraid neutral until its card read.
  assert.deepEqual(dots(), {
    emby: "ok",
    mediainfo: "neutral",
    mux: "ok",
    radarr: "error",
    sonarr: "running",
    unraid: "neutral",
  });
  // The open MKVToolNix card reports its polled head.
  const mux = one(page.view.render(), "MuxToolSettings");
  mux.props.report({ tone: "running", text: "Working…", long: "Working…" });
  assert.equal(dots().mux, "running");
  // Unraid's card reports its own read; MediaInfo's its polled head.
  page.view.props = { ...page.view.props, tab: "unraid" };
  one(page.view.render(), "UnraidSettings").props.report({
    tone: "error",
    text: "Error",
    long: "Disk root missing",
  });
  page.view.props = { ...page.view.props, tab: "mediainfo" };
  one(page.view.render(), "MediaInfoSettings").props.report({
    tone: "error",
    text: "Error",
    long: "Download failed",
  });
  assert.deepEqual(dots(), {
    emby: "ok",
    mediainfo: "error",
    mux: "running",
    radarr: "error",
    sonarr: "running",
    unraid: "error",
  });
  // A tab is named by its label alone.
  assert.deepEqual(
    data(
      one(page.view.render(), "Segmented").props.items.map(
        (item) => item.label,
      ),
    ),
    ["Emby", "MediaInfo", "MKVToolNix", "Radarr HD", "Sonarr", "Unraid"],
  );

  // The cards report their heads: MKVToolNix and MediaInfo the polled one
  // of their tool section, Unraid the one of its single read.
  const component = (path, modules, browser = {}) =>
    loadSource(path, {
      modules: {
        "preact/hooks": hooks,
        "../ui": ui,
        "../i18n": i18n,
        "../settings-model": model,
        ...modules,
      },
      browser,
      stubs: PRESENTATION_MODULES,
    });
  const blocks = {
    "./settings/ServiceCard": {
      ServiceCard: "ServiceCard",
      ServiceSection: "ServiceSection",
    },
    "./ToolPackageCard": { ToolPackageCard: "ToolPackageCard" },
    "./PathMappingsCard": { PathMappingsCard: "PathMappingsCard" },
  };
  const reported = [];
  const { MuxToolSettings } = component("components/MuxToolSettings.tsx", {
    ...blocks,
    "../mux-spec": { defaultMuxSettings: () => ({ enabled: true }) },
    "../confirmation": { confirmDeletion: async () => true },
  });
  const muxCard = mount(MuxToolSettings, {
    cfg: {},
    change() {},
    demo: false,
    report: (head) => reported.push(["mux", data(head)]),
  });
  one(muxCard.render(), "ToolPackageCard").props.head({
    tone: "ok",
    text: "Installed",
    long: "Installed",
  });
  assert.equal(
    one(muxCard.render(), "ServiceCard").props.status.text,
    "Installed",
  );
  const { MediaInfoSettings } = component(
    "components/MediaInfoSettings.tsx",
    blocks,
  );
  const infoCard = mount(MediaInfoSettings, {
    cfg: {},
    change() {},
    changeMux() {},
    demo: false,
    report: (head) => reported.push(["mediainfo", data(head)]),
  });
  one(infoCard.render(), "ToolPackageCard").props.head({
    tone: "neutral",
    text: "Not installed",
    long: "Not installed",
  });
  let answer;
  const reads = [];
  const { UnraidSettings } = component(
    "components/UnraidSettings.tsx",
    {
      "./FileCheckNamesDialog": {
        FileCheckNamesDialog: "FileCheckNamesDialog",
      },
      "../filecheck": { defaultFileCheckSettings: { allowed: [], ignore: [] } },
      "../placement-messages": { placementMessage: () => "" },
      "../api": {
        api: (path) => {
          reads.push(path);
          return path === "unraid/status"
            ? new Promise((resolve) => (answer = resolve))
            : new Promise(() => {});
        },
      },
      "../placement": { defaultUnraidSettings: { enabled: true } },
      "./MuxPathDialog": { PathCheckRow: "PathCheckRow" },
      "./UnraidShares": { UnraidShares: "UnraidShares" },
      "./settings/ServiceCard": blocks["./settings/ServiceCard"],
      "./settings/ServiceStatus": {
        ServiceStatus: "ServiceStatus",
        StatusValue: "StatusValue",
      },
    },
    { AbortController },
  );
  const unraid = mount(UnraidSettings, {
    cfg: { unraid: { enabled: true } },
    demo: false,
    change() {},
    changeFileCheck() {},
    report: (head) => reported.push(["unraid", data(head)]),
  });
  unraid.render();
  unraid.flush();
  answer({
    enabled: true,
    ready: false,
    error: "Disk root missing",
    disks: [],
  });
  await settle();
  unraid.render();
  unraid.flush();
  assert.deepEqual(reported, [
    ["mux", { tone: "ok", text: "Installed", long: "Installed" }],
    [
      "mediainfo",
      { tone: "neutral", text: "Not installed", long: "Not installed" },
    ],
    ["unraid", { tone: "neutral", text: "—", long: "—" }],
    ["unraid", { tone: "error", text: "Error", long: "Disk root missing" }],
  ]);
  assert.equal(
    reads.filter((path) => path === "unraid/status").length,
    1,
    "no second read for the dot",
  );
});
