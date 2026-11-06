// A browser window with a session history stack, history.state, location.hash,
// event listeners and fake timers. As in Chromium, a traversal fires popstate
// and then, as a task of its own, hashchange when the fragment changed;
// history.go traverses as a later task.
export function fakeWindow({
  hash = "",
  state = null,
  failing = false,
  url = "http://127.0.0.1:18080/",
} = {}) {
  const copy = (value) =>
    value === null || value === undefined
      ? null
      : JSON.parse(JSON.stringify(value));
  const listeners = new Map(),
    tasks = [],
    log = [];
  let entries = [{ hash, state: copy(state) }],
    index = 0,
    now = 0,
    sequence = 0;
  const schedule = (run, ms = 0) => {
    const id = ++sequence;
    tasks.push({ at: now + Math.max(0, ms), id, run });
    return id;
  };
  const dispatch = (type) => {
    for (const listener of [...(listeners.get(type) || [])]) listener({ type });
  };
  const traverse = (to) => {
    if (to < 0 || to >= entries.length) return;
    const before = entries[index].hash;
    index = to;
    dispatch("popstate");
    if (entries[index].hash !== before) schedule(() => dispatch("hashchange"));
  };
  const target = (url) =>
    url === undefined || url === null ? entries[index].hash : String(url);
  const fail = (method) => {
    log.push([method + " failed"]);
    throw new Error("SecurityError: " + method);
  };
  const window = {
    location: {
      get hash() {
        return entries[index].hash;
      },
      get href() {
        return url + entries[index].hash;
      },
    },
    history: {
      scrollRestoration: "auto",
      get state() {
        return copy(entries[index].state);
      },
      get length() {
        return entries.length;
      },
      pushState(state, _title, url) {
        if (failing) fail("push");
        log.push(["push", target(url)]);
        entries = entries.slice(0, index + 1);
        entries.push({ hash: target(url), state: copy(state) });
        index += 1;
      },
      replaceState(state, _title, url) {
        if (failing) fail("replace");
        log.push(["replace", target(url)]);
        entries[index] = { hash: target(url), state: copy(state) };
      },
      go(delta) {
        if (failing) fail("go");
        log.push(["go", delta]);
        schedule(() => traverse(index + delta));
      },
    },
    setTimeout: (run, ms) => schedule(run, ms),
    clearTimeout(id) {
      const at = tasks.findIndex((task) => task.id === id);
      if (at >= 0) tasks.splice(at, 1);
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };
  return {
    window,
    log,
    entries: () => entries.map((entry) => entry.hash),
    states: () => entries.map((entry) => copy(entry.state)),
    index: () => index,
    listeners: (type) => listeners.get(type)?.size || 0,
    dispatch,
    // The browser's Back and Forward buttons.
    back: () => traverse(index - 1),
    forward: () => traverse(index + 1),
    // A hash typed into the address bar, or location.hash = …: a new entry
    // without state.
    type(hash) {
      const before = entries[index].hash;
      entries = entries.slice(0, index + 1);
      entries.push({ hash, state: null });
      index += 1;
      dispatch("popstate");
      if (hash !== before) schedule(() => dispatch("hashchange"));
    },
    // Runs every task that is due within `ms`, in order.
    advance(ms = 0) {
      const until = now + ms;
      for (;;) {
        const due = tasks
          .filter((task) => task.at <= until)
          .sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        tasks.splice(tasks.indexOf(due), 1);
        now = due.at;
        due.run();
      }
      now = until;
    },
    pending: () => tasks.length,
  };
}
