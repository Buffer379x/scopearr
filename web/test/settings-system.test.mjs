import test from "node:test";
import assert from "node:assert/strict";
import {
  loadSource,
  nodes,
  PRESENTATION_MODULES,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { squash, src } from "./helpers/sources.mjs";
import { Fragment } from "preact";

// The sort adapter lives with the real SortHeader; the header itself is a
// stub in these tests.
const { asFilmSort } = loadSource("components/list/SortHeader.tsx", {
  modules: {
    "preact/hooks": {},
    "../../i18n": {},
    "../../ui": {},
    "../frame/Popover": {},
  },
});

// Settings → System on the v2 blocks (Phase 5c, task 9, R5): the band
// with the segment Info / Log (SettingsHeader, no Save settings); Info as
// three cards (Version, Back up cache, Change password) and the card
// Service sync status with one inset block per service (its status from
// the texts its Services card shows, Sync now or Match now, the external
// tag check); the log as a TableCard with the filter bar, the drawer (a
// chunk of its own), the chips row with its tools, placeholder rows until
// the first answer and the pager. Components run as real code with the
// hook runtime; the blocks they place are named stubs, so a tree shows
// what each one receives.

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const f = () => {};
const tick = () => new Promise((resolve) => setImmediate(resolve));
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
const kids = (node) =>
  []
    .concat(node?.props?.children ?? [])
    .flat(Infinity)
    .filter(Boolean)
    .flatMap((child) => (child.type === Fragment ? kids(child) : [child]));
const named = (tree, label) =>
  nodes(tree).filter((n) => n.props?.["aria-label"] === label);
const button = (tree, label) => {
  const found = nodes(tree).filter(
    (n) =>
      (n.type === "button" || n.type === "a") &&
      (n.props["aria-label"] === label || text(n).trim() === label),
  );
  assert.equal(found.length, 1, "one button " + label);
  return found[0];
};
const card = (tree, id) =>
  nodes(tree).find(
    (n) => n.type === "section" && n.props["aria-labelledby"] === id + "-title",
  );

let current = createHookRuntime();
const hooks = new Proxy(
  {},
  {
    get: (_, name) =>
      name === "useId" ? () => "settings-form" : current.hooks[name],
  },
);
function mount(component, props) {
  const runtime = createHookRuntime();
  const view = {
    runtime,
    props,
    render() {
      current = runtime;
      return runtime.settle(() => component(view.props));
    },
  };
  return view;
}

const eventLog = loadSource("event-log.ts");
const themes = loadSource("themes.ts");
const model = loadSource("settings-model.ts", {
  modules: { "./themes": themes, "./event-log": eventLog },
});
const instances = loadSource("instances.ts");
const i18n = { t, useI18n: () => ({ locale: "en" }) };
const date = (value) => (value ? "D(" + value + ")" : "Not synced yet");
const ui = { ICON: { button: 16, label: 15, empty: 28 }, count: String, date };
const cardBlock = loadSource("components/settings/Card.tsx");

// --- System → Info ----------------------------------------------------------

const RADARR = {
  id: "radarr",
  type: "radarr",
  name: "",
  enabled: true,
  url: "http://radarr:7878",
  hasKey: true,
  interval: 60,
  tagImport: true,
  webhookEnabled: true,
  tagSync: { resolution: true },
};
const EMBY = {
  id: "emby",
  type: "emby",
  name: "Living room",
  enabled: true,
  url: "http://emby:8096",
  hasKey: true,
  interval: 60,
};
const SONARR = { ...RADARR, id: "sonarr", type: "sonarr", enabled: false };
const STATUS = {
  version: "2.0.0",
  releaseCheck: { successAt: "x", updateAvailable: false, error: "" },
  sync: {
    radarr: { count: 12, lastSuccess: "a", error: "" },
    emby: { count: 4, lastSuccess: "b", error: "", running: true },
  },
  nextSync: { radarr: "n" },
  webhook: { radarr: { lastSuccess: "w", pending: 2, error: "" } },
  tagSync: {
    radarr: {
      running: false,
      pending: false,
      error: "",
      lastSuccess: "s",
      changed: 0,
      lastTagCheck: "c",
      approvalRequired: true,
    },
  },
};
const SUMMARY = {
  state: "ok",
  text: "",
  services: [
    { id: "emby", enabled: true, state: "running", text: "Matching …" },
    { id: "radarr", enabled: true, state: "ok", text: "Last sync: D(a)" },
  ],
};

function info(props = {}) {
  const calls = [];
  const libraryStatus = loadSource("components/settings/LibraryStatus.tsx", {
    modules: {
      "../../i18n": i18n,
      "./ServiceStatus": { StatusValue: "StatusValue" },
      "../ExternalTagStatus": {
        externalTagText: (state) =>
          "Last tag check: " + date(state?.lastTagCheck),
      },
    },
  });
  const { SystemInfo } = loadSource("components/SystemInfo.tsx", {
    modules: {
      "../i18n": i18n,
      "../instances": instances,
      "../settings-model": model,
      "../ui": ui,
      "./ExternalTagStatus": { ExternalTagCheck: "ExternalTagCheck" },
      "./settings/Card": cardBlock,
      "./settings/LibraryStatus": libraryStatus,
      "./settings/ServiceStatus": { ServiceStatus: "ServiceStatus" },
    },
    stubs: PRESENTATION_MODULES,
  });
  const all = {
    status: STATUS,
    settings: { instances: [RADARR, SONARR, EMBY] },
    summary: SUMMARY,
    demo: false,
    syncing: {},
    manualSync: async (service) => calls.push(["sync", service]),
    backup: async () => calls.push(["backup"]),
    reviewTags: (service) => calls.push(["review", service]),
    password: { type: "PasswordCard", props: {} },
    ...props,
  };
  return { calls, tree: SystemInfo(all) };
}

test("system info keeps version, backup, password and every service status", async () => {
  const { calls, tree } = info();
  // Three cards side by side, then Service sync status.
  const grid = byClass(tree, "v2-set-grid--3")[0];
  assert.deepEqual(classes(grid), ["v2-set-grid", "v2-set-grid--3"]);
  const top = kids(grid);
  assert.deepEqual(data(top.map((n) => n.props["aria-labelledby"] ?? n.type)), [
    "system-version-title",
    "system-backup-title",
    "PasswordCard",
  ]);
  for (const section of top.slice(0, 2))
    assert.deepEqual(classes(section), ["v2-card", "v2-set-card"]);
  // Version: the installed version and the release check, one status line.
  const version = card(tree, "system-version");
  assert.equal(text(ofType(version, "h2")[0]), "Version");
  const rows = one(version, "KeyValues").props.rows;
  assert.deepEqual(data(rows.map((row) => [row.key, row.label])), [
    ["version", "Installed version"],
  ]);
  assert.equal(rows[0].value, "2.0.0");
  // The release check: a line of its own below (its tag never wraps, so
  // it takes the card's width; a key-value cell overflowed at 320).
  const line = (tree) =>
    ofType(card(tree, "system-version"), "p").find(
      (p) => p.props.role === "status",
    );
  const release = (status) =>
    one(line(info({ status }).tree), "StatusTag").props.view;
  assert.equal(line(tree).props.role, "status");
  assert.equal(kids(card(tree, "system-version")).at(-1), line(tree));
  assert.deepEqual(data(release(STATUS)), {
    tone: "ok",
    text: "Version is up to date",
    long: "Version is up to date",
  });
  assert.deepEqual(
    data(
      release({
        ...STATUS,
        releaseCheck: {
          successAt: "x",
          updateAvailable: true,
          latest: "2.1.0",
        },
      }),
    ),
    {
      tone: "info",
      text: "New version 2.1.0 available",
      long: "New version 2.1.0 available",
    },
  );
  assert.equal(
    release({ ...STATUS, releaseCheck: undefined }).text,
    "Checking for a new version …",
  );
  assert.equal(ofType(version, "small").length, 0);
  const failed = card(
    info({
      status: { ...STATUS, releaseCheck: { error: "GitHub is unreachable" } },
    }).tree,
    "system-version",
  );
  assert.equal(text(one(failed, "small")), "GitHub is unreachable");
  // Back up cache: its text, then the button in its body.
  const backup = card(tree, "system-backup");
  assert.match(text(ofType(backup, "p")[0]), /^Back up cache and settings\./);
  const press = button(backup, "Back up cache");
  assert.deepEqual(classes(press), ["v2-btn"]);
  press.props.onClick();
  await tick();
  assert.deepEqual(calls, [["backup"]]);

  // Service sync status: its hint and one inset block per enabled service.
  const services = card(tree, "system-services");
  assert.equal(text(ofType(services, "h2")[0]), "Service sync status");
  assert.equal(
    text(ofType(services, "p")[0]),
    "Service status reflects the last sync, not a live connection test.",
  );
  const blocks = ofType(services, "section").filter((n) =>
    classes(n).includes("v2-card--inset"),
  );
  assert.deepEqual(
    blocks.map((n) => [n.props["aria-labelledby"], text(ofType(n, "h3")[0])]),
    [
      ["system-service-radarr-title", "Radarr"],
      ["system-service-emby-title", "Living room"],
    ],
  );
  const [radarr, emby] = blocks;
  const sync = (block) =>
    ofType(block, "button").find((b) => b.props.class === "v2-btn");
  assert.equal(text(sync(radarr)).trim(), "Sync now");
  assert.equal(text(sync(emby)).trim(), "Match now");
  assert.equal(sync(radarr).props.disabled, false);
  assert.equal(sync(emby).props.disabled, true, "locked while it runs");
  // Its icon turns while the sync runs.
  assert.ok(
    nodes(sync(emby)).some((n) => n.props?.class === "v2-spin"),
    "the spinning icon",
  );
  assert.ok(nodes(sync(radarr)).every((n) => n.props?.class !== "v2-spin"));
  sync(radarr).props.onClick();
  assert.deepEqual(calls.at(-1), ["sync", "radarr"]);
  // Locked as in 1.7.0: in the demo and while a manual sync runs.
  for (const props of [{ demo: true }, { syncing: { radarr: true } }]) {
    const locked = ofType(info(props).tree, "section").find(
      (n) => n.props["aria-labelledby"] === "system-service-radarr-title",
    );
    assert.equal(sync(locked).props.disabled, true, JSON.stringify(props));
  }
  // The status rows of its kind, the texts of its Services card.
  const status = one(radarr, "ServiceStatus").props;
  // While a sync or a tag sync runs, a hidden status says so (fix round
  // 1, M5: 1.7.0 had a progress bar each); idle, it is there and empty.
  const progress = (block) =>
    byClass(block, "v2-sr-only").map((n) => [n.props.role, text(n)]);
  assert.deepEqual(data(progress(radarr)), [["status", ""]]);
  assert.deepEqual(data(progress(emby)), [["status", "Sync in progress …"]]);
  const tagRun = ofType(
    info({
      status: {
        ...STATUS,
        tagSync: { radarr: { ...STATUS.tagSync.radarr, running: true } },
      },
    }).tree,
    "section",
  ).find((n) => n.props["aria-labelledby"] === "system-service-radarr-title");
  assert.deepEqual(data(progress(tagRun)), [
    ["status", "Tag synchronization in progress …"],
  ]);
  assert.equal(status.kind, "arr");
  assert.equal(one(emby, "ServiceStatus").props.kind, "media");
  const head = one(status.values.status, "StatusValue").props.view;
  assert.deepEqual(data(head), {
    tone: "ok",
    text: "Ready",
    long: "Last sync: D(a)",
  });
  assert.equal(status.values.files, "12 files in cache");
  assert.equal(status.values.next, "D(n)");
  assert.equal(
    text(status.values.webhook),
    "Last webhook update: D(w) · 2 pending",
  );
  assert.equal(text(status.values.external), "Last tag check: D(c)");
  assert.equal(
    text(status.values.tags).replace("Review tag removals", ""),
    "Last sync: D(s)",
  );
  const embyValues = one(emby, "ServiceStatus").props.values;
  assert.equal(embyValues.files, "4 files matched");
  assert.equal(
    one(embyValues.status, "StatusValue").props.view.text,
    "Running",
  );
  assert.equal("webhook" in embyValues, false);
  // Review tag removals hands its service to the page; locked without an
  // approval to give.
  const review = button(status.values.tags, "Review tag removals");
  assert.equal(review.props.disabled, false);
  review.props.onClick();
  assert.deepEqual(calls.at(-1), ["review", "radarr"]);
  assert.equal(
    button(embyValues.tags, "Review tag removals").props.disabled,
    true,
  );
  // The external tag check (Check tags now and the conflicts) with
  // external tags only, locked in the demo.
  assert.deepEqual(data(one(radarr, "ExternalTagCheck").props), {
    service: "radarr",
    status: data(STATUS),
    disabled: false,
  });
  assert.equal(ofType(emby, "ExternalTagCheck").length, 0);
  const demoBlock = ofType(info({ demo: true }).tree, "ExternalTagCheck");
  assert.equal(demoBlock[0].props.disabled, true);
  // No 1.7.0 parts.
  const code = squash(src("components/SystemInfo.tsx"));
  assert.doesNotMatch(
    code,
    /CardHeading|<ExternalTagStatus|class="(?:settings-card|system-|key-values|quiet|button|release-check)/,
  );
  assert.doesNotMatch(
    src("components/ExternalTagStatus.tsx"),
    /ExternalTagStatus\(|tag-sync-status/,
  );
});

test("system info keeps the toast, the panel and the password dialog", async () => {
  // SystemSettingsInfo: the Info panel in the settings form, the backup's
  // request and toast, the manual sync of useManualSync.
  const calls = [];
  const { SystemSettingsInfo } = loadSource("components/SystemSettings.tsx", {
    modules: {
      "preact/hooks": hooks,
      "../api": { api: async (path, method) => calls.push([path, method]) },
      "../browser-storage": {
        readSessionPreference: () => "",
        writeSessionPreference: f,
      },
      "../event-log": eventLog,
      "../i18n": i18n,
      "../notifications": {
        notify: (message) => calls.push(["notify", message]),
      },
      "../hooks/useManualSync": {
        useManualSync: () => ({ syncing: { radarr: true }, sync: "sync" }),
      },
      "./EventLogViewer": { EventLogViewer: "EventLogViewer" },
      "./PasswordCard": { PasswordCard: "PasswordCard" },
      "./SystemInfo": { SystemInfo: "SystemInfo" },
    },
  });
  const panel = mount(SystemSettingsInfo, {
    active: true,
    status: STATUS,
    settings: {},
    summary: SUMMARY,
    demo: true,
    refresh: async () => {},
    reviewTags: f,
  }).render();
  assert.deepEqual(
    [panel.props.id, panel.props.role, panel.props["aria-labelledby"]],
    ["system-panel-info", "tabpanel", "system-tab-info"],
  );
  assert.equal(panel.props.hidden, false);
  assert.equal(
    ofType(panel, "SegmentedTabs").length,
    0,
    "the segment is on the band",
  );
  const infoProps = one(panel, "SystemInfo").props;
  assert.deepEqual(data(infoProps.syncing), { radarr: true });
  assert.equal(infoProps.manualSync, "sync");
  assert.equal(infoProps.password.type, "PasswordCard");
  assert.equal(infoProps.password.props.demo, true);
  await infoProps.backup();
  assert.deepEqual(calls, [
    ["backup", "POST"],
    ["notify", "Consistent backup created in the Appdata directory."],
  ]);
  const hidden = mount(SystemSettingsInfo, {
    active: false,
    status: STATUS,
    settings: {},
    summary: SUMMARY,
    demo: false,
    refresh: async () => {},
    reviewTags: f,
  }).render();
  assert.equal(hidden.props.hidden, true);

  // Change password: a v2 card, its text and the button in its body; the
  // 1.7.0 dialog opens from it (Phase 5d).
  const { PasswordCard } = loadSource("components/PasswordCard.tsx", {
    modules: {
      "preact/hooks": hooks,
      "../i18n": i18n,
      "../ui": ui,
      "./settings/Card": cardBlock,
    },
    stubs: PRESENTATION_MODULES,
  });
  const view = mount(PasswordCard, { demo: true });
  let tree = view.render();
  assert.equal(tree.props["aria-labelledby"], "system-password-title");
  assert.deepEqual(classes(tree), ["v2-card", "v2-set-card"]);
  assert.equal(text(ofType(tree, "h2")[0]), "Change password");
  assert.equal(
    text(ofType(tree, "p")[0]),
    "Changing the password signs out every session.",
  );
  const open = button(tree, "Change password");
  assert.deepEqual(classes(open), ["v2-btn"]);
  assert.equal(open.props["aria-haspopup"], "dialog");
  assert.equal(ofType(tree, "PasswordDialog").length, 0);
  open.props.onClick();
  tree = view.render();
  // The v2 dialog (its fields, the external form and the demo lock:
  // settings-dialogs.test.mjs) gets the demo and closes.
  const dialog = one(tree, "PasswordDialog");
  assert.equal(dialog.props.demo, true, "locked in the demo");
  dialog.props.close();
  assert.equal(ofType(view.render(), "PasswordDialog").length, 0);
});

// --- System → Log -----------------------------------------------------------

const EVENTS = [
  {
    id: 3,
    ts: Date.UTC(2026, 10, 6, 9, 30),
    level: "error",
    source: "sync",
    instance: "radarr",
    message: "Sync failed",
    params: {},
    subject: "Radarr",
    detail: "timeout",
    repeat: 4,
  },
  {
    id: 2,
    ts: Date.UTC(2026, 10, 6, 9, 0),
    level: "info",
    source: "system",
    instance: "",
    message: "Scopearr started",
    params: {},
    subject: "",
    detail: "",
    repeat: 1,
  },
];
const PAGE = {
  events: EVENTS,
  total: 60,
  counts: {
    level: { error: 1, info: 59 },
    source: { sync: 1, system: 59 },
    instance: { radarr: 1 },
  },
};

// One module for every log of this file, as in the app: the rows it
// reserves until an answer are the last answer's, across visits. Its
// boundaries reach the log that renders or loads (active).
let active, viewerModule;
const viewer = () =>
  (viewerModule ??= loadSource("components/EventLogViewer.tsx", {
    browser: {
      setTimeout(run, ms) {
        active.timers.set(++active.timer, { at: active.clock + ms, run });
        return active.timer;
      },
      clearTimeout: (id) => active.timers.delete(id),
      window: {
        location: {
          set href(value) {
            active.state.href = value;
          },
        },
      },
    },
    modules: {
      "preact/hooks": hooks,
      "../hooks/usePolling": {
        usePolling: (load, interval, [request]) =>
          active.state.polls.push({ load, interval: interval(), request }),
      },
      "../api": {
        api: async (path, method = "GET") => {
          const { state, answer } = active;
          state.api.push([method, path]);
          if (method === "GET") return structuredClone(answer);
          return {};
        },
      },
      "../confirmation": {
        confirmDeletion: async (message) => (
          active.state.confirms.push(message),
          true
        ),
      },
      "../event-log": eventLog,
      "../hooks/useDrawerAnchor": {
        useDrawerAnchor: (anchor) => active.state.anchors.push(anchor),
      },
      "../hooks/useLazyChunk": {
        chunkRetry: () => ({ failed: () => null, fresh: () => null }),
        lazyChunk: () => "drawer chunk",
        useLazyChunk: (chunk, open, close) => {
          assert.equal(chunk, "drawer chunk");
          active.state.closer = close;
          return open ? "LogFilterDrawer" : null;
        },
      },
      "../i18n": i18n,
      "../notifications": {
        notify: (message) => active.state.notes.push(message),
      },
      "../settings-model": model,
      "../ui": ui,
      "./Modal": { Modal: "Modal" },
      "../table-sort": loadSource("table-sort.ts", {
        modules: { "../ui": { ICON: {} }, "../i18n": { t } },
      }),
      "./list/ChipsRow": { ChipsRow: "ChipsRow" },
      "./list/FilterBar": { FilterBar: "FilterBar" },
      "./list/PageNav": {
        PageNav: "PageNav",
        itemRange: (page, limit, total) => `${page}:${limit}:${total}`,
      },
      "./list/SortHeader": { SortHeader: "SortHeader", asFilmSort },
      "./list/TableCard": { TableCard: "TableCard" },
      "./settings/Card": cardBlock,
    },
    stubs: PRESENTATION_MODULES,
  }));

function log({ query = "", demo = false, answer = PAGE } = {}) {
  const state = {
    queries: [],
    sorts: [],
    polls: [],
    api: [],
    confirms: [],
    notes: [],
    anchors: [],
    href: "",
  };
  const props = {
    status: { serviceNames: { radarr: "Radarr 4K" } },
    demo,
    query,
    setQuery: (next) => {
      state.queries.push(next);
      props.query = next;
    },
    sort: null,
    setSort: (next) => {
      state.sorts.push(next);
      props.sort = next;
    },
  };
  const view = mount(viewer().EventLogViewer, props);
  const l = {
    state,
    answer,
    props,
    timers: new Map(),
    timer: 0,
    clock: 0,
    render() {
      active = l;
      return (l.tree = view.render());
    },
    advance(ms) {
      active = l;
      l.clock += ms;
      for (const [id, entry] of [...l.timers])
        if (entry.at <= l.clock) {
          l.timers.delete(id);
          entry.run();
        }
      return l.render();
    },
    // The poll of the current query, as usePolling runs it.
    async load() {
      active = l;
      await state.polls.at(-1).load(new AbortController().signal);
      await tick();
      return l.render();
    },
    get card() {
      return one(l.tree, "TableCard").props;
    },
    get bar() {
      return l.card.bar.props;
    },
    get chips() {
      return l.card.chips.props;
    },
    get pager() {
      return l.card.foot.props;
    },
    get table() {
      return ofType(one(l.tree, "TableCard"), "table")[0];
    },
    get rows() {
      return ofType(ofType(l.table, "tbody")[0], "tr");
    },
    get drawer() {
      return ofType(l.tree, "LogFilterDrawer")[0]?.props;
    },
  };
  l.render();
  return l;
}

test("the log builds its card from the list blocks", async () => {
  const l = log();
  // The card: titled Log, its count, the hint line, the spinner while it
  // loads, the comfortable rows of the settings.
  const card = l.card;
  assert.equal(card.id, "event-log");
  assert.equal(card.title, "Log");
  assert.equal(card.count, 0);
  assert.equal(card.countTitle, "Entries in the list");
  assert.equal(
    card.hint,
    "Events from the last 24 hours. Older entries are removed automatically.",
  );
  assert.equal(card.regionLabel, "Log");
  assert.equal(card.density, "comfortable");
  // The filter bar without a preset: the search and Filters.
  assert.deepEqual(data({ ...l.bar.search, change: undefined }), {
    label: "Search",
    placeholder: "Log search …",
    value: "",
  });
  assert.equal(l.bar.preset, undefined);
  assert.equal(l.bar.filters.count, 0);
  assert.equal(l.bar.filters.expanded, false);
  assert.equal(l.chips.label, "Filters");
  assert.equal(l.chips.empty, "No active filters");
  assert.deepEqual(data(l.chips.chips), []);
  // Until the answer: a page of placeholder rows under the real heads,
  // hidden from assistive technology, each as high as a row (its time
  // and day).
  assert.equal(l.rows.length, 25);
  for (const row of l.rows) {
    assert.ok(classes(row).includes("v2-row--placeholder"));
    assert.equal(row.props["aria-hidden"], "true");
    assert.equal(ofType(row, "td").length, 4);
    assert.equal(byClass(row, "v2-table-sub").length, 1);
  }
  assert.equal(ofType(l.tree, "ListEmpty").length, 0);

  // The answer: its rows, its count.
  await l.load();
  assert.equal(l.card.count, 60);
  assert.equal(l.rows.length, 2);
  const [failed, started] = l.rows;
  const cells = (row) => ofType(row, "td");
  // Time: the clock and the day, the ISO time as its title.
  assert.equal(
    byClass(cells(failed)[0], "v2-table-name")[0].props.title,
    new Date(EVENTS[0].ts).toISOString(),
  );
  assert.equal(byClass(cells(failed)[0], "v2-table-sub").length, 1);
  // Level: the status tag in the tone of its level.
  assert.deepEqual(data(one(cells(failed)[1], "StatusTag").props.view), {
    tone: "error",
    text: "Error",
    long: "Error",
  });
  assert.equal(one(cells(started)[1], "StatusTag").props.view.tone, "info");
  // Source, its service below it.
  assert.equal(text(cells(failed)[2]), "SynchronizationRadarr 4K");
  assert.equal(text(cells(started)[2]), "System");
  // Its column has a fixed width (fix round 1, I1), so a long source or
  // service is cut, whole in its title.
  assert.deepEqual(
    ofType(cells(failed)[2], "div").map((n) => n.props.title),
    ["Synchronization", "Radarr 4K"],
  );
  // Message: with a detail or subject a text button opens Log entry; the
  // repeats as a count with the 1.7.0 title; the subject below.
  const open = byClass(cells(failed)[3], "v2-text-btn")[0];
  assert.equal(open.type, "button");
  assert.equal(text(open), "Sync failed");
  const repeat = byClass(cells(failed)[3], "v2-count")[0];
  assert.equal(text(repeat), "×4");
  assert.equal(repeat.props.title, "4 occurrences combined in 10 minutes");
  assert.equal(text(byClass(cells(failed)[3], "v2-table-sub")[0]), "Radarr");
  assert.equal(byClass(cells(started)[3], "v2-text-btn").length, 0);
  assert.equal(byClass(cells(started)[3], "v2-count").length, 0);
  assert.equal(ofType(l.tree, "LogEntryDialog").length, 0);
  open.props.onClick();
  l.render();
  // The v2 dialog (its rows and copies: settings-dialogs.test.mjs) gets
  // the entry and the viewer's names.
  const entry = one(l.tree, "LogEntryDialog");
  assert.equal(entry.props.entry.message, "Sync failed");
  assert.equal(entry.props.serviceName("radarr"), "Radarr 4K");
  assert.equal(entry.props.sourceLabel("sync"), "Synchronization");
  entry.props.close();
  l.render();
  assert.equal(ofType(l.tree, "LogEntryDialog").length, 0);

  // No entries: the 1.7.0 texts, with Reset filters while filters apply.
  const empty = log({ answer: { ...PAGE, events: [], total: 0 } });
  await empty.load();
  let state = one(empty.tree, "ListEmpty").props;
  assert.equal(state.title, "No entries in the last 24 hours.");
  assert.equal(state.pending, false);
  assert.equal(ofType(state.children, "button").length, 0);
  assert.equal(ofType(empty.tree, "table").length, 0);
  // The next visit in this session reserves the last answer's rows: none,
  // so the empty state's place, invisible until the answer.
  const again = log({
    query: "level=error",
    answer: { ...PAGE, events: [], total: 0 },
  });
  state = one(again.tree, "ListEmpty").props;
  assert.equal(state.pending, true);
  await again.load();
  state = one(again.tree, "ListEmpty").props;
  assert.equal(state.title, "No matching entries.");
  assert.equal(state.pending, false);
  const reset = ofType(state.children, "button")[0];
  assert.equal(text(reset), "Reset filters");
  reset.props.onClick();
  again.render();
  assert.deepEqual(again.state.queries, [""]);
  // A visit after rows reserves their number again.
  const back = log();
  await back.load();
  assert.equal(log().rows.length, 2);
});

test("the log drawer counts its draft and applies once", async () => {
  const l = log({ query: "q=dune&source=sync" });
  await l.load();
  assert.equal(l.drawer, undefined, "closed: not loaded");
  assert.equal(l.bar.filters.count, 1, "the search is no drawer filter");
  // Filters opens the drawer from its button, through its chunk.
  l.bar.filters.open("Filters button");
  l.render();
  assert.equal(l.bar.filters.expanded, true);
  const drawer = l.drawer;
  assert.equal(drawer.subtitle, "Log");
  assert.deepEqual(data(drawer.initial), {
    level: [],
    source: ["sync"],
    instance: [],
  });
  // Every level, the counted or chosen sources, the services with entries.
  assert.deepEqual(
    data(
      drawer.groups.map((g) => [
        g.key,
        g.options.map((o) => [o.value, o.count]),
      ]),
    ),
    [
      [
        "level",
        [
          ["error", 1],
          ["warning", 0],
          ["info", 59],
        ],
      ],
      [
        "source",
        [
          ["system", 59],
          ["sync", 1],
        ],
      ],
      ["instance", [["radarr", 1]]],
    ],
  );
  assert.equal(drawer.groups[2].options[0].label, "Radarr 4K");
  // The live count: one entry of the draft's results, with the search.
  assert.equal(
    drawer.countPath({ level: ["warning"], source: ["sync"], instance: [] }),
    "events?q=dune&level=warning&source=sync&limit=1",
  );
  // Apply: one route change, back on page 1, the search kept.
  l.pager.setPage(3);
  l.render();
  assert.equal(l.pager.page, 3);
  const before = l.state.queries.length;
  drawer.apply({ level: ["warning"], source: [], instance: [] });
  l.render();
  assert.deepEqual(l.state.queries.slice(before), ["q=dune&level=warning"]);
  assert.equal(l.pager.page, 1);
  // Closing without a change asks nothing and keeps the filters.
  drawer.close();
  l.render();
  assert.equal(l.drawer, undefined);
  assert.equal(l.bar.filters.expanded, false);
  assert.deepEqual(l.state.queries.slice(before), ["q=dune&level=warning"]);

  // The drawer itself (its chunk): a draft of the three lists, Apply once
  // and only with a change, Reset clears, closing discards; each value is
  // choosable, also with no entries (1.7.0).
  const paths = [];
  const { default: LogFilterDrawer } = loadSource(
    "components/settings/LogFilterDrawer.tsx",
    {
      modules: {
        "preact/hooks": hooks,
        "../../hooks/useToolMatchCount": {
          useToolMatchCount: (path) => (
            paths.push(path),
            { count: 7, stale: false }
          ),
        },
        "../../i18n": i18n,
        "../list/CheckField": { CheckField: "CheckField" },
        "../list/FilterDrawer": { FilterDrawer: "FilterDrawer" },
      },
    },
  );
  const applied = [],
    closed = [];
  const view = mount(LogFilterDrawer, {
    subtitle: "Log",
    groups: drawer.groups,
    initial: { level: ["error"], source: [], instance: [] },
    countPath: (draft) => "count:" + draft.level.join(","),
    apply: (draft) => applied.push(data(draft)),
    close: () => closed.push(true),
  });
  let tree = view.render();
  const shell = () => one(tree, "FilterDrawer").props;
  assert.equal(shell().title, "Filters");
  assert.equal(shell().subtitle, "Log");
  assert.equal(shell().count, 7);
  assert.deepEqual(paths.at(-1), "count:error");
  const fields = ofType(tree, "CheckField");
  assert.deepEqual(
    fields.map((field) => [
      field.props.id,
      field.props.label,
      field.props.lockEmpty,
    ]),
    [
      ["v2-drawer-level", "Level", false],
      ["v2-drawer-source", "Source", false],
      ["v2-drawer-instance", "Service", false],
    ],
  );
  shell().apply();
  assert.deepEqual(applied, [], "no change: no apply");
  assert.equal(closed.length, 1);
  fields[0].props.change(["warning", "error"]);
  tree = view.render();
  assert.equal(paths.at(-1), "count:warning,error");
  shell().apply();
  assert.deepEqual(applied, [
    { level: ["warning", "error"], source: [], instance: [] },
  ]);
  assert.equal(closed.length, 2);
  shell().reset();
  tree = view.render();
  assert.deepEqual(
    ofType(tree, "CheckField").map((field) => data(field.props.selected)),
    [[], [], []],
  );
  shell().close();
  assert.equal(applied.length, 1);
  // CheckField keeps a value without entries choosable, its 0 shown.
  const { CheckField } = loadSource("components/list/CheckField.tsx", {
    modules: { "../../ui": ui },
  });
  const field = (lockEmpty) =>
    CheckField({
      id: "x",
      label: "Level",
      options: [{ value: "warning", label: "Warning", count: 0 }],
      selected: [],
      change: f,
      lockEmpty,
    });
  const open = field(false);
  assert.equal(ofType(open, "input")[0].props.disabled, false);
  assert.equal(text(byClass(open, "v2-ff-n")[0]), "0");
  assert.equal(ofType(field(undefined), "input")[0].props.disabled, true);
});

test("log chips keep the 1.7.0 labels", async () => {
  const l = log({ query: "source=sync" });
  assert.deepEqual(data(l.chips.chips.map((chip) => chip.label)), [
    "Synchronization",
  ]);
  assert.deepEqual(l.state.queries, [], "the route is the start");
  // Removing a chip applies at once, back on page 1.
  l.pager.setPage(2);
  l.render();
  l.chips.chips[0].remove();
  l.render();
  assert.deepEqual(l.state.queries, [""]);
  assert.equal(l.pager.page, 1);
  assert.deepEqual(data(l.chips.chips), []);
  // The search, each level, source and service: the 1.7.0 labels.
  const all = log({ query: "q=dune&level=error&source=sync&instance=radarr" });
  assert.deepEqual(
    data(all.chips.chips.map((chip) => [chip.key, chip.label, chip.excluded])),
    [
      ["q", "Search: dune", false],
      ["level:error", "Error", false],
      ["source:sync", "Synchronization", false],
      ["instance:radarr", "Radarr 4K", false],
    ],
  );
  assert.equal(all.bar.filters.count, 3);
  all.pager.setPage(2);
  all.render();
  all.chips.chips[0].remove();
  all.render();
  assert.equal(all.pager.page, 1, "the search's chip too");
  assert.equal(all.bar.search.value, "");
  assert.deepEqual(all.state.queries, [
    "level=error&source=sync&instance=radarr",
  ]);
  // The search applies after 300 ms.
  all.bar.search.change("arrival");
  all.render();
  assert.equal(all.state.queries.length, 1);
  all.advance(300);
  assert.deepEqual(all.state.queries.slice(1), [
    "q=arrival&level=error&source=sync&instance=radarr",
  ]);
  // Reset filters clears everything.
  all.chips.reset();
  all.render();
  assert.deepEqual(all.state.queries.slice(2), [""]);
  assert.deepEqual(data(all.chips.chips), []);
});

test("the log keeps refresh, download as text or JSON and a demo-safe clear", async () => {
  const l = log();
  await l.load();
  const tools = l.chips.tools;
  const refresh = button(tools, "Refresh log");
  assert.deepEqual(classes(refresh), ["v2-icon-btn", "v2-icon-btn--sm"]);
  assert.equal(refresh.props.title, "Refresh log");
  const gets = () => l.state.api.filter(([method]) => method === "GET").length;
  const before = gets();
  await refresh.props.onClick();
  await tick();
  assert.equal(gets(), before + 1);
  // Download: the text export of the open sort, without filters; the
  // context menu downloads JSON.
  const download = button(tools, "Download log");
  assert.equal(download.type, "a");
  assert.equal(download.props.download, true);
  assert.equal(
    download.props.href,
    "/api/events/export?sort=ts&dir=desc&format=txt",
  );
  assert.equal(
    download.props.title,
    "Download log as text · JSON via the context menu",
  );
  let prevented = false;
  download.props.onContextMenu({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
  assert.equal(l.state.href, "/api/events/export?sort=ts&dir=desc&format=json");
  // Clear log asks first, then deletes and reads again.
  const clear = button(tools, "Clear log");
  assert.deepEqual(classes(clear), [
    "v2-icon-btn",
    "v2-icon-btn--sm",
    "v2-icon-btn--danger",
  ]);
  assert.equal(clear.props.title, "Clear log");
  assert.equal(clear.props.disabled, false);
  await clear.props.onClick();
  await tick();
  assert.deepEqual(l.state.confirms, ["You are about to clear the log."]);
  assert.deepEqual(l.state.api.slice(-2), [
    ["DELETE", "events"],
    ["GET", "events?sort=ts&dir=desc&limit=25&offset=0"],
  ]);
  // The demo log cannot be cleared.
  const demo = button(log({ demo: true }).chips.tools, "Clear log");
  assert.equal(demo.props.disabled, true);
  assert.equal(demo.props.title, "The demo log cannot be cleared");
  // With filters the export carries them.
  const filtered = log({ query: "level=error" });
  assert.equal(
    button(filtered.chips.tools, "Download log").props.href,
    "/api/events/export?level=error&sort=ts&dir=desc&format=txt",
  );
});

test("the log sorts, pages and reloads like 1.7.0", async () => {
  const l = log();
  await l.load();
  // Its first three columns keep fixed widths (v2-set-log, fix round 1,
  // I1), the placeholder rows' table too, so no answer, page or filter
  // moves a head; other settings tables keep their class.
  assert.deepEqual(classes(l.table), ["v2-table", "v2-set-log"]);
  assert.deepEqual(classes(ofType(log({ answer: PAGE }).tree, "table")[0]), [
    "v2-table",
    "v2-set-log",
  ]);
  assert.deepEqual(classes(cardBlock.table(["A"], [])), ["v2-table"]);
  // Time, Level and Source sort; Message is a plain head.
  const heads = kids(ofType(ofType(l.table, "thead")[0], "tr")[0]);
  assert.deepEqual(
    heads.map((head) =>
      head.type === "SortHeader"
        ? [head.props.field, head.props.label, data(head.props.sort)]
        : [head.type, text(head)],
    ),
    [
      ["ts", "Time", { field: "", direction: "asc" }],
      ["level", "Level", { field: "", direction: "asc" }],
      ["source", "Source", { field: "", direction: "asc" }],
      ["th", "Message"],
    ],
  );
  // Message takes the rest of the row.
  assert.deepEqual(classes(heads[3]), ["v2-table-title"]);
  // The pager: 25 per page, its summary.
  assert.equal(l.pager.page, 1);
  assert.equal(l.pager.pages, 3);
  assert.equal(l.pager.summary, "1:25:60");
  // Auto-reload every 10 s on page 1 with the default sort only.
  assert.equal(l.state.polls.at(-1).interval, 10000);
  assert.equal(
    l.state.polls.at(-1).request,
    "sort=ts&dir=desc&limit=25&offset=0",
  );
  l.pager.setPage(2);
  l.render();
  assert.equal(
    l.state.polls.at(-1).request,
    "sort=ts&dir=desc&limit=25&offset=25",
  );
  assert.equal(l.state.polls.at(-1).interval, null);
  // A sort is the owner's, from page 1, and the log requests by it.
  heads[1].props.onSort("level");
  l.render();
  assert.deepEqual(data(l.state.sorts), [{ field: "level", direction: "asc" }]);
  assert.equal(l.pager.page, 1);
  assert.equal(
    l.state.polls.at(-1).request,
    "sort=level&dir=asc&limit=25&offset=0",
  );
  assert.equal(l.state.polls.at(-1).interval, null);
  const sorted = kids(ofType(ofType(l.table, "thead")[0], "tr")[0]);
  assert.deepEqual(data(sorted[1].props.sort), {
    field: "level",
    direction: "asc",
  });
  // autoReloads is the 1.7.0 rule.
  assert.equal(eventLog.autoReloads(true, null, 1), true);
  assert.equal(
    eventLog.autoReloads(true, { field: "ts", direction: "desc" }, 1),
    true,
  );
  assert.equal(
    eventLog.autoReloads(true, { field: "ts", direction: "asc" }, 1),
    false,
  );
  assert.equal(eventLog.autoReloads(true, null, 2), false);
});

// --- The area ---------------------------------------------------------------

function page({ section = "system", tab = "info", demo = true }) {
  const draft = {
    cfg: { instances: [], tagColors: {}, tagTextColors: {}, hiddenTags: {} },
    setCfg: f,
    draftLocale: "en",
    setDraftLocale: f,
    draftPrefs: {
      density: "comfortable",
      stacked: { radarr: false, sonarr: false },
      filename: { radarr: true, sonarr: true },
    },
    setDraftPrefs: f,
    savedPrefs: {
      density: "comfortable",
      stacked: { radarr: false, sonarr: false },
      filename: { radarr: true, sonarr: true },
    },
    look: {},
    setLook: f,
    mode: "dark",
    dirty: true,
    setRulesDirty: f,
    setCustomDirty: f,
    busy: false,
    confirmSectionChange: async () => true,
    saveSettings: f,
    submit: f,
    confirmTags: f,
    tagChanges: null,
    setTagChanges: f,
    tagSaveReview: null,
    setTagSaveReview: f,
  };
  const tabs = [];
  const { SettingsPage } = loadSource("components/SettingsPage.tsx", {
    browser: {
      window: { addEventListener: f, removeEventListener: f },
      AbortController,
    },
    modules: {
      "preact/hooks": hooks,
      "../ui": { colorFields: ["resolution"] },
      "../instances": instances,
      "../i18n": i18n,
      "../notifications": { notify: f },
      "./AppearanceSettings": {
        AppearanceSettings: "AppearanceSettings",
        useDisplayTab: () => ["general", f],
      },
      "./ConnectionSettings": { ConnectionSettings: "ConnectionSettings" },
      "./CustomTagsSettings": { CustomTagsSettings: "CustomTagsSettings" },
      "./SystemSettings": {
        SystemSettingsInfo: "SystemSettingsInfo",
        SystemSettingsLog: "SystemSettingsLog",
        useSystemTab: () => [tab, (next) => tabs.push(next)],
      },
      "./settings/SettingsHeader": { SettingsHeader: "SettingsHeader" },
      "./TagPolicyDialog": { TagPolicyDialog: "TagPolicyDialog" },
      "./TagReview": { TagReview: "TagReview" },
      "./WidgetsSettings": { WidgetsSettings: "WidgetsSettings" },
      "./settings/TagColorsCard": { TagColorsCard: "TagColorsCard" },
      "./settings/WarningColorsCard": {
        WarningColorsCard: "WarningColorsCard",
      },
      "../api": { api: async () => [] },
      "../hooks/useSettingsDraft": { useSettingsDraft: () => draft },
      "../hooks/useLazyChunk": {
        lazyChunk: () => ({}),
        useLazyChunk: () => null,
      },
      "../appearance": {
        setBandPreference: f,
        setTheme: f,
        storedBand: () => null,
      },
      "../settings-model": model,
    },
    stubs: PRESENTATION_MODULES,
  });
  const view = mount(SettingsPage, {
    customTags: [],
    customChanged: async () => [],
    settings: draft.cfg,
    status: { recognitionRevision: 0, cacheRevision: 0, sync: {} },
    summary: {},
    demo,
    saved: async () => {},
    onDirty: f,
    refresh: async () => {},
    section,
    registerSectionGuard: f,
    tab: "",
    setTab: f,
    logQuery: "level=error",
    setLogQuery: "setLogQuery",
    revision: 4,
    theme: "dark",
    onTheme: f,
  });
  return { tabs, tree: view.render() };
}
const settingsForm = (tree) =>
  ofType(tree, "form").find((form) => form.props.id === "settings-form");

test("system drops the transition sheet; no settings page keeps it", () => {
  // The band: System with its segment Info / Log, no Save settings.
  const p = page({ tab: "info" });
  const header = one(p.tree, "SettingsHeader").props;
  assert.equal(header.section, "system");
  assert.equal(header.save, undefined);
  assert.equal(header.segment.label, "System sections");
  assert.equal(header.segment.idPrefix, "system");
  assert.equal(header.segment.value, "info");
  assert.deepEqual(data(header.segment.items), [
    { value: "info", label: "Info" },
    { value: "log", label: "Log" },
  ]);
  header.segment.select("log");
  assert.deepEqual(p.tabs, ["log"]);
  assert.equal(ofType(p.tree, "PageHeader").length, 0);
  assert.equal(ofType(p.tree, "SettingsSectionHeading").length, 0);
  // Info stands in the settings form, the first block on the band (no
  // demo notice on System); the log is not mounted.
  const form = settingsForm(p.tree);
  assert.deepEqual(classes(form), ["v2-set"]);
  assert.equal(form.props.hidden, false);
  assert.equal(byClass(p.tree, "v2-notice").length, 0);
  assert.equal(one(form, "SystemSettingsInfo").props.active, true);
  assert.equal(ofType(p.tree, "SystemSettingsLog").length, 0);
  // Log: the form is hidden (its areas stay mounted), the log follows it.
  const l = page({ tab: "log" });
  const logForm = settingsForm(l.tree);
  assert.equal(logForm.props.hidden, true);
  assert.equal(one(logForm, "SystemSettingsInfo").props.active, false);
  const panel = one(l.tree, "SystemSettingsLog").props;
  assert.deepEqual(
    [panel.revision, panel.query, panel.setQuery],
    [4, "level=error", "setLogQuery"],
  );
  assert.equal(one(l.tree, "SettingsHeader").props.segment.value, "log");
  // Other areas: Info hidden in the form, no System segment.
  const display = page({ section: "widgets" });
  assert.equal(one(display.tree, "SystemSettingsInfo").props.active, false);
  assert.equal(settingsForm(display.tree).props.hidden, false);
  assert.ok(one(display.tree, "SettingsHeader").props.save);
  assert.equal(byClass(display.tree, "v2-notice").length, 1);
  // The sticky 1.7.0 heading and its scroll effect are gone.
  const code = squash(src("components/SettingsPage.tsx"));
  assert.doesNotMatch(
    code,
    /SettingsSectionHeading|settings-section-heading|scrolled|PageHeader/,
  );
});
