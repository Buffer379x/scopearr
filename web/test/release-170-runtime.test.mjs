import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function loadTS(path, modules, globals = {}, transform = (source) => source) {
  const exports = {};
  const source = transform(
    readFileSync(new URL("../src/" + path, import.meta.url), "utf8"),
  );
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        jsxImportSource: "preact",
      },
    }).outputText,
    {
      exports,
      AbortController,
      ...globals,
      require: (path) => modules[path],
    },
  );
  return exports;
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

test("API failures use translated keys for non-JSON, invalid JSON and network responses", async () => {
  const notifications = [],
    events = [];
  let fetcher;
  const { api, ApiError } = loadTS(
    "api.ts",
    {
      "./i18n": { t: (key) => "translated:" + key, getLocale: () => "de" },
      "./notifications": { notify: (...args) => notifications.push(args) },
    },
    {
      fetch: (...args) => fetcher(...args),
      window: { dispatchEvent: (e) => events.push(e.type) },
      Event,
      Error,
      TypeError,
    },
  );
  for (const [status, contentType, body] of [
    [404, "text/plain", "404 page not found"],
    [502, "text/html", "<html>Error</html>"],
    [405, "", ""],
    [500, "application/json", "{"],
    [500, "application/json", "null"],
    [500, "application/json", '{"error":42}'],
  ]) {
    fetcher = async () =>
      new Response(body, { status, headers: { "Content-Type": contentType } });
    await assert.rejects(
      api("test"),
      (e) =>
        e instanceof ApiError &&
        e.status === status &&
        e.data.error === "Request failed" &&
        e.notified,
    );
  }
  fetcher = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(
    api("test"),
    (e) =>
      e instanceof ApiError &&
      e.status === 0 &&
      e.data.error === "Scopearr is not reachable",
  );
  fetcher = async () => new Response("", { status: 401 });
  const before = notifications.length;
  await assert.rejects(api("test"), ApiError);
  assert.deepEqual(events, ["scopearr:unauthorized"]);
  assert.equal(notifications.length, before);
  fetcher = async () => {
    throw new DOMException("Aborted", "AbortError");
  };
  await assert.rejects(api("test"), { name: "AbortError" });
  assert.equal(notifications.length, before);
  fetcher = async () =>
    new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  await assert.rejects(
    api("test", "GET", undefined, undefined, { notifyErrors: false }),
    (e) => e.data.error === "Not found" && !e.notified,
  );
  assert.equal(notifications.length, before);
});

test("polling pauses, aborts stale work, resumes immediately and keeps one timer", async () => {
  const timers = new Map(),
    listeners = new Map(),
    refs = [];
  let time = 0,
    id = 0,
    cursor = 0,
    pending,
    cleanup,
    oldDeps;
  const document = {
    hidden: true,
    addEventListener: (n, f) => listeners.set(n, f),
    removeEventListener: (n) => listeners.delete(n),
  };
  const hooks = {
    useRef(value) {
      const slot = cursor++;
      return (refs[slot] ||= { current: value });
    },
    useEffect(effect, deps) {
      if (!oldDeps || deps.some((v, i) => v !== oldDeps[i])) {
        pending = effect;
        oldDeps = deps;
      }
    },
  };
  const { usePolling } = loadTS(
    "hooks/usePolling.ts",
    { "preact/hooks": hooks },
    {
      document,
      setTimeout: (f, delay) => {
        timers.set(++id, { f, at: time + delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  const calls = [];
  const load = async (signal) => {
    calls.push(signal);
    return calls.length;
  };
  const render = (dep, delay = 0, loader = load) => {
    cursor = 0;
    usePolling(loader, () => 1000, [dep], { startDelay: delay });
    if (pending) {
      cleanup?.();
      cleanup = pending();
      pending = undefined;
    }
  };
  const tick = async (ms) => {
    time += ms;
    for (const [id, t] of [...timers])
      if (t.at <= time) {
        timers.delete(id);
        t.f();
      }
    await flush();
  };
  render("first");
  await tick(5000);
  assert.equal(calls.length, 0);
  document.hidden = false;
  listeners.get("visibilitychange")();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(timers.size, 1);
  await tick(1000);
  assert.equal(calls.length, 2);
  assert.equal(timers.size, 1);
  render("second", 180);
  assert.ok(calls[1].aborted);
  assert.equal(timers.size, 1);
  await tick(179);
  assert.equal(calls.length, 2);
  await tick(1);
  assert.equal(calls.length, 3);
  document.hidden = true;
  listeners.get("visibilitychange")();
  assert.ok(calls[2].aborted);
  assert.equal(timers.size, 0);
  await tick(5000);
  assert.equal(calls.length, 3);
  document.hidden = false;
  listeners.get("visibilitychange")();
  await flush();
  assert.equal(calls.length, 4);
  assert.equal(timers.size, 1);
  let resolveStale;
  render("pending", 0, (signal) => {
    calls.push(signal);
    return new Promise((resolve) => {
      resolveStale = resolve;
    });
  });
  await tick(0);
  render("new");
  await tick(0);
  assert.ok(calls[4].aborted);
  assert.equal(timers.size, 1);
  resolveStale(9);
  await flush();
  assert.equal(timers.size, 1);
  cleanup();
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0);
});

test("preload recovery reloads once per session and cannot loop when storage is blocked", () => {
  const saved = new Map();
  let listener,
    reloads = 0,
    prevented = 0;
  const { installPreloadRecovery } = loadTS(
    "preload-recovery.ts",
    {},
    {
      window: {
        addEventListener: (_, fn) => {
          listener = fn;
        },
        location: { reload: () => reloads++ },
      },
      sessionStorage: {
        getItem: (k) => saved.get(k),
        setItem: (k, v) => saved.set(k, v),
      },
    },
  );
  installPreloadRecovery();
  const event = { preventDefault: () => prevented++ };
  listener(event);
  listener(event);
  installPreloadRecovery();
  listener(event);
  assert.equal(reloads, 1);
  assert.equal(prevented, 1);
  loadTS(
    "preload-recovery.ts",
    {},
    {
      window: {
        addEventListener: (_, fn) => {
          listener = fn;
        },
        location: { reload: () => reloads++ },
      },
      sessionStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
    },
  ).installPreloadRecovery();
  listener(event);
  assert.equal(reloads, 1);
});

test("locale catalogs load on demand before initial render and expose every language name", () => {
  const i18n = readFileSync(
    new URL("../src/i18n.tsx", import.meta.url),
    "utf8",
  );
  const main = readFileSync(
    new URL("../src/main.tsx", import.meta.url),
    "utf8",
  );
  assert.match(i18n, /import fallback from "\.\/locales\/en.json"/);
  assert.match(i18n, /import: "name"/);
  assert.match(i18n, /export async function loadLocale/);
  assert.match(main, /loadLocale\(initialLocale\(\)\)/);
  assert.doesNotMatch(i18n, /eager: true,\s*import: "default"/);
});

test("mux status detail waits for cached checks and aborts a closed dialog", async () => {
  const { componentHarness, nodes, text } =
    await import("./helpers/component-harness.mjs");
  const states = [];
  let cursor = 0,
    effect,
    cleanup,
    resolve,
    requested,
    signal;
  const hooks = {
    useState: (initial) => {
      const i = cursor++;
      if (!(i in states)) states[i] = initial;
      return [
        states[i],
        (v) => {
          states[i] = typeof v === "function" ? v(states[i]) : v;
        },
      ];
    },
    useEffect: (fn) => {
      effect = fn;
    },
  };
  const job = {
    id: 42,
    status: "succeeded",
    check: {},
    source: {},
    sourceName: "movie.mkv",
  };
  const harness = componentHarness(
    "MuxStatusDialog",
    { job, close() {}, refresh() {}, options() {}, terminal() {} },
    {
      modules: {
        "preact/hooks": hooks,
        "../api": {
          api: (path, method, body, s) => {
            requested = path;
            signal = s;
            return new Promise((r) => (resolve = r));
          },
        },
        "../mux-spec": {
          effectiveMuxStatus: (j) => j.status,
          muxStatusLabels: {},
          muxStatusShort: {},
          routineMuxMessages: new Set(),
        },
        "./MuxPathDialog": {
          PathCheckRow: "PathCheckRow",
          DetailRow: "DetailRow",
        },
      },
      browser: { AbortController },
    },
  );
  const render = () => {
    cursor = 0;
    return harness.render();
  };
  let tree = render();
  cleanup = effect();
  assert.equal(requested, "mux/jobs?id=42");
  assert.equal(nodes(tree).filter((n) => n.type === "PathCheckRow").length, 0);
  assert.match(text(tree), /Loading/);
  resolve({ ...job, check: { exists: true, readable: true } });
  await flush();
  tree = render();
  assert.ok(
    nodes(tree).find(
      (n) => n.type === "PathCheckRow" && n.props.label === "Readable",
    ).props.ok,
  );
  cleanup();
  assert.ok(signal.aborted);
});

test("tool installed-version row omits an unavailable version separator", async () => {
  const { componentHarness, nodes, text } =
    await import("./helpers/component-harness.mjs");
  const tree = componentHarness(
    "ToolPackageCard",
    { endpoint: "mux/tools", label: "MKVToolNix", demo: false },
    {
      modules: {
        "preact/hooks": { useState: (v) => [v, () => {}] },
        "../hooks/usePolling": { usePolling() {} },
        "../api": {},
        "../confirmation": {},
        "../tool-package": { toolPackageActions: () => [] },
      },
    },
  ).render();
  const row = nodes(tree).find(
    (n) => n.type === "div" && text(n).startsWith("Installed version"),
  );
  assert.equal(text(row), "Installed versionNot installed");
});

test("lazy locale selection deduplicates loads and keeps current messages until ready", async () => {
  const english = JSON.parse(
    readFileSync(new URL("../src/locales/en.json", import.meta.url), "utf8"),
  );
  const german = JSON.parse(
    readFileSync(new URL("../src/locales/de.json", import.meta.url), "utf8"),
  );
  let resolveGerman,
    loads = 0;
  const germanLoad = new Promise((resolve) => {
    resolveGerman = resolve;
  });
  const globals = {
    navigator: { languages: ["de-DE"] },
    testNames: {
      "./locales/en.json": "English",
      "./locales/de.json": "Deutsch",
      "./locales/es.json": "Español",
      "./locales/it.json": "Italiano",
    },
    testLoaders: {
      "./locales/de.json": () => {
        loads++;
        return germanLoad;
      },
    },
  };
  const { translate, resolveLocale } = await import("../src/i18n-core.ts");
  const { loadLocale, initialLocale, prepareLocale, t, getLocale, catalogs } =
    loadTS(
      "i18n.tsx",
      {
        preact: { createContext: () => ({}) },
        "preact/hooks": {},
        "preact/jsx-runtime": {},
        "./locales/en.json": { default: english },
        "./notifications": {},
        "./browser-storage": { readPreference: () => null },
        "./i18n-core": { translate, resolveLocale },
      },
      globals,
      (source) =>
        source
          .replace(/import\.meta\.glob<string>\([\s\S]*?\}\)/, "testNames")
          .replace(/import\.meta\.glob<Catalog>\([\s\S]*?\}\)/, "testLoaders"),
    );
  assert.equal(initialLocale(), "de");
  assert.deepEqual(Array.from(catalogs, (c) => c.locale).sort(), [
    "de",
    "en",
    "es",
    "it",
  ]);
  const pending = loadLocale("de"),
    second = loadLocale("de");
  assert.equal(loads, 1);
  assert.equal(getLocale(), "en");
  assert.equal(t("Close"), "Close");
  resolveGerman(german);
  const catalog = await pending;
  assert.equal(await second, catalog);
  prepareLocale(catalog);
  assert.equal(getLocale(), "de");
  assert.equal(t("Close"), german.messages.Close);
  await loadLocale("de");
  assert.equal(loads, 1);
});
