import test from "node:test";
import assert from "node:assert/strict";
import {
  componentHarness,
  loadSource,
  nodes,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { src } from "./helpers/sources.mjs";

// The sync popover of the frame (Task 11, E16): the manual sync of
// System → Info as a hook (hooks/useManualSync.ts), the popover per
// instance (components/frame/SyncPopover.tsx) and System → Info, whose
// status line now comes from the same syncSummary.

// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const date = (iso) => (iso ? "date(" + iso + ")" : "Not synced yet");
const clock = (iso) => (iso ? "time(" + iso + ")" : "");

const storage = loadSource("browser-storage.ts");
const instances = loadSource("instances.ts");
const frameStatus = loadSource("frame-status.ts", {
  modules: {
    "./instances": instances,
    "./tool-route": loadSource("tool-route.ts", {
      modules: { "./browser-storage": storage },
    }),
    "./tool-table": loadSource("tool-table.ts"),
    "./mux-spec": loadSource("mux-spec.ts", {
      modules: { "./languages.ts": { audioLanguage: () => "" } },
    }),
    "./placement": loadSource("placement.ts"),
    "./filecheck": loadSource("filecheck.ts"),
  },
});

const instance = (id, type, name = "", extra = {}) => ({
  id,
  type,
  name,
  enabled: true,
  url: "http://" + id,
  hasKey: true,
  interval: 60,
  ...extra,
});
const settings = {
  instances: [
    instance("radarr", "radarr"),
    instance("radarr-4k", "radarr", "Radarr 4K"),
    instance("sonarr", "sonarr", "", { enabled: false }),
    instance("emby", "emby", "Living room"),
  ],
};
const done = {
  radarr: { count: 10, lastSuccess: "2026-11-07T09:41:00Z" },
  "radarr-4k": { count: 5, lastSuccess: "2026-11-07T10:05:00Z" },
  emby: { count: 3, lastSuccess: "2026-11-07T08:00:00Z" },
};
const statusWith = (sync = done, demo = false) => ({ demo, sync });
const summaryOf = (status) =>
  frameStatus.syncSummary(status, settings, t, date, clock);

// --- useManualSync ------------------------------------------------------------

function manualSync({ fail = false } = {}) {
  const calls = [];
  const runtime = createHookRuntime();
  const { useManualSync } = loadSource("hooks/useManualSync.ts", {
    modules: {
      "preact/hooks": runtime.hooks,
      "../api": {
        api: async (...args) => {
          calls.push(["api", ...plain(args)]);
          if (fail) throw new Error("Request failed");
          return {};
        },
      },
      "../i18n": { t },
      "../notifications": {
        notify: (...args) => calls.push(["notify", ...args]),
      },
    },
  });
  const refresh = async () => {
    calls.push(["refresh"]);
  };
  let current;
  const render = () => (current = runtime.render(() => useManualSync(refresh)));
  render();
  return {
    calls,
    render,
    get current() {
      return current;
    },
  };
}

test("manual sync behaves as on System → Info", async () => {
  const hook = manualSync();
  assert.deepEqual(plain(hook.current.syncing), {});
  // The same request, then a refresh, then the same notice.
  const running = hook.current.sync("radarr-4k");
  hook.render();
  assert.equal(hook.current.syncing["radarr-4k"], true, "locked while sent");
  await running;
  hook.render();
  assert.equal(hook.current.syncing["radarr-4k"], false, "unlocked after");
  assert.deepEqual(hook.calls, [
    ["api", "sync", "POST", { service: "radarr-4k" }],
    ["refresh"],
    [
      "notify",
      "Sync queued. Services run one at a time; you can keep filtering.",
    ],
  ]);
  // A failed request (api shows its own error) refreshes and notifies
  // nothing, and unlocks the instance again.
  const failing = manualSync({ fail: true });
  const attempt = failing.current.sync("emby");
  failing.render();
  assert.equal(failing.current.syncing.emby, true);
  await attempt;
  failing.render();
  assert.equal(failing.current.syncing.emby, false);
  assert.deepEqual(failing.calls, [
    ["api", "sync", "POST", { service: "emby" }],
  ]);
  // Instances lock one by one.
  const both = manualSync();
  const first = both.current.sync("radarr");
  const second = both.current.sync("emby");
  both.render();
  assert.deepEqual(plain(both.current.syncing), { radarr: true, emby: true });
  await Promise.all([first, second]);
  both.render();
  assert.deepEqual(plain(both.current.syncing), { radarr: false, emby: false });
  // System → Info uses the same hook; the request lives only there.
  const system = src("components/SystemSettings.tsx");
  assert.match(system, /useManualSync\(refresh\)/);
  assert.doesNotMatch(system, /api\("sync"/);
  assert.doesNotMatch(src("components/AppShell.tsx"), /api\("sync"/);
});

// --- SyncPopover --------------------------------------------------------------

const ui = { ICON: { sort: 13, label: 15, button: 16 } };
const classes = (node) => String(node?.props?.class ?? "").split(/\s+/);
const hasClass = (node, name) => classes(node).includes(name);
const byClass = (tree, name) => nodes(tree).filter((n) => hasClass(n, name));

function popover(overrides = {}) {
  const calls = [];
  const status = overrides.status ?? statusWith();
  const props = {
    summary: summaryOf(status),
    status,
    demo: false,
    sync: (service) => {
      calls.push(["sync", service]);
      return Promise.resolve();
    },
    syncing: {},
    close: (returnFocus) => calls.push(["close", returnFocus]),
    anchor: { name: "chip" },
    placement: "bottom-end",
    ...overrides,
  };
  const tree = componentHarness("frame/SyncPopover", props, {
    exportName: "SyncPopover",
    modules: {
      "../../i18n": { t },
      "../../ui": ui,
      "./Popover": { Popover: "Popover" },
    },
  }).render();
  return { tree, calls, props };
}
const items = (tree) => byClass(tree, "v2-sync-item");
const itemButton = (item) => nodes(item).find((n) => n.type === "button");

test("the sync popover lists every instance with the System line", () => {
  const { tree, calls, props } = popover();
  // The one popover primitive: a dialog named "Synchronization" at the
  // trigger, closed through the owner's close.
  const pop = nodes(tree).find((n) => n.type === "Popover");
  assert.ok(pop, "a Popover");
  assert.equal(pop.props.role, "dialog");
  assert.equal(pop.props.label, "Synchronization");
  assert.equal(pop.props.anchor, props.anchor);
  assert.equal(pop.props.placement, "bottom-end");
  // Wide: its times and states change while it is open, its width not.
  assert.equal(pop.props.wide, true);
  pop.props.close(true);
  assert.deepEqual(calls, [["close", true]]);
  // A header in the mini-label style.
  assert.deepEqual(
    byClass(tree, "v2-pop-title").map((title) => text(title)),
    ["Synchronization"],
  );
  // One entry per enabled instance, in the order of System → Info: its
  // name, its System → Info line and its button.
  const list = items(tree);
  assert.deepEqual(
    list.map((item) => [
      text(byClass(item, "v2-sync-name")[0]),
      text(byClass(item, "v2-sync-state")[0]),
      text(itemButton(item)),
    ]),
    [
      ["Radarr", "Last sync: date(2026-11-07T09:41:00Z)", "Sync now"],
      ["Radarr 4K", "Last sync: date(2026-11-07T10:05:00Z)", "Sync now"],
      ["Living room", "Last match: date(2026-11-07T08:00:00Z)", "Match now"],
    ],
  );
  assert.deepEqual(
    list.map((item) => text(byClass(item, "v2-sync-state")[0])),
    props.summary.services.map((service) => service.text),
  );
  // The dot shows each instance's state; it is decorative.
  const dots = list.map((item) => byClass(item, "v2-dot")[0]);
  assert.ok(dots.every((dot) => dot.props["aria-hidden"] === "true"));
  assert.ok(
    dots.every((dot) => classes(dot).length === 1),
    "all ok",
  );
  // Every button is a plain button that syncs its own instance.
  for (const [index, item] of list.entries()) {
    const button = itemButton(item);
    assert.equal(button.props.type, "button");
    assert.ok(hasClass(button, "v2-btn") && hasClass(button, "v2-btn--sm"));
    assert.equal(button.props.disabled, false);
    const focused = [];
    button.props.onClick({
      currentTarget: {
        closest: (query) =>
          query === ".v2-pop" ? { focus: () => focused.push(index) } : null,
      },
    });
    // Focus stays in the popover while the button locks.
    assert.deepEqual(focused, [index]);
  }
  assert.deepEqual(calls.slice(1), [
    ["sync", "radarr"],
    ["sync", "radarr-4k"],
    ["sync", "emby"],
  ]);

  // States: running (queued), failed and never synced, as System → Info
  // words them; the dot follows.
  const states = popover({
    status: statusWith({
      radarr: { ...done.radarr, running: true, queued: true },
      "radarr-4k": { ...done["radarr-4k"], error: "Radarr is unreachable" },
    }),
  });
  const shown = items(states.tree).map((item) => [
    text(byClass(item, "v2-sync-state")[0]),
    classes(byClass(item, "v2-dot")[0]).slice(1),
  ]);
  assert.deepEqual(shown, [
    ["Sync waiting for a slot …", ["v2-dot--running"]],
    ["Sync failed · Radarr is unreachable", ["v2-dot--error"]],
    ["Last match: Not synced yet", ["v2-dot--off"]],
  ]);
});

test("buttons are disabled in demo, while running and for disabled instances", () => {
  const locked = (tree) =>
    items(tree).map((item) => itemButton(item).props.disabled);
  // Nothing locks: every button works.
  assert.deepEqual(locked(popover().tree), [false, false, false]);
  // The demo locks every button.
  assert.deepEqual(locked(popover({ demo: true }).tree), [true, true, true]);
  // A request on its way locks its own instance.
  assert.deepEqual(
    locked(popover({ syncing: { "radarr-4k": true, emby: false } }).tree),
    [false, true, false],
  );
  // A running sync (also a queued one) locks its own instance.
  assert.deepEqual(
    locked(
      popover({
        status: statusWith({
          ...done,
          emby: { ...done.emby, running: true, queued: true },
        }),
      }).tree,
    ),
    [false, false, true],
  );
  // A disabled instance, should a summary hold one, is locked too.
  const status = statusWith();
  const summary = summaryOf(status);
  summary.services[0] = { ...summary.services[0], enabled: false };
  assert.deepEqual(locked(popover({ status, summary }).tree), [
    true,
    false,
    false,
  ]);
  // The same four locks as System → Info.
  const source = src("components/frame/SyncPopover.tsx");
  assert.match(
    source,
    /demo\s*\|\|\s*!service\.enabled\s*\|\|\s*syncing\[service\.id\]\s*\|\|\s*status\.sync\?\.\[service\.id\]\?\.running/,
  );
});

// --- System → Info ------------------------------------------------------------

// The status line as 1.7.0 System → Info wrote it (SystemInfo.tsx before
// Task 11), the oracle for the line System → Info shows now.
function line170(item, sync) {
  const media = instances.isMediaType(item.type);
  return !item.enabled
    ? t("Disabled")
    : sync?.running
      ? sync.queued
        ? t("Sync waiting for a slot …")
        : t("Sync in progress …")
      : sync?.error
        ? t("Sync failed · {error}", { error: t(sync.error) })
        : t(media ? "Last match: {date}" : "Last sync: {date}", {
            date: date(sync?.lastSuccess),
          });
}

function systemInfo(status, summary = summaryOf(status)) {
  return componentHarness(
    "SystemInfo",
    {
      status,
      settings,
      summary,
      demo: false,
      syncing: {},
      manualSync: async () => {},
      backup: async () => {},
      reviewTags: () => {},
      password: null,
    },
    {
      modules: {
        "../ui": {
          ICON: { label: 15, button: 16 },
          CardHeading: "CardHeading",
          count: String,
          date,
        },
        "../instances": instances,
        "../i18n": { t, useI18n: () => ({ locale: "en" }) },
        "./ExternalTagStatus": { ExternalTagStatus: "ExternalTagStatus" },
      },
    },
  ).render();
}
const lines = (tree) =>
  nodes(tree)
    .filter((n) => n.type === "article")
    .map((article) => {
      const line = article.props.children.find((child) => child?.type === "p");
      return [text(line), line.props.class];
    });

test("the System card renders as before", () => {
  const cases = {
    synced: done,
    states: {
      radarr: { ...done.radarr, running: true },
      "radarr-4k": { ...done["radarr-4k"], running: true, queued: true },
      emby: { ...done.emby, error: "Emby is unreachable" },
    },
    never: {},
  };
  const enabled = settings.instances.filter((item) => item.enabled);
  for (const [name, sync] of Object.entries(cases)) {
    const status = statusWith(sync);
    const tree = systemInfo(status);
    // The line after the heading: same text and class as in 1.7.0.
    assert.deepEqual(
      lines(tree),
      enabled.map((item) => [
        line170(item, sync[item.id]),
        sync[item.id]?.error ? "error" : "",
      ]),
      name,
    );
    // The heading and the button stay as they were.
    const articles = nodes(tree).filter((n) => n.type === "article");
    assert.deepEqual(
      articles.map((article) => {
        const heading = byClass(article, "system-service-heading")[0];
        const button = byClass(heading, "system-sync-button")[0];
        return [
          text(nodes(heading).find((n) => n.type === "h4")),
          text(button).trim(),
          !!button.props.disabled,
        ];
      }),
      enabled.map((item) => [
        instances.instanceLabel(item),
        instances.isMediaType(item.type) ? "Match now" : "Sync now",
        !!sync[item.id]?.running,
      ]),
      name,
    );
  }
  // The line is the frame's summary line of the instance (one source for
  // System → Info and the sync popover), matched by id.
  const status = statusWith();
  const summary = summaryOf(status);
  summary.services = summary.services
    .map((service) => ({ ...service, text: "line of " + service.id }))
    .reverse();
  assert.deepEqual(
    lines(systemInfo(status, summary)).map(([line]) => line),
    ["line of radarr", "line of radarr-4k", "line of emby"],
  );
  // The shell hands its summary through the settings page to System → Info.
  for (const [file, element] of [
    ["components/AppShell.tsx", "<SettingsPage"],
    ["components/SettingsPage.tsx", "<SystemSettingsInfo"],
    ["components/SystemSettings.tsx", "<SystemInfo"],
  ]) {
    const source = src(file);
    const start = source.indexOf(element + "\n");
    assert.ok(start >= 0, file + " renders " + element);
    // Its props: up to the "/>" on a line of its own.
    const props = source.slice(start).match(/^[\s\S]*?\n\s*\/>/)[0];
    assert.match(props, /\ssummary=\{summary\}\n/, file);
  }
});
