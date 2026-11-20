import { loadSource, nodes } from "./component-harness.mjs";
import { createHookRuntime } from "./hook-runtime.mjs";

// The catalog of the fake language: a key's text, else the key.
export const catalog = {};
export const t = (key, values = {}) =>
  (catalog[key] ?? key).replace(
    /\{(\w+)\}/g,
    (_, name) => values[name] ?? "{" + name + "}",
  );
export const i18n = {
  t,
  getLocale: () => "en",
  useI18n: () => ({ locale: "en" }),
};

// One fake window for notify, the toasts, openHash and openLog: a real
// EventTarget with a location.
export function browser({ popover = false } = {}) {
  const win = new EventTarget();
  win.location = { hash: "#/movies" };
  const links = [];
  const timers = [];
  win.addEventListener("scopearr:link", (event) =>
    links.push([event.detail, event.cancelable]),
  );
  const document = {
    body: { tagName: "BODY" },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  class MutationObserver {
    observe() {}
    disconnect() {}
  }
  const globals = {
    window: win,
    document,
    CustomEvent,
    MutationObserver,
    HTMLElement: { prototype: popover ? { showPopover() {} } : {} },
    setTimeout: (run, ms) => timers.push({ run, ms, live: true }),
    clearTimeout: (id) => {
      if (timers[id - 1]) timers[id - 1].live = false;
    },
    requestAnimationFrame: () => 0,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  };
  const eventLog = loadSource("event-log.ts", { browser: globals });
  const notifications = loadSource("notifications.ts", {
    modules: { "./event-log": eventLog },
    browser: globals,
  });
  // Every module shares one hooks object; it calls the runtime that renders.
  let current = createHookRuntime();
  const hooks = new Proxy({}, { get: (_, name) => current.hooks[name] });
  const { Notifications } = loadSource("components/Notifications.tsx", {
    modules: {
      "../ui": { ICON: { button: 16 } },
      "../dialog-model": loadSource("dialog-model.ts"),
      "../dialog-stack": {
        topmostDialog: () => undefined,
        trackNativeDialog() {},
        removeDialog() {},
      },
      "preact/hooks": hooks,
      "preact/compat": { createPortal: (vnode) => vnode },
      "../i18n": i18n,
      "../notifications": notifications,
      "../event-log": eventLog,
    },
    browser: globals,
  });
  const region = createHookRuntime();
  const view = {
    win,
    document,
    links,
    timers,
    // One Toast mounted with its own runtime, effects run.
    mount(vnode) {
      const runtime = createHookRuntime();
      current = runtime;
      const tree = runtime.settle(() => vnode.type(vnode.props));
      return { runtime, tree };
    },
    eventLog,
    notify: notifications.notify,
    // The region, settled; its toasts as [vnode, tree] pairs, each Toast
    // rendered once with its own runtime (its timer never starts).
    render() {
      current = region;
      const tree = region.settle(() => Notifications());
      const toasts = [tree.props.children].flat(Infinity).map((vnode) => {
        current = createHookRuntime();
        return [vnode, current.render(() => vnode.type(vnode.props))];
      });
      return { tree, toasts };
    },
  };
  view.render();
  return view;
}
