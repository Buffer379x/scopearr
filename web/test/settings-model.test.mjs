import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";

// The settings pages as data (Phase 5c, task 2): section metadata, unsaved
// changes per tab, service status rows and heads, the rule order, the band
// choice, the palette preview, the column preview and the log filter model.
// The default palette's match with the base sheet is in contrast.test.mjs,
// one of the tests that may read stylesheets (test-layout.test.mjs).

const eventLog = loadSource("event-log.ts");
const themes = loadSource("themes.ts");
const model = loadSource("settings-model.ts", {
  modules: { "./themes": themes, "./event-log": eventLog },
});
// Values from the module's own realm, compared as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));
// The catalog key with its parameters filled in, as t() does in English.
const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));

function navLabels() {
  const storage = loadSource("browser-storage.ts");
  const toolRoute = loadSource("tool-route.ts", {
    modules: { "./browser-storage": storage },
  });
  const instances = loadSource("instances.ts");
  const frameStatus = loadSource("frame-status.ts", {
    modules: {
      "./instances": instances,
      "./tool-route": toolRoute,
      "./tool-table": loadSource("tool-table.ts"),
      "./mux-spec": loadSource("mux-spec.ts", {
        modules: { "./languages.ts": { audioLanguage: () => "" } },
      }),
      "./placement": loadSource("placement.ts"),
      "./filecheck": loadSource("filecheck.ts"),
    },
  });
  const router = loadSource("router.ts", {
    modules: { "./event-log": eventLog, "./tool-route": toolRoute },
  });
  const nav = loadSource("nav-model.ts", {
    modules: {
      "./instances": instances,
      "./frame-status": frameStatus,
      "./router": router,
      "./tool-route": toolRoute,
    },
  });
  const sections = nav.navModel({
    route: { view: "statistics" },
    settings: null,
    status: {},
    translate: (key) => key,
  });
  const settings = sections
    .flatMap((section) => section.nodes)
    .find((node) => node.group === "settings");
  return {
    sections: [...router.SETTINGS_SECTIONS],
    labels: Object.fromEntries(
      settings.children.map((child) => [child.target.section, child.label]),
    ),
  };
}

test("section metadata names every area as the sidebar does", () => {
  const { sections, labels } = navLabels();
  assert.deepEqual(Object.keys(model.SECTION_META), sections);
  for (const section of sections)
    assert.equal(model.SECTION_META[section].title, labels[section], section);
  assert.deepEqual(plain(model.SECTION_META), {
    connections: {
      title: "Services",
      description:
        "Configure connections, synchronization intervals and optional outbound tags.",
      save: "form",
      segment: null,
    },
    appearance: {
      title: "Display",
      description:
        "Choose your interface language, library layout and default columns.",
      save: "form",
      segment: "display",
    },
    widgets: {
      title: "Widgets",
      description:
        "Choose dashboard storage paths, shared groups and chart colors.",
      save: "form",
      segment: null,
    },
    custom: {
      title: "Custom tags",
      description:
        "Create tags here, assign them in your library or use them in filename rules.",
      save: "custom",
      segment: null,
    },
    recognition: {
      title: "Tag rules",
      description:
        "Rules only read filenames. API metadata fills remaining gaps; Media server audio tracks stay separate. No media scans are triggered.",
      save: "rules",
      segment: null,
    },
    system: {
      title: "System",
      description:
        "Check synchronization, manage backups and secure your account. The log shows events from the last 24 hours.",
      save: null,
      segment: "system",
    },
  });
  assert.ok(Object.isFrozen(model.SECTION_META));
});

const savedSettings = () => ({
  interfaceTheme: "default",
  seasonMode: "matches",
  pageSize: 50,
  groupSD: false,
  groupSDLists: false,
  listInfoOrder: ["sync", "issues"],
  listInfoVisible: ["sync"],
  columnOrder: { radarr: ["title", "year"], sonarr: ["title", "year"] },
  visibleColumns: { radarr: ["title"], sonarr: ["title"] },
  filecheckColumnOrder: ["path", "owner"],
  filecheckVisibleColumns: ["path"],
  placementColumnOrder: ["path", "disk"],
  placementVisibleColumns: ["path"],
  tagColors: { "resolution:1080p": "#336699" },
  tagTextColors: {},
  hiddenTags: {},
  warningColors: { metadata: "#ff0000" },
  syncTimezone: "",
});
const drafts = (changes = {}) => ({
  locale: "en",
  savedLocale: "en",
  prefs: { density: "comfortable", stacked: false },
  savedPrefs: { density: "comfortable", stacked: false },
  mode: "dark",
  savedMode: "dark",
  band: null,
  savedBand: null,
  ...changes,
});

test("display tabs report their own unsaved changes", () => {
  const saved = savedSettings();
  const dirty = (cfg, extra) =>
    plain(model.displayDirty(cfg, saved, drafts(extra)));
  const none = { general: false, lists: false, colors: false };
  assert.deepEqual(dirty(savedSettings()), none);
  // A change of a field the page does not show on these tabs is clean.
  assert.deepEqual(dirty({ ...savedSettings(), syncTimezone: "UTC" }), none);
  assert.deepEqual(
    dirty(savedSettings(), {
      prefs: { density: "compact", stacked: false },
    }),
    { general: true, lists: false, colors: false },
  );
  assert.deepEqual(
    dirty(savedSettings(), {
      prefs: { density: "comfortable", stacked: true },
    }),
    { general: false, lists: true, colors: false },
  );
  assert.deepEqual(
    dirty({ ...savedSettings(), warningColors: { metadata: "#00ff00" } }),
    { general: false, lists: false, colors: true },
  );
  assert.deepEqual(dirty(savedSettings(), { locale: "de" }), {
    general: true,
    lists: false,
    colors: false,
  });
  for (const [key, value] of [
    ["interfaceTheme", "nord"],
    ["seasonMode", "season"],
    ["pageSize", 100],
    ["groupSD", true],
    ["groupSDLists", true],
  ])
    assert.deepEqual(
      dirty({ ...savedSettings(), [key]: value }),
      { general: true, lists: false, colors: false },
      key,
    );
  for (const [key, value] of [
    ["listInfoOrder", ["issues", "sync"]],
    ["listInfoVisible", ["sync", "issues"]],
    ["columnOrder", { radarr: ["title", "year"], sonarr: ["year", "title"] }],
    ["visibleColumns", { radarr: ["title", "year"], sonarr: ["title"] }],
    ["filecheckColumnOrder", ["owner", "path"]],
    ["filecheckVisibleColumns", ["path", "owner"]],
    ["placementColumnOrder", ["disk", "path"]],
    ["placementVisibleColumns", []],
  ])
    assert.deepEqual(
      dirty({ ...savedSettings(), [key]: value }),
      { general: false, lists: true, colors: false },
      key,
    );
  for (const [key, value] of [
    ["tagColors", {}],
    ["tagTextColors", { "resolution:1080p": "#000000" }],
    ["hiddenTags", { "resolution:1080p": true }],
  ])
    assert.deepEqual(
      dirty({ ...savedSettings(), [key]: value }),
      { general: false, lists: false, colors: true },
      key,
    );
  // Mode and band are drafts of the General tab until Save (ruling P1).
  assert.deepEqual(dirty(savedSettings(), { mode: "light" }), {
    general: true,
    lists: false,
    colors: false,
  });
  assert.deepEqual(dirty(savedSettings(), { band: "strong" }), {
    general: true,
    lists: false,
    colors: false,
  });
  assert.deepEqual(dirty(savedSettings(), { band: null, savedBand: "muted" }), {
    general: true,
    lists: false,
    colors: false,
  });
  assert.deepEqual(
    dirty(savedSettings(), {
      mode: "light",
      savedMode: "light",
      band: "muted",
      savedBand: "muted",
    }),
    none,
  );
});

test("columns tabs report their own unsaved changes", () => {
  const saved = savedSettings();
  const dirty = (changes) =>
    plain(model.columnsDirty({ ...savedSettings(), ...changes }, saved));
  const none = {
    icons: false,
    radarr: false,
    sonarr: false,
    filecheck: false,
    placement: false,
  };
  assert.deepEqual(dirty({}), none);
  assert.deepEqual(
    dirty({
      columnOrder: { radarr: ["year", "title"], sonarr: ["title", "year"] },
    }),
    { ...none, radarr: true },
  );
  assert.deepEqual(
    dirty({ visibleColumns: { radarr: ["title"], sonarr: [] } }),
    { ...none, sonarr: true },
  );
  assert.deepEqual(dirty({ placementVisibleColumns: ["path", "disk"] }), {
    ...none,
    placement: true,
  });
  assert.deepEqual(dirty({ placementColumnOrder: ["disk", "path"] }), {
    ...none,
    placement: true,
  });
  assert.deepEqual(dirty({ filecheckVisibleColumns: [] }), {
    ...none,
    filecheck: true,
  });
  assert.deepEqual(dirty({ listInfoVisible: [] }), { ...none, icons: true });
  assert.deepEqual(dirty({ listInfoOrder: ["issues", "sync"] }), {
    ...none,
    icons: true,
  });
});

const rule = (id, name, extra = {}) => ({
  id,
  name,
  field: "channels",
  match: "token",
  pattern: "x",
  value: "",
  mode: "direct",
  priority: 100,
  enabled: true,
  consume: false,
  ...extra,
});
const names = (rules) => plain(rules).map((r) => r.name);

test("rules with the same priority sort naturally", () => {
  const channels = [
    rule("default-channels-24", "Channels / 7.1"),
    rule("default-channels-6-1", "Channels / 6.1"),
    rule("default-channels-1-0", "Channels / 1.0"),
    rule("default-channels-25", "Channels / 2.0"),
    rule("default-channels-26", "Channels / 5.1"),
  ];
  assert.deepEqual(names(model.sortRules(channels, null, {})), [
    "Channels / 1.0",
    "Channels / 2.0",
    "Channels / 5.1",
    "Channels / 6.1",
    "Channels / 7.1",
  ]);
  // The input stays as it was.
  assert.deepEqual(
    channels.map((r) => r.name),
    [
      "Channels / 7.1",
      "Channels / 6.1",
      "Channels / 1.0",
      "Channels / 2.0",
      "Channels / 5.1",
    ],
  );
  const resolutions = [
    rule("default-resolution-2160p", "Resolution / 2160p"),
    rule("default-resolution-576p", "Resolution / 576p"),
    rule("default-resolution-1080p", "Resolution / 1080p"),
  ];
  assert.deepEqual(
    names(
      model.sortRules(resolutions, { field: "priority", direction: "asc" }, {}),
    ),
    ["Resolution / 576p", "Resolution / 1080p", "Resolution / 2160p"],
  );
  // desc reverses only the main key; ties stay in natural ascending order.
  const mixed = [
    rule("b", "Resolution / 2160p"),
    rule("a", "Resolution / 576p", { priority: 200 }),
    rule("c", "Resolution / 1080p"),
    rule("d", "Resolution / 720p", { priority: 200 }),
  ];
  assert.deepEqual(
    names(model.sortRules(mixed, { field: "priority", direction: "desc" }, {})),
    [
      "Resolution / 576p",
      "Resolution / 720p",
      "Resolution / 1080p",
      "Resolution / 2160p",
    ],
  );
  assert.deepEqual(
    names(model.sortRules(mixed, { field: "priority", direction: "asc" }, {})),
    [
      "Resolution / 1080p",
      "Resolution / 2160p",
      "Resolution / 576p",
      "Resolution / 720p",
    ],
  );
  // The same name falls back to the ID.
  assert.deepEqual(
    plain(
      model.sortRules(
        [rule("z", "Same"), rule("m", "Same"), rule("a", "Same")],
        null,
        {},
      ),
    ).map((r) => r.id),
    ["a", "m", "z"],
  );
  // Case and accents tie as in the natural order (sensitivity base).
  assert.equal(model.naturalCompare("abc", "ABC"), 0);
  assert.ok(model.naturalCompare("Channels / 2.0", "Channels / 10.0") < 0);
  assert.ok(model.naturalCompare("b", "a") > 0);
  // Other keys as 1.7.0: the tag as a boolean, a custom value by its name.
  const tagged = [
    rule("t1", "With tag", { tag: true }),
    rule("t2", "Without tag", { tag: false }),
    rule("t3", "Default tag"),
  ];
  assert.deepEqual(
    names(model.sortRules(tagged, { field: "tag", direction: "asc" }, {})),
    ["Without tag", "Default tag", "With tag"],
  );
  const values = [
    rule("v1", "Custom", { field: "custom", value: "tag-1" }),
    rule("v2", "Plain", { field: "resolution", value: "Beta" }),
    rule("v3", "Other", { field: "resolution", value: "Alpha" }),
  ];
  assert.deepEqual(
    names(
      model.sortRules(
        values,
        { field: "value", direction: "asc" },
        { "tag-1": "Zeta" },
      ),
    ),
    ["Other", "Plain", "Custom"],
  );
  assert.deepEqual(
    names(
      model.sortRules(
        values,
        { field: "value", direction: "desc" },
        { "tag-1": "Aardvark" },
      ),
    ),
    ["Plain", "Other", "Custom"],
  );
});

// rc.2: Name, Pattern and Result sort naturally too (576p before 1080p);
// desc reverses them, ties stay by name, then ID; the other keys keep
// their 1.7.0 order.
test("rule names, patterns and results sort naturally", () => {
  const res = [
    rule("a", "Resolution / 2160p", { pattern: "2160p", value: "2160p" }),
    rule("b", "Resolution / 1080p", { pattern: "1080p", value: "1080p" }),
    rule("c", "Resolution / 576p", { pattern: "576p", value: "576p" }),
  ];
  const by = (field, direction = "asc", list = res) =>
    names(model.sortRules(list, { field, direction }, {}));
  assert.deepEqual(by("name"), [
    "Resolution / 576p",
    "Resolution / 1080p",
    "Resolution / 2160p",
  ]);
  assert.deepEqual(by("name", "desc"), [
    "Resolution / 2160p",
    "Resolution / 1080p",
    "Resolution / 576p",
  ]);
  assert.deepEqual(by("pattern"), [
    "Resolution / 576p",
    "Resolution / 1080p",
    "Resolution / 2160p",
  ]);
  assert.deepEqual(by("value"), [
    "Resolution / 576p",
    "Resolution / 1080p",
    "Resolution / 2160p",
  ]);
  // A custom result by its tag name, naturally.
  const custom = [
    rule("x", "X", { field: "custom", value: "t10" }),
    rule("y", "Y", { field: "custom", value: "t2" }),
  ];
  assert.deepEqual(
    names(
      model.sortRules(
        custom,
        { field: "value", direction: "asc" },
        { t10: "Tag 10", t2: "Tag 2" },
      ),
    ),
    ["Y", "X"],
  );
  // Ties unchanged: the same pattern lists by name, then by ID.
  const ties = [
    rule("z", "Same", { pattern: "p" }),
    rule("m", "Other 10", { pattern: "p" }),
    rule("a", "Other 9", { pattern: "p" }),
    rule("b", "Same", { pattern: "p" }),
  ];
  assert.deepEqual(
    plain(
      model.sortRules(ties, { field: "pattern", direction: "desc" }, {}),
    ).map((r) => r.id),
    ["a", "m", "b", "z"],
  );
  // The field column keeps the 1.7.0 text order ("Resolution" > "Channels").
  assert.deepEqual(
    by("field", "asc", [
      rule("r", "R", { field: "resolution" }),
      rule("c", "C", { field: "channels" }),
    ]),
    ["C", "R"],
  );
});

test("service status rows are fixed per kind", () => {
  const rows = (kind) => plain(model.statusRows(kind));
  assert.deepEqual(rows("arr"), [
    "status",
    "files",
    "next",
    "webhook",
    "external",
    "tags",
  ]);
  assert.deepEqual(rows("media"), ["status", "files", "next", "tags"]);
  const tool = [
    "status",
    "installed",
    "available",
    "upstream",
    "checked",
    "size",
  ];
  assert.deepEqual(rows("mux"), tool);
  assert.deepEqual(rows("mediainfo"), tool);
  assert.deepEqual(rows("unraid"), ["status", "mover", "disks"]);
  assert.ok(Object.isFrozen(model.statusRows("arr")));
  assert.deepEqual(
    ["radarr", "sonarr", "emby", "jellyfin", "mux", "mediainfo", "unraid"].map(
      model.serviceKind,
    ),
    ["arr", "arr", "media", "media", "mux", "mediainfo", "unraid"],
  );
  assert.deepEqual(
    [
      "status",
      "files",
      "next",
      "webhook",
      "external",
      "tags",
      "installed",
      "available",
      "upstream",
      "checked",
      "size",
      "mover",
      "disks",
    ].map(model.statusLabel),
    [
      "Status",
      "Files",
      "Next sync",
      "Realtime updates",
      "External tags",
      "Tag synchronization",
      "Installed version",
      "Available version",
      "Upstream version",
      "Last check",
      "Size",
      "Mover / parity state",
      "Disks",
    ],
  );
});

test("service heads read the sync state", () => {
  const head = (row) => plain(model.serviceHead(row, t));
  assert.deepEqual(head({ enabled: false, state: "off", text: "Disabled" }), {
    tone: "neutral",
    text: "Disabled",
    long: "Disabled",
  });
  assert.deepEqual(
    head({ enabled: true, state: "off", text: "Last sync: never" }),
    { tone: "neutral", text: "Not synced yet", long: "Last sync: never" },
  );
  assert.deepEqual(
    head({ enabled: true, state: "running", text: "Sync in progress …" }),
    { tone: "running", text: "Running", long: "Sync in progress …" },
  );
  assert.deepEqual(
    head({ enabled: true, state: "error", text: "Sync failed · timeout" }),
    { tone: "error", text: "Error", long: "Sync failed · timeout" },
  );
  assert.deepEqual(
    head({ enabled: true, state: "ok", text: "Last sync: 12.11.2026" }),
    { tone: "ok", text: "Ready", long: "Last sync: 12.11.2026" },
  );
  // Before the status answers: the reserved dash.
  assert.deepEqual(head(undefined), {
    tone: "neutral",
    text: "—",
    long: "—",
  });
});

test("service values give one set of texts for the card and System → Info", () => {
  // Task 9 (B12): the status texts of a library or media server, shared by
  // its Services card and its System → Info block.
  const format = { date: (value) => "D(" + value + ")", count: (n) => "#" + n };
  const values = (instance, status) =>
    plain(model.serviceValues(instance, status, t, format));
  const radarr = {
    id: "radarr",
    type: "radarr",
    webhookEnabled: true,
    tagImport: true,
    tagSync: { resolution: true },
  };
  // Nothing known yet: no files, no next sync, the enabled parts with
  // their placeholders, nothing to review.
  assert.deepEqual(values(radarr, {}), {
    last: "",
    webhook: "Last webhook update: D(undefined) · 0 pending",
    external: true,
    tags: "Last sync: D(undefined)",
    review: false,
    webhookError: false,
    tagsError: false,
  });
  // A failed sync with a last success, its files, the next sync, a webhook
  // error, a waiting tag sync with retained definitions and a review.
  const status = {
    sync: { radarr: { count: 1200, error: "timeout", lastSuccess: "a" } },
    nextSync: { radarr: "n" },
    webhook: { radarr: { pending: 3, error: "Webhook rejected" } },
    tagSync: {
      radarr: {
        pending: true,
        retainedDefinitions: 2,
        approvalRequired: true,
      },
    },
  };
  assert.deepEqual(values(radarr, status), {
    last: " · Last successful sync: D(a)",
    files: "#1200 files in cache",
    next: "D(n)",
    webhook: "Webhook rejected · 3 pending",
    external: true,
    tags: "Tag synchronization pending … · 2 tag definitions retained because the service still uses them.",
    review: true,
    webhookError: true,
    tagsError: false,
  });
  // The tag sync's error, then its run, before the wait.
  const tags = (state) => values(radarr, { tagSync: { radarr: state } }).tags;
  assert.equal(tags({ error: "No access", running: true }), "No access");
  assert.equal(
    values(radarr, { tagSync: { radarr: { error: "No access" } } }).tagsError,
    true,
  );
  assert.equal(
    tags({ running: true, pending: true }),
    "Tag synchronization in progress …",
  );
  assert.equal(tags({ lastSuccess: "s" }), "Last sync: D(s)");
  // Off parts are null (Disabled); a tag sync without groups is on while
  // it has work or a state to show.
  const off = { id: "sonarr", type: "sonarr", tagSync: { hdr: false } };
  assert.deepEqual(values(off, { sync: { sonarr: { count: 0 } } }), {
    last: "",
    files: "#0 files in cache",
    webhook: null,
    external: false,
    tags: null,
    review: false,
    webhookError: false,
    tagsError: false,
  });
  assert.equal(
    values(off, { tagSync: { sonarr: { approvalRequired: true } } }).tags,
    "Last sync: D(undefined)",
  );
  // A media server counts matched files; no last success without an error.
  assert.deepEqual(
    values(
      { id: "emby", type: "emby" },
      { sync: { emby: { count: 4, lastSuccess: "b", error: "" } } },
    ),
    {
      last: "",
      files: "4 files matched",
      webhook: null,
      external: false,
      tags: null,
      review: false,
      webhookError: false,
      tagsError: false,
    },
  );
});

test("tool and Unraid heads read their status", () => {
  const tool = (changes) => ({
    installed: false,
    version: "",
    package: "",
    channel: "stable",
    branch: "",
    arch: "",
    available: "",
    updateAvailable: false,
    upstream: "",
    busy: "",
    error: "",
    sizeBytes: 0,
    ...changes,
  });
  const head = (status) => plain(model.toolHead(status, t));
  assert.deepEqual(head(tool({ installed: true, busy: "install" })), {
    tone: "running",
    text: "Working…",
    long: "Working…",
  });
  assert.deepEqual(
    head(tool({ installed: true, error: "MKVToolNix self-test failed" })),
    { tone: "error", text: "Error", long: "MKVToolNix self-test failed" },
  );
  assert.deepEqual(head(tool({ installed: true })), {
    tone: "ok",
    text: "Installed",
    long: "Installed",
  });
  assert.deepEqual(head(tool({})), {
    tone: "neutral",
    text: "Not installed",
    long: "Not installed",
  });
  assert.deepEqual(head(undefined), { tone: "neutral", text: "—", long: "—" });
  // The error text passes through the catalog.
  assert.equal(
    model.toolHead(tool({ error: "Disk full" }), (key) => "[" + key + "]").long,
    "[Disk full]",
  );

  const state = { known: true, mover: false, parity: false };
  const unraid = (changes) => ({
    enabled: true,
    ready: true,
    disks: [],
    state,
    fileWork: "",
    ...changes,
  });
  const uhead = (status, enabled = true) =>
    plain(model.unraidHead(status, enabled, t));
  assert.deepEqual(uhead(unraid({}), false), {
    tone: "neutral",
    text: "Disabled",
    long: "Disabled",
  });
  assert.deepEqual(
    uhead(unraid({ ready: false, error: "var.ini not found" }), false),
    { tone: "neutral", text: "Disabled", long: "Disabled" },
  );
  assert.deepEqual(
    uhead(unraid({ ready: false, error: "var.ini not found" })),
    {
      tone: "error",
      text: "Error",
      long: "var.ini not found",
    },
  );
  assert.deepEqual(uhead(unraid({})), {
    tone: "ok",
    text: "Ready",
    long: "Ready",
  });
  assert.deepEqual(uhead(unraid({ ready: false })), {
    tone: "neutral",
    text: "—",
    long: "—",
  });
  assert.deepEqual(uhead(null), { tone: "neutral", text: "—", long: "—" });
  assert.deepEqual(uhead(null, false), {
    tone: "neutral",
    text: "Disabled",
    long: "Disabled",
  });

  assert.equal(
    model.moverKey({ known: true, mover: true, parity: true }),
    "Mover is running",
  );
  assert.equal(
    model.moverKey({ known: true, mover: false, parity: true }),
    "Parity operation in progress",
  );
  assert.equal(model.moverKey(state), "Idle");
  assert.equal(
    model.moverKey({ known: false, mover: false, parity: false }),
    "Mover/parity state unknown",
  );
  assert.equal(model.moverKey(undefined), "Mover/parity state unknown");
});

test("the band choice shows the resolved band and whether it is stored", () => {
  const choice = (theme, stored) => plain(model.bandChoice(theme, stored));
  assert.deepEqual(choice("dark", null), { value: "muted", stored: false });
  assert.deepEqual(choice("light", null), { value: "strong", stored: false });
  assert.deepEqual(choice("dark", "strong"), { value: "strong", stored: true });
  assert.deepEqual(choice("light", "muted"), { value: "muted", stored: true });
  // The same default as the frame's own band (appearance.ts).
  const appearance = loadSource("appearance.ts", {
    modules: { "./browser-storage": loadSource("browser-storage.ts") },
  });
  for (const theme of ["dark", "light"])
    for (const stored of [null, "strong", "muted"])
      assert.equal(
        model.bandChoice(theme, stored).value,
        appearance.resolveBand(theme, stored),
        theme + " " + stored,
      );
});

const PALETTE_KEYS = [
  "bg",
  "panel",
  "panel2",
  "line",
  "text",
  "muted",
  "accent",
  "accent-bg",
  "accent-text",
];
const STATUS_KEYS = ["ok", "warn", "wait", "error", "info"];

test("palette previews carry all nine keys and five status tokens", () => {
  const style = plain(model.previewStyle("nord", "light"));
  assert.equal(Object.keys(style).length, 14);
  assert.deepEqual(Object.keys(style), [
    ...PALETTE_KEYS.map((key) => "--" + key),
    ...STATUS_KEYS.map((key) => "--status-" + key),
  ]);
  assert.equal(style["--accent"], themes.themePalettes.nord.light.accent);
  for (const key of PALETTE_KEYS)
    assert.equal(style["--" + key], themes.themePalettes.nord.light[key], key);
  for (const key of STATUS_KEYS)
    assert.equal(
      style["--status-" + key],
      model.STATUS_TOKENS.light["status-" + key],
      key,
    );
  const fallback = plain(model.previewStyle("default", "dark"));
  assert.equal(Object.keys(fallback).length, 14);
  for (const key of PALETTE_KEYS)
    assert.equal(fallback["--" + key], model.DEFAULT_PALETTE.dark[key], key);
  // An unknown palette previews the default, as applyInterfaceTheme does.
  assert.deepEqual(plain(model.previewStyle("unknown", "light")), {
    ...plain(model.previewStyle("default", "light")),
  });
  // Every palette in both modes: 14 colors.
  for (const name of themes.interfaceThemes)
    for (const mode of ["dark", "light"]) {
      const values = Object.values(plain(model.previewStyle(name, mode)));
      assert.equal(values.length, 14, name + " " + mode);
      assert.ok(
        values.every((value) => /^#[0-9a-f]{3,8}$/i.test(value)),
        name + " " + mode,
      );
    }
  assert.deepEqual(plain(model.paletteDots("nord", "dark")), [
    "#2e3440",
    "#434c5e",
    "#88c0d0",
    "#eceff4",
  ]);
  assert.deepEqual(plain(model.paletteDots("default", "light")), [
    model.DEFAULT_PALETTE.light.bg,
    model.DEFAULT_PALETTE.light.panel2,
    model.DEFAULT_PALETTE.light.accent,
    model.DEFAULT_PALETTE.light.text,
  ]);
});

test("the column preview numbers only visible columns in order", () => {
  assert.deepEqual(
    plain(
      model.columnPreview(
        ["title", "year", "resolution", "size", "codec"],
        ["codec", "title", "size"],
        { title: "Title", year: "Year", size: "Size", codec: "Codec" },
      ),
    ),
    [
      { key: "title", label: "Title", n: 1 },
      { key: "size", label: "Size", n: 2 },
      { key: "codec", label: "Codec", n: 3 },
    ],
  );
  // A key without a label shows the key.
  assert.deepEqual(plain(model.columnPreview(["a", "b"], ["b"], {})), [
    { key: "b", label: "b", n: 1 },
  ]);
  assert.deepEqual(plain(model.columnPreview(["a"], [], { a: "A" })), []);
});

test("log drafts apply once and keep the search", () => {
  assert.equal(
    model.logCountPath(
      { q: "sync" },
      { level: ["error"], source: ["mux"], instance: [] },
    ),
    "events?q=sync&level=error&source=mux&limit=1",
  );
  assert.equal(
    model.logCountPath(
      { q: "  a&b  ", level: ["info"] },
      { level: [], source: [], instance: ["radarr-1", "sonarr 2"] },
    ),
    "events?q=a%26b&instance=radarr-1&instance=sonarr+2&limit=1",
  );
  assert.equal(
    model.logCountPath({}, { level: [], source: [], instance: [] }),
    "events?limit=1",
  );
  const filter = {
    q: "sync",
    level: ["error"],
    source: ["mux"],
    instance: ["radarr-1"],
  };
  const draft = model.logDraft(filter);
  assert.deepEqual(plain(draft), {
    level: ["error"],
    source: ["mux"],
    instance: ["radarr-1"],
  });
  // The draft is a copy: changing it leaves the filter as it was.
  draft.level.push("info");
  assert.deepEqual(filter.level, ["error"]);
  assert.deepEqual(plain(model.logDraft({})), {
    level: [],
    source: [],
    instance: [],
  });
  assert.deepEqual(
    plain(
      model.logApply(filter, {
        level: ["warning", "info"],
        source: [],
        instance: ["sonarr-1"],
      }),
    ),
    { q: "sync", level: ["warning", "info"], instance: ["sonarr-1"] },
  );
  // An empty draft removes the fields; the search stays.
  assert.deepEqual(
    plain(model.logApply(filter, { level: [], source: [], instance: [] })),
    { q: "sync" },
  );
  assert.deepEqual(
    plain(
      model.logApply(
        { level: ["error"] },
        { level: [], source: ["sync"], instance: [] },
      ),
    ),
    { source: ["sync"] },
  );
});

const logLabels = {
  level: (value) => eventLog.levelLabel[value] || value,
  source: (value) => eventLog.eventSources[value] || value,
  instance: (value) => ({ "radarr-1": "Movies 4K" })[value] || value,
};

test("log groups list counted values and keep chosen ones", () => {
  const counts = {
    level: { error: 2, info: 7 },
    source: { sync: 4, mux: 5 },
    instance: { "radarr-1": 3 },
  };
  assert.deepEqual(plain(model.logGroups(counts, {}, logLabels, t)), [
    {
      key: "level",
      label: "Level",
      options: [
        { value: "error", label: "Error", count: 2 },
        { value: "warning", label: "Warning", count: 0 },
        { value: "info", label: "Info", count: 7 },
      ],
    },
    {
      key: "source",
      label: "Source",
      options: [
        { value: "sync", label: "Synchronization", count: 4 },
        { value: "mux", label: "Mux", count: 5 },
      ],
    },
    {
      key: "instance",
      label: "Service",
      options: [{ value: "radarr-1", label: "Movies 4K", count: 3 }],
    },
  ]);
  // A chosen source and service without entries stay, with the count 0.
  const empty = { level: {}, source: {}, instance: {} };
  assert.deepEqual(
    plain(
      model.logGroups(
        empty,
        { source: ["webhook"], instance: ["sonarr-2"] },
        logLabels,
        t,
      ),
    ).slice(1),
    [
      {
        key: "source",
        label: "Source",
        options: [{ value: "webhook", label: "Webhooks", count: 0 }],
      },
      {
        key: "instance",
        label: "Service",
        options: [{ value: "sonarr-2", label: "sonarr-2", count: 0 }],
      },
    ],
  );
  // Without counts or a choice there is no service group.
  assert.deepEqual(
    plain(model.logGroups(empty, {}, logLabels, t)).map((group) => group.key),
    ["level", "source"],
  );
  assert.deepEqual(
    plain(model.logGroups(empty, {}, logLabels, t))[1].options,
    [],
  );
  // Counted and chosen services once each, the counted ones first.
  assert.deepEqual(
    plain(
      model.logGroups(
        counts,
        { instance: ["sonarr-2", "radarr-1"] },
        logLabels,
        t,
      ),
    )[2].options.map((option) => option.value),
    ["radarr-1", "sonarr-2"],
  );
});

test("log chips keep the 1.7.0 labels and order", () => {
  const chips = plain(
    model.logChips(
      { q: "sync", level: ["error"], source: ["sync"] },
      logLabels,
      t,
    ),
  );
  assert.deepEqual(
    chips.map((chip) => chip.label),
    ["Search: sync", "Error", "Synchronization"],
  );
  assert.deepEqual(chips, [
    { key: "q", label: "Search: sync", field: "q", value: "sync" },
    { key: "level:error", label: "Error", field: "level", value: "error" },
    {
      key: "source:sync",
      label: "Synchronization",
      field: "source",
      value: "sync",
    },
  ]);
  assert.deepEqual(
    plain(
      model.logChips(
        { q: "", instance: ["radarr-1"], level: ["warning", "info"] },
        logLabels,
        t,
      ),
    ).map((chip) => chip.key),
    ["level:warning", "level:info", "instance:radarr-1"],
  );
  assert.deepEqual(plain(model.logChips({}, logLabels, t)), []);
});
