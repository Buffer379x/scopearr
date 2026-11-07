import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";
import { fakeWindow } from "./helpers/fake-window.mjs";
import { src } from "./helpers/sources.mjs";

// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));

// A localStorage with a write log. `blocked` makes every access throw, as a
// browser does with blocked site data; `full` makes writes throw.
function fakeStorage(entries = {}, { blocked = false, full = false } = {}) {
  const values = new Map(Object.entries(entries)),
    writes = [];
  const guard = () => {
    if (blocked) throw new Error("SecurityError: storage blocked");
  };
  return {
    values,
    writes,
    localStorage: {
      getItem(key) {
        guard();
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        guard();
        writes.push(["set", key, String(value)]);
        if (full) throw new Error("QuotaExceededError");
        values.set(key, String(value));
      },
      removeItem(key) {
        guard();
        writes.push(["remove", key]);
        values.delete(key);
      },
    },
  };
}
// A fresh module per storage, so no state leaks between cases. Without a
// storage the module runs where `localStorage` does not exist at all.
function withStorage(path, storage) {
  const browserStorage = loadSource("browser-storage.ts", {
    browser: storage ? { localStorage: storage.localStorage } : {},
  });
  return loadSource(path, { modules: { "./browser-storage": browserStorage } });
}
// The root element: attributes only.
function fakeRoot(attributes = {}) {
  const values = new Map(Object.entries(attributes));
  return {
    values,
    setAttribute: (name, value) => values.set(name, String(value)),
    getAttribute: (name) => (values.has(name) ? values.get(name) : null),
  };
}

test("the sidebar mode follows width and choice", () => {
  const { sidebarMode } = withStorage("sidebar-state.ts");
  for (const [width, preference, mode] of [
    // Phones always get the drawer, whatever was chosen.
    [320, null, "drawer"],
    [739, null, "drawer"],
    [739, "expanded", "drawer"],
    [739, "rail", "drawer"],
    // Without a choice: the rail up to 1599, expanded from 1600.
    [740, null, "rail"],
    [1119, null, "rail"],
    [1599, null, "rail"],
    [1599.5, null, "rail"],
    [1600, null, "expanded"],
    [2560, null, "expanded"],
    // A choice holds from 740 on.
    [1600, "rail", "rail"],
    [800, "expanded", "expanded"],
    [740, "expanded", "expanded"],
    [1599, "rail", "rail"],
  ])
    assert.equal(
      sidebarMode(width, preference),
      mode,
      width + " " + preference,
    );
});

test("sidebar storage ignores broken values", () => {
  const defaults = { movies: true, series: true, settings: false };
  // Valid values round-trip under their keys.
  const storage = fakeStorage();
  const sidebar = withStorage("sidebar-state.ts", storage);
  assert.equal(sidebar.readSidebarPreference(), null);
  assert.deepEqual(plain(sidebar.readSidebarGroups()), defaults);
  sidebar.writeSidebarPreference("rail");
  assert.equal(storage.values.get("scopearr-sidebar"), "rail");
  assert.equal(sidebar.readSidebarPreference(), "rail");
  sidebar.writeSidebarPreference("expanded");
  assert.equal(sidebar.readSidebarPreference(), "expanded");
  sidebar.writeSidebarGroups({ movies: false, series: true, settings: true });
  assert.deepEqual(JSON.parse(storage.values.get("scopearr-sidebar-groups")), {
    movies: false,
    series: true,
    settings: true,
  });
  assert.deepEqual(plain(sidebar.readSidebarGroups()), {
    movies: false,
    series: true,
    settings: true,
  });
  // Each read is a new object: changing it changes neither storage nor the
  // defaults.
  const groups = withStorage("sidebar-state.ts", fakeStorage());
  groups.readSidebarGroups().movies = false;
  assert.deepEqual(plain(groups.readSidebarGroups()), defaults);

  // Nonsense, JSON errors and wrong types fall back to the defaults, key by
  // key.
  for (const value of ["auto", "", "Expanded", "drawer", " rail"])
    assert.equal(
      withStorage(
        "sidebar-state.ts",
        fakeStorage({ "scopearr-sidebar": value }),
      ).readSidebarPreference(),
      null,
      JSON.stringify(value),
    );
  for (const [value, expected] of [
    ["{", defaults],
    ["nonsense", defaults],
    ["null", defaults],
    ["[]", defaults],
    ["[true,false]", defaults],
    ["42", defaults],
    ['"movies"', defaults],
    ['{"movies":"no","series":0,"settings":null}', defaults],
    ['{"movies":false}', { ...defaults, movies: false }],
    ['{"settings":true,"other":false}', { ...defaults, settings: true }],
  ])
    assert.deepEqual(
      plain(
        withStorage(
          "sidebar-state.ts",
          fakeStorage({ "scopearr-sidebar-groups": value }),
        ).readSidebarGroups(),
      ),
      expected,
      value,
    );

  // Blocked, full or missing storage: defaults and no exception.
  for (const blocked of [
    fakeStorage({ "scopearr-sidebar": "rail" }, { blocked: true }),
    fakeStorage({}, { full: true }),
    undefined,
  ]) {
    const state = withStorage("sidebar-state.ts", blocked);
    assert.equal(state.readSidebarPreference(), null);
    assert.deepEqual(plain(state.readSidebarGroups()), defaults);
    assert.doesNotThrow(() => state.writeSidebarPreference("expanded"));
    assert.doesNotThrow(() =>
      state.writeSidebarGroups({
        movies: false,
        series: false,
        settings: true,
      }),
    );
  }
});

test("flyout follows pointer, focus and touch", () => {
  const flyout = withStorage("flyout.ts");
  const { flyoutNext, FLYOUT_OPEN_DELAY, FLYOUT_CLOSE_DELAY } = flyout;
  assert.equal(FLYOUT_OPEN_DELAY, 150);
  assert.equal(FLYOUT_CLOSE_DELAY, 220);
  const at = (phase, item = null) => ({ phase, item });
  const rail = at("rail");
  const step = (state, input) => plain(flyoutNext(state, input));
  const expect = (state, input, next, wait, name) =>
    assert.deepEqual(
      step(state, input),
      { state: next, wait },
      name || JSON.stringify([state, input]),
    );

  // Pointer: hover intent, then open; a pass-through never opens.
  expect(rail, { type: "enter", item: "movies" }, at("peek", "movies"), 150);
  expect(at("peek", "movies"), { type: "timeout" }, at("open", "movies"), 0);
  expect(at("peek", "movies"), { type: "leave" }, rail, 0);
  // Another icon while the intent runs starts it again for that icon.
  expect(
    at("peek", "movies"),
    { type: "enter", item: "settings" },
    at("peek", "settings"),
    150,
  );
  // Open: other icons open at once, no flicker in between.
  expect(
    at("open", "movies"),
    { type: "enter", item: "settings" },
    at("open", "settings"),
    0,
  );
  expect(
    at("open", "movies"),
    { type: "enter", item: "movies" },
    at("open", "movies"),
    0,
  );
  // Leaving waits 220 ms; the trigger, another icon or the flyout itself
  // (the bridge) keep it open.
  expect(at("open", "movies"), { type: "leave" }, at("closing", "movies"), 220);
  expect(
    at("closing", "movies"),
    { type: "enter", item: "movies" },
    at("open", "movies"),
    0,
  );
  expect(
    at("closing", "movies"),
    { type: "enter", item: "mux" },
    at("open", "mux"),
    0,
  );
  expect(
    at("closing", "movies"),
    { type: "flyoutenter" },
    at("open", "movies"),
    0,
  );
  expect(
    at("open", "movies"),
    { type: "flyoutenter" },
    at("open", "movies"),
    0,
  );
  expect(at("closing", "movies"), { type: "timeout" }, rail, 0);
  // Another leave starts the close delay again.
  expect(
    at("closing", "movies"),
    { type: "leave" },
    at("closing", "movies"),
    220,
  );

  // Focus (visible), a click or a tap open at once from every phase, and a
  // click never closes; dismiss always closes.
  const phases = [
    rail,
    at("peek", "movies"),
    at("open", "movies"),
    at("closing", "movies"),
    at("open", "settings"),
  ];
  for (const state of phases) {
    expect(
      state,
      { type: "focus", item: "settings" },
      at("open", "settings"),
      0,
    );
    expect(
      state,
      { type: "press", item: "settings" },
      at("open", "settings"),
      0,
    );
    expect(state, { type: "dismiss" }, rail, 0);
  }

  // Inputs that do not apply change nothing and start no timer.
  expect(rail, { type: "leave" }, rail, 0);
  expect(rail, { type: "flyoutenter" }, rail, 0);
  expect(rail, { type: "timeout" }, rail, 0);
  expect(at("open", "movies"), { type: "timeout" }, at("open", "movies"), 0);
  // Unchanged states are returned as they are (no re-render).
  const open = at("open", "movies");
  assert.equal(flyoutNext(open, { type: "press", item: "movies" }).state, open);
  assert.equal(flyoutNext(rail, { type: "dismiss" }).state, rail);
});

test("the flyout runs on timers without flicker", () => {
  const { createFlyout, FLYOUT_RAIL } = withStorage("flyout.ts");
  assert.deepEqual(plain(FLYOUT_RAIL), { phase: "rail", item: null });
  const run = () => {
    const clock = fakeWindow();
    const seen = [];
    const fly = createFlyout(
      (state) => seen.push(state.phase + (state.item ? ":" + state.item : "")),
      clock.window,
    );
    return { clock, seen, fly, send: (type, item) => fly.send({ type, item }) };
  };

  // Hover intent: opens after 150 ms, not before.
  {
    const { clock, seen, send, fly } = run();
    send("enter", "movies");
    clock.advance(149);
    assert.deepEqual(seen, ["peek:movies"]);
    clock.advance(1);
    assert.deepEqual(seen, ["peek:movies", "open:movies"]);
    assert.deepEqual(plain(fly.state()), { phase: "open", item: "movies" });
    assert.equal(clock.pending(), 0);
  }
  // Passing over an icon never opens it.
  {
    const { clock, seen, send } = run();
    send("enter", "movies");
    clock.advance(100);
    send("leave");
    clock.advance(1000);
    assert.deepEqual(seen, ["peek:movies", "rail"]);
  }
  // Moving between icons while open switches at once; nothing closes in
  // between, and the old close timer never fires.
  {
    const { clock, seen, send } = run();
    send("enter", "movies");
    clock.advance(150);
    send("leave");
    clock.advance(50);
    send("enter", "settings");
    clock.advance(1000);
    send("leave");
    send("enter", "mux");
    clock.advance(1000);
    assert.deepEqual(seen, [
      "peek:movies",
      "open:movies",
      "closing:movies",
      "open:settings",
      "closing:settings",
      "open:mux",
    ]);
  }
  // The bridge: the pointer crosses the gap into the flyout within 220 ms
  // and stays; leaving the flyout closes it 220 ms later.
  {
    const { clock, seen, send } = run();
    send("press", "movies");
    send("leave");
    clock.advance(219);
    send("flyoutenter");
    clock.advance(1000);
    assert.deepEqual(seen, ["open:movies", "closing:movies", "open:movies"]);
    send("leave");
    clock.advance(219);
    assert.equal(seen.at(-1), "closing:movies");
    clock.advance(1);
    assert.equal(seen.at(-1), "rail");
    assert.equal(clock.pending(), 0);
  }
  // Touch: the first tap opens, the next one keeps it open; a tap on an
  // entry dismisses it.
  {
    const { clock, seen, send } = run();
    send("press", "settings");
    send("press", "settings");
    clock.advance(1000);
    assert.deepEqual(seen, ["open:settings"]);
    send("dismiss");
    assert.deepEqual(seen, ["open:settings", "rail"]);
  }
  // Keyboard: focus opens at once, Escape (dismiss) cancels a pending timer.
  {
    const { clock, seen, send, fly } = run();
    send("enter", "movies");
    send("focus", "settings");
    assert.deepEqual(seen, ["peek:movies", "open:settings"]);
    assert.equal(clock.pending(), 0);
    send("leave");
    send("dismiss");
    clock.advance(1000);
    assert.deepEqual(seen, [
      "peek:movies",
      "open:settings",
      "closing:settings",
      "rail",
    ]);
    // stop() drops a pending timer, as on unmount.
    send("enter", "mux");
    fly.stop();
    clock.advance(1000);
    assert.equal(seen.at(-1), "peek:mux");
    assert.equal(clock.pending(), 0);
  }
});

test("appearance resolves defaults and survives blocked storage", () => {
  // Without a choice: dark is muted, light is strong. A stored choice holds
  // for both modes; anything else is no choice.
  const { resolveBand } = withStorage("appearance.ts", fakeStorage());
  assert.equal(resolveBand("dark", null), "muted");
  assert.equal(resolveBand("light", null), "strong");
  for (const band of ["strong", "muted"])
    for (const theme of ["dark", "light"])
      assert.equal(resolveBand(theme, band), band, theme + " " + band);

  const read = (entries) => {
    const appearance = withStorage("appearance.ts", fakeStorage(entries));
    return [appearance.storedTheme(), appearance.storedBand()];
  };
  assert.deepEqual(read({}), ["dark", null]);
  assert.deepEqual(read({ "scopearr-theme": "light" }), ["light", null]);
  assert.deepEqual(
    read({ "scopearr-theme": "dark", "scopearr-band": "strong" }),
    ["dark", "strong"],
  );
  assert.deepEqual(
    read({ "scopearr-theme": "light", "scopearr-band": "muted" }),
    ["light", "muted"],
  );
  for (const nonsense of ["", "blue", "Light", "auto", "vivid", "null"])
    assert.deepEqual(
      read({ "scopearr-theme": nonsense, "scopearr-band": nonsense }),
      ["dark", null],
      JSON.stringify(nonsense),
    );

  // applyAppearance always sets both attributes and writes nothing.
  for (const [entries, theme, band] of [
    [{}, "dark", "muted"],
    [{}, "light", "strong"],
    [{ "scopearr-band": "strong" }, "dark", "strong"],
    [{ "scopearr-band": "muted" }, "light", "muted"],
    [{ "scopearr-band": "vivid" }, "light", "strong"],
  ]) {
    const storage = fakeStorage(entries);
    const appearance = withStorage("appearance.ts", storage);
    const root = fakeRoot({ "data-theme": "light", "data-band": "strong" });
    appearance.applyAppearance(root, theme);
    assert.deepEqual(
      [...root.values].sort(),
      [
        ["data-band", band],
        ["data-theme", theme],
      ],
      JSON.stringify(entries) + " " + theme,
    );
    assert.deepEqual(storage.writes, []);
  }

  // setTheme writes the theme, then applies it with the band.
  {
    const storage = fakeStorage({ "scopearr-theme": "dark" });
    const appearance = withStorage("appearance.ts", storage);
    const root = fakeRoot();
    appearance.setTheme(root, "light");
    assert.deepEqual(storage.writes, [["set", "scopearr-theme", "light"]]);
    assert.equal(root.getAttribute("data-theme"), "light");
    assert.equal(root.getAttribute("data-band"), "strong");
    assert.equal(appearance.storedTheme(), "light");
  }
  // A band choice holds for both modes; null removes it ("use default").
  {
    const storage = fakeStorage({ "scopearr-theme": "dark" });
    const appearance = withStorage("appearance.ts", storage);
    const root = fakeRoot();
    appearance.applyAppearance(root, "dark");
    appearance.setBandPreference(root, "strong");
    assert.equal(storage.values.get("scopearr-band"), "strong");
    assert.equal(root.getAttribute("data-band"), "strong");
    assert.equal(root.getAttribute("data-theme"), "dark");
    appearance.setTheme(root, "light");
    assert.equal(root.getAttribute("data-band"), "strong");
    appearance.setBandPreference(root, "muted");
    assert.equal(root.getAttribute("data-band"), "muted");
    assert.equal(root.getAttribute("data-theme"), "light");
    appearance.setBandPreference(root, null);
    assert.equal(storage.values.has("scopearr-band"), false);
    assert.deepEqual(storage.writes.at(-1), ["remove", "scopearr-band"]);
    assert.equal(root.getAttribute("data-band"), "strong");
    appearance.setTheme(root, "dark");
    assert.equal(root.getAttribute("data-band"), "muted");
  }

  // Blocked or missing storage: dark and muted, without an exception, and
  // the page's own choices still hold until it reloads.
  for (const storage of [fakeStorage({}, { blocked: true }), undefined]) {
    const appearance = withStorage("appearance.ts", storage);
    assert.equal(appearance.storedTheme(), "dark");
    assert.equal(appearance.storedBand(), null);
    const root = fakeRoot();
    assert.doesNotThrow(() => appearance.applyAppearance(root, "dark"));
    assert.equal(root.getAttribute("data-theme"), "dark");
    assert.equal(root.getAttribute("data-band"), "muted");
    assert.doesNotThrow(() => appearance.setTheme(root, "light"));
    assert.equal(root.getAttribute("data-theme"), "light");
    assert.equal(root.getAttribute("data-band"), "strong");
    assert.equal(appearance.storedTheme(), "light");
    assert.doesNotThrow(() => appearance.setBandPreference(root, "muted"));
    assert.equal(root.getAttribute("data-band"), "muted");
    appearance.applyAppearance(root, "dark");
    assert.equal(root.getAttribute("data-band"), "muted");
    appearance.setBandPreference(root, null);
    assert.equal(root.getAttribute("data-band"), "muted");
    appearance.applyAppearance(root, "light");
    assert.equal(root.getAttribute("data-band"), "strong");
  }
  // Full storage: the write fails, the choice still applies.
  {
    const appearance = withStorage(
      "appearance.ts",
      fakeStorage({}, { full: true }),
    );
    const root = fakeRoot();
    assert.doesNotThrow(() => appearance.setBandPreference(root, "strong"));
    assert.equal(root.getAttribute("data-theme"), "dark");
    assert.equal(root.getAttribute("data-band"), "strong");
  }
});

// --- frame-status.ts ---------------------------------------------------------

function frameStatus() {
  const storage = loadSource("browser-storage.ts");
  return loadSource("frame-status.ts", {
    modules: {
      "./instances": loadSource("instances.ts"),
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
}

test("jobs summary counts visible tools only", () => {
  const { jobsSummary } = frameStatus();
  const summary = (status) => plain(jobsSummary(status));
  // Hidden Disk placement jobs count nowhere; visible tools are listed even
  // without open jobs, in the order of the tool table.
  assert.deepEqual(
    summary({
      mux: {
        enabled: true,
        installed: true,
        pending: 1,
        running: 2,
        failed: 1,
      },
      unraid: { enabled: false, pending: 5, running: 1, failed: 3 },
      files: { available: true, pending: 0, running: 0 },
    }),
    {
      count: 4,
      failed: 1,
      tools: [
        { view: "mux", open: 4, running: 2, pending: 1, failed: 1 },
        { view: "files", open: 0, running: 0, pending: 0, failed: 0 },
      ],
    },
  );
  assert.deepEqual(
    summary({
      mux: {
        enabled: false,
        installed: true,
        pending: 3,
        running: 0,
        failed: 2,
      },
      unraid: { enabled: true, pending: 2, failed: 1 },
      files: { available: true, pending: 1, running: 1, failed: 2 },
    }),
    {
      count: 7,
      failed: 3,
      tools: [
        { view: "disks", open: 3, running: 0, pending: 2, failed: 1 },
        { view: "files", open: 4, running: 1, pending: 1, failed: 2 },
      ],
    },
  );
  // No visible tool: nothing to count.
  assert.deepEqual(summary({ demo: false }), {
    count: 0,
    failed: 0,
    tools: [],
  });
  // The count equals the 1.7.0 Tools badge: openJobCount of each visible tool.
  const { openJobCount } = loadSource("tool-table.ts");
  const status = {
    mux: { enabled: true, installed: true, pending: 2, running: 1, failed: 4 },
    unraid: { enabled: true, pending: 1 },
    files: { available: false, pending: 9, running: 9, failed: 9 },
  };
  assert.equal(
    jobsSummary(status).count,
    openJobCount(status.mux) + openJobCount(status.unraid),
  );
});

test("sync summary prefers running, then errors, then the newest sync", () => {
  const { syncSummary } = frameStatus();
  // The catalog key with its parameters filled in, as t() does in English.
  const keys = new Set();
  const translate = (key, params = {}) => {
    keys.add(key);
    return key.replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
  };
  const formatDate = (iso) => "date(" + (iso || "none") + ")";
  const formatTime = (iso) => "time(" + (iso || "none") + ")";
  const settings = {
    instances: [
      { id: "radarr", type: "radarr", name: "", enabled: true },
      { id: "radarr-4k", type: "radarr", name: "Radarr 4K", enabled: true },
      { id: "sonarr", type: "sonarr", name: "", enabled: false },
      { id: "emby", type: "emby", name: "Living room", enabled: true },
    ],
  };
  const summary = (sync) =>
    plain(
      syncSummary(
        { demo: false, sync },
        settings,
        translate,
        formatDate,
        formatTime,
      ),
    );
  const done = {
    radarr: { lastSuccess: "2026-11-07T09:41:00Z", count: 10 },
    "radarr-4k": { lastSuccess: "2026-11-07T10:05:00Z", count: 4 },
    emby: { lastSuccess: "2026-11-07T08:00:00Z", count: 3 },
  };

  // Every enabled instance, with the line of System → Info.
  const ok = summary(done);
  assert.deepEqual(ok, {
    state: "ok",
    text: "Last sync: time(2026-11-07T10:05:00Z)",
    services: [
      {
        id: "radarr",
        label: "Radarr",
        media: false,
        enabled: true,
        state: "ok",
        text: "Last sync: date(2026-11-07T09:41:00Z)",
      },
      {
        id: "radarr-4k",
        label: "Radarr 4K",
        media: false,
        enabled: true,
        state: "ok",
        text: "Last sync: date(2026-11-07T10:05:00Z)",
      },
      {
        id: "emby",
        label: "Living room",
        media: true,
        enabled: true,
        state: "ok",
        text: "Last match: date(2026-11-07T08:00:00Z)",
      },
    ],
  });

  // An error beats an older success elsewhere.
  const failed = summary({
    ...done,
    "radarr-4k": { ...done["radarr-4k"], error: "Radarr is unreachable" },
  });
  assert.equal(failed.state, "error");
  assert.equal(failed.text, "Sync failed · Radarr is unreachable");
  assert.deepEqual(
    failed.services.map((service) => [service.id, service.state, service.text]),
    [
      ["radarr", "ok", "Last sync: date(2026-11-07T09:41:00Z)"],
      ["radarr-4k", "error", "Sync failed · Radarr is unreachable"],
      ["emby", "ok", "Last match: date(2026-11-07T08:00:00Z)"],
    ],
  );

  // A running sync beats errors; a queued one waits for a slot.
  const running = summary({
    ...done,
    radarr: { ...done.radarr, running: true },
    "radarr-4k": { ...done["radarr-4k"], error: "Radarr is unreachable" },
    emby: { ...done.emby, running: true, queued: true },
  });
  assert.equal(running.state, "running");
  assert.equal(running.text, "Sync in progress …");
  assert.deepEqual(
    running.services.map((service) => [service.state, service.text]),
    [
      ["running", "Sync in progress …"],
      ["error", "Sync failed · Radarr is unreachable"],
      ["running", "Sync waiting for a slot …"],
    ],
  );
  const queued = summary({
    ...done,
    emby: { ...done.emby, running: true, queued: true },
  });
  assert.equal(queued.state, "running");
  assert.equal(queued.text, "Sync waiting for a slot …");

  // Never synced: off, with the formatter's text for a missing date.
  const never = summary({});
  assert.equal(never.state, "off");
  assert.equal(never.text, "Last sync: time(none)");
  assert.deepEqual(
    never.services.map((service) => [service.state, service.text]),
    [
      ["off", "Last sync: date(none)"],
      ["off", "Last sync: date(none)"],
      ["off", "Last match: date(none)"],
    ],
  );
  // No settings yet: no services, off.
  assert.deepEqual(
    plain(
      syncSummary({ demo: false }, null, translate, formatDate, formatTime),
    ),
    { state: "off", text: "Last sync: time(none)", services: [] },
  );

  // Every key is one that System → Info uses for the same line.
  const systemInfo = src("components/SystemInfo.tsx");
  assert.ok(keys.size >= 6);
  for (const key of keys)
    if (key !== "Radarr is unreachable")
      assert.ok(systemInfo.includes('"' + key + '"'), key);
});
