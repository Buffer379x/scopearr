import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";
import { fakeWindow } from "./helpers/fake-window.mjs";

const browserStorage = loadSource("browser-storage.ts"),
  eventLog = loadSource("event-log.ts");
const router = loadSource("router.ts", {
  modules: {
    "./tool-route": loadSource("tool-route.ts", {
      modules: { "./browser-storage": browserStorage },
    }),
    "./event-log": eventLog,
  },
});
const { createRouteHistory } = loadSource("route-history.ts", {
  modules: { "./router": router },
});

// A window on entry `index` of `hashes`, each entry with its index, and a
// route history listening on it.
function history(
  hashes = ["#/dashboard"],
  index = hashes.length - 1,
  options = {},
) {
  const win = fakeWindow({ hash: hashes[0], state: { scopearr: 0 } });
  for (const [at, hash] of hashes.entries())
    if (at) win.window.history.pushState({ scopearr: at }, "", hash);
  for (let at = hashes.length - 1; at > index; at--) win.back();
  win.advance();
  win.log.length = 0;
  const routes = createRouteHistory(win.window, options);
  const reported = [];
  routes.listen((hash) => reported.push(hash));
  return { win, routes, reported };
}
const indexes = (win) => win.states().map((state) => state?.scopearr);
const PENDING = "scopearr-pending-route",
  HERE = "http://127.0.0.1:18080/";
// Session storage that records its writes.
function memory(values = {}) {
  const map = new Map(Object.entries(values)),
    log = [];
  return {
    map,
    log,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem(key, value) {
      log.push(["set", key, JSON.parse(value)]);
      map.set(key, value);
    },
    removeItem(key) {
      log.push(["remove", key]);
      map.delete(key);
    },
  };
}

test("the first entry gets an index, its canonical hash and manual scrolling", () => {
  const win = fakeWindow({ hash: "#/movies?q=a%20b" });
  const routes = createRouteHistory(win.window);
  assert.equal(win.window.history.scrollRestoration, "manual");
  assert.deepEqual(win.states(), [{ scopearr: 0 }]);
  assert.deepEqual(win.log, [["replace", "#/movies?q=a+b"]]);
  assert.equal(routes.hash(), "#/movies?q=a+b");
  assert.equal(win.window.history.length, 1);
  routes.replace("#/movies?q=a+b");
  routes.flush();
  assert.equal(win.log.length, 1);
  const empty = fakeWindow();
  createRouteHistory(empty.window);
  assert.deepEqual(empty.entries(), ["#/dashboard"]);

  // An entry that already has an index (a reload) keeps it.
  const reload = history(["#/dashboard", "#/movies"]);
  assert.deepEqual(reload.win.log, []);
  const again = createRouteHistory(reload.win.window);
  again.push("#/tools/mux");
  assert.deepEqual(indexes(reload.win), [0, 1, 2]);
});

test("own writes never count as external navigation", () => {
  const { win, routes, reported } = history();
  routes.push("#/movies");
  routes.replace("#/movies?q=a");
  win.advance(300);
  routes.push("#/settings/connections");
  routes.replace("#/settings/appearance");
  routes.flush();
  routes.replace("#/settings/appearance/colors");
  // Late or extra events for the shown entry are no navigation.
  win.dispatch("popstate");
  win.dispatch("hashchange");
  win.advance(300);
  assert.deepEqual(reported, []);
  assert.deepEqual(win.entries(), [
    "#/dashboard",
    "#/movies?q=a",
    "#/settings/appearance/colors",
  ]);
  assert.deepEqual(indexes(win), [0, 1, 2]);
  assert.equal(routes.hash(), "#/settings/appearance/colors");
});

test("replace is debounced and coalesced", () => {
  const { win, routes } = history(["#/movies"]);
  for (let n = 1; n <= 20; n++) {
    routes.replace("#/movies?q=" + "x".repeat(n));
    win.advance(100);
  }
  assert.deepEqual(win.log, []);
  win.advance(199);
  assert.deepEqual(win.log, []);
  win.advance(1);
  assert.deepEqual(win.log, [["replace", "#/movies?q=" + "x".repeat(20)]]);
  assert.equal(win.window.history.length, 1);
  // A replace with the URL it already has writes nothing.
  routes.replace("#/movies?q=" + "x".repeat(20));
  win.advance(300);
  routes.flush();
  assert.equal(win.log.length, 1);
});

test("a pending replace is written before a push and dropped when the user goes back", () => {
  const { win, routes, reported } = history(["#/dashboard", "#/movies"]);
  routes.replace("#/movies?q=ab");
  routes.push("#/settings/connections");
  assert.deepEqual(win.log, [
    ["replace", "#/movies?q=ab"],
    ["push", "#/settings/connections"],
  ]);
  assert.deepEqual(indexes(win), [0, 1, 2]);

  // Typing on settings, then Back before the delay: the timer never writes
  // into the entry the user went back to.
  routes.replace("#/settings/appearance");
  win.back();
  assert.deepEqual(reported, ["#/movies?q=ab"]);
  win.advance(1000);
  assert.deepEqual(win.entries(), [
    "#/dashboard",
    "#/movies?q=ab",
    "#/settings/connections",
  ]);
  assert.equal(win.log.length, 2);
  assert.deepEqual(reported, ["#/movies?q=ab"]);
});

test("a pending replace reaches its own entry when the user returns", () => {
  const { win, routes, reported } = history(["#/dashboard", "#/movies"]);
  routes.replace("#/movies?q=abc");
  win.back();
  routes.accept();
  win.advance(1000);
  assert.deepEqual(win.entries(), ["#/dashboard", "#/movies"]);
  // Forward shows the last keystroke, which is written into its entry now.
  win.forward();
  assert.deepEqual(reported, ["#/dashboard", "#/movies?q=abc"]);
  assert.deepEqual(win.entries(), ["#/dashboard", "#/movies?q=abc"]);
  routes.accept();
  win.advance();
  assert.equal(reported.length, 2);

  // A push drops what was kept for the forward entries it replaces.
  routes.replace("#/movies?q=abcd");
  win.back();
  routes.accept();
  routes.push("#/tools/mux");
  win.back();
  routes.accept();
  win.forward();
  assert.deepEqual(reported.slice(2), [
    "#/dashboard",
    "#/dashboard",
    "#/tools/mux",
  ]);
  assert.deepEqual(win.entries(), ["#/dashboard", "#/tools/mux"]);
});

test("pagehide writes a pending replace into its entry", () => {
  const { win, routes } = history(["#/movies"]);
  routes.replace("#/movies?q=last");
  win.dispatch("pagehide");
  assert.deepEqual(win.log, [["replace", "#/movies?q=last"]]);
  win.advance(1000);
  assert.equal(win.log.length, 1);
});

test("a pending replace is kept in session storage until it is written", () => {
  const storage = memory();
  const { win, routes } = history(["#/dashboard", "#/movies"], 1, {
    storage,
  });
  storage.log.length = 0;
  routes.replace("#/movies?q=a");
  routes.replace("#/movies?q=ab");
  assert.deepEqual(storage.log, [
    ["set", PENDING, { index: 1, url: HERE, hash: "#/movies?q=a" }],
    ["set", PENDING, { index: 1, url: HERE, hash: "#/movies?q=ab" }],
  ]);
  win.advance(300);
  assert.deepEqual(storage.log.slice(2), [["remove", PENDING]]);
  routes.replace("#/movies?q=abx");
  routes.flush();
  assert.deepEqual(storage.log.at(-1), ["remove", PENDING]);

  // pagehide writes the entry and keeps the record: a reload does not see
  // that write.
  routes.replace("#/movies?q=abc");
  win.dispatch("pagehide");
  assert.equal(win.entries()[1], "#/movies?q=abc");
  assert.deepEqual(JSON.parse(storage.map.get(PENDING)), {
    index: 1,
    url: HERE,
    hash: "#/movies?q=abc",
  });

  // A replace kept for the entry the user left keeps its record until that
  // entry shows it again.
  routes.replace("#/movies?q=abcd");
  win.back();
  routes.accept();
  win.advance(300);
  assert.equal(JSON.parse(storage.map.get(PENDING)).hash, "#/movies?q=abcd");
  win.forward();
  routes.accept();
  assert.equal(win.entries()[1], "#/movies?q=abcd");
  assert.ok(!storage.map.has(PENDING));

  // A push drops the record of an entry it replaces.
  routes.replace("#/movies?q=abcde");
  win.back();
  routes.accept();
  routes.push("#/tools/mux");
  assert.ok(!storage.map.has(PENDING));
});

test("a reload of its entry shows the stored replace", () => {
  const record = (fields = {}) =>
    JSON.stringify({
      index: 1,
      url: HERE,
      hash: "#/movies?q=a%20b",
      ...fields,
    });
  for (const [name, value, shown] of [
    ["same entry", record(), "#/movies?q=a+b"],
    ["other entry", record({ index: 0 }), "#/movies"],
    ["other page", record({ url: HERE + "other" }), "#/movies"],
    ["no hash", record({ hash: 1 }), "#/movies"],
    ["broken", "{", "#/movies"],
  ]) {
    const storage = memory({ [PENDING]: value });
    const { win, routes } = history(["#/dashboard", "#/movies"], 1, {
      storage,
    });
    assert.equal(routes.hash(), shown, name);
    assert.deepEqual(win.entries(), ["#/dashboard", shown], name);
    assert.deepEqual(indexes(win), [0, 1], name);
    assert.ok(!storage.map.has(PENDING), name);
  }
  // Blocked storage stays optional.
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  const { win, routes } = history(["#/movies"], 0, { storage: blocked });
  assert.doesNotThrow(() => {
    routes.replace("#/movies?q=a");
    routes.flush();
  });
  assert.deepEqual(win.entries(), ["#/movies?q=a"]);
});

test("a start entry without an index takes its place after the others", () => {
  // A hash typed while the sign-in screen showed, so nothing listened.
  const win = fakeWindow({ hash: "#/dashboard", state: { scopearr: 0 } });
  win.window.history.pushState({ scopearr: 1 }, "", "#/movies");
  win.type("#/settings/appearance");
  win.advance();
  win.log.length = 0;
  const routes = createRouteHistory(win.window);
  const reported = [];
  routes.listen((hash) => reported.push(hash));
  assert.deepEqual(indexes(win), [0, 1, 2]);
  // A declined Back returns one step forward.
  win.back();
  assert.deepEqual(reported, ["#/movies"]);
  routes.restore();
  win.advance();
  assert.deepEqual(win.log.at(-1), ["go", 1]);
  assert.equal(win.index(), 2);
  assert.deepEqual(reported, ["#/movies"]);
});

test("external navigation is reported once for popstate plus hashchange", () => {
  const { win, routes, reported } = history([
    "#/dashboard",
    "#/movies",
    "#/tools/mux",
  ]);
  // While the guard is open, the hashchange of the same step is not new.
  win.back();
  win.advance();
  assert.deepEqual(reported, ["#/movies"]);
  routes.accept();
  win.advance();
  win.back();
  routes.accept();
  win.advance();
  assert.deepEqual(reported, ["#/movies", "#/dashboard"]);
  // The same entry again after another step is reported again.
  win.forward();
  routes.restore();
  win.advance();
  win.forward();
  win.advance();
  assert.deepEqual(reported, [
    "#/movies",
    "#/dashboard",
    "#/movies",
    "#/movies",
  ]);
  // A push between two visits of one entry.
  routes.accept();
  routes.push("#/settings/connections");
  win.back();
  win.advance();
  assert.deepEqual(reported.slice(4), ["#/movies"]);
});

test("a declined guard returns to the accepted entry and keeps forward history", () => {
  const { win, routes, reported } = history(
    ["#/dashboard", "#/settings/appearance", "#/settings/system"],
    1,
  );
  const entries = win.entries();
  win.back();
  assert.deepEqual(reported, ["#/dashboard"]);
  routes.restore();
  win.advance();
  assert.equal(win.index(), 1);
  win.forward();
  assert.deepEqual(reported, ["#/dashboard", "#/settings/system"]);
  routes.restore();
  win.advance();
  assert.equal(win.index(), 1);
  // The return is no navigation of its own and rewrites no entry.
  assert.deepEqual(reported, ["#/dashboard", "#/settings/system"]);
  assert.deepEqual(win.log, [
    ["go", 1],
    ["go", -1],
  ]);
  assert.deepEqual(win.entries(), entries);
  assert.deepEqual(indexes(win), [0, 1, 2]);
  assert.equal(routes.hash(), "#/settings/appearance");
  // Restoring on the accepted entry does nothing (go(0) would reload).
  routes.restore();
  win.advance();
  assert.equal(win.log.length, 2);
});

test("typed hashes get the next index", () => {
  const { win, routes, reported } = history(
    ["#/dashboard", "#/movies", "#/tools/mux"],
    1,
  );
  win.type("#/settings");
  assert.deepEqual(reported, ["#/settings/connections"]);
  assert.deepEqual(win.entries(), [
    "#/dashboard",
    "#/movies",
    "#/settings/connections",
  ]);
  assert.deepEqual(indexes(win), [0, 1, 2]);
  // Declined: back to the accepted entry, one step.
  routes.restore();
  win.advance();
  assert.equal(win.index(), 1);
  assert.deepEqual(win.log.at(-1), ["go", -1]);
  // Accepted: the next push follows the typed entry.
  win.type("#/nope");
  routes.accept();
  win.advance();
  routes.push("#/tools/mux");
  assert.deepEqual(indexes(win), [0, 1, 2, 3]);
  assert.deepEqual(reported, ["#/settings/connections", "#/dashboard"]);
});

test("dispose flushes and stops listening", () => {
  const { win, routes, reported } = history(["#/dashboard", "#/movies"]);
  assert.equal(win.listeners("popstate"), 1);
  assert.equal(win.listeners("hashchange"), 1);
  assert.equal(win.listeners("pagehide"), 1);
  routes.replace("#/movies?q=x");
  routes.dispose();
  assert.deepEqual(win.log, [["replace", "#/movies?q=x"]]);
  for (const type of ["popstate", "hashchange", "pagehide"])
    assert.equal(win.listeners(type), 0, type);
  win.back();
  win.advance(1000);
  assert.deepEqual(reported, []);
  assert.equal(win.log.length, 1);

  // listen returns its own stop.
  const other = history();
  const stop = other.routes.listen(() => {});
  assert.equal(other.win.listeners("popstate"), 2);
  stop();
  assert.equal(other.win.listeners("popstate"), 1);
});

test("history errors are swallowed", () => {
  const win = fakeWindow({ hash: "#/movies", failing: true });
  win.window.history.scrollRestoration = undefined;
  Object.defineProperty(win.window.history, "scrollRestoration", {
    set() {
      throw new Error("read-only");
    },
  });
  const routes = createRouteHistory(win.window);
  const reported = [];
  routes.listen((hash) => reported.push(hash));
  assert.doesNotThrow(() => {
    routes.push("#/tools/mux");
    routes.replace("#/tools/mux?q=x");
    routes.flush();
    routes.replace("#/tools/mux?q=y");
    win.advance(300);
    routes.restore();
    routes.accept();
    win.dispatch("pagehide");
    routes.dispose();
  });
  assert.equal(routes.hash(), "#/movies");
  assert.deepEqual(reported, []);
  assert.ok(win.log.some(([entry]) => entry === "push failed"));
  assert.ok(win.log.some(([entry]) => entry === "replace failed"));
});

test("a link to the shown route is reported again after pending replaces are written", () => {
  const { win, routes } = history(["#/dashboard", "#/settings/system/log"]);
  const links = [];
  routes.listen((hash, link) => links.push([hash, link]));
  const link = (hash) =>
    win.window.dispatchEvent(
      new CustomEvent("scopearr:link", { detail: hash, cancelable: true }),
    );
  // A pending replace is written first, so the link compares with what is
  // shown: the shown route is started again; another one is left to the
  // caller (location.hash = …).
  routes.replace("#/settings/system/log?level=error");
  assert.equal(win.window.location.hash, "#/settings/system/log");
  assert.equal(link("#/settings/system/log?level=error"), false);
  assert.equal(win.window.location.hash, "#/settings/system/log?level=error");
  assert.deepEqual(links, [["#/settings/system/log?level=error", true]]);
  routes.replace("#/settings/system/log?level=info");
  assert.equal(link("#/settings/system/log?level=error"), true);
  assert.equal(win.window.location.hash, "#/settings/system/log?level=info");
  assert.equal(links.length, 1);
  // Non-canonical spellings compare canonically.
  assert.equal(link("#/settings/system/log?level=info&page=2"), false);
  assert.deepEqual(links.at(-1), ["#/settings/system/log?level=info", true]);
  assert.deepEqual(win.entries(), [
    "#/dashboard",
    "#/settings/system/log?level=info",
  ]);
  assert.equal(win.pending(), 0, "no replace left");
});
