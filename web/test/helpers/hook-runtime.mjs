// A fake of preact/hooks for running real hooks and components in node.
// Every hook takes the next slot, as in Preact; state, refs, memos and
// effects keep their slot across renders, and a hook that moves to another
// slot throws. Effects (layout effects alike) wait for flush(), run in slot
// order when their deps changed (Object.is) or have no deps, and run the
// previous cleanup first. Hooks the runtime does not know throw.
export function createHookRuntime({ contexts = new Map() } = {}) {
  const slots = [],
    seenContexts = [];
  let cursor = 0;

  function slot(kind, create) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { kind, ...create() };
    else if (slots[index].kind !== kind)
      throw new Error(
        "Hook " + index + " changed from " + slots[index].kind + " to " + kind,
      );
    return slots[index];
  }
  const depsChanged = (old, deps) =>
    !old ||
    !deps ||
    old.length !== deps.length ||
    deps.some((value, i) => !Object.is(value, old[i]));

  function effect(kind) {
    return (run, deps) => {
      const entry = slot(kind, () => ({ effect: true, fresh: true }));
      if (entry.fresh || depsChanged(entry.deps, deps)) {
        entry.fresh = false;
        entry.deps = deps;
        entry.pending = run;
      }
    };
  }
  function memo(kind, create, deps) {
    const entry = slot(kind, () => ({ fresh: true }));
    if (entry.fresh || depsChanged(entry.deps, deps)) {
      entry.fresh = false;
      entry.deps = deps;
      entry.value = create();
    }
    return entry.value;
  }
  const known = {
    useState(initial) {
      const entry = slot("useState", () => ({
        value: typeof initial === "function" ? initial() : initial,
      }));
      // The setter keeps its identity across renders, as in Preact.
      entry.set ??= (next) => {
        const value = typeof next === "function" ? next(entry.value) : next;
        if (!Object.is(value, entry.value)) runtime.changed = true;
        entry.value = value;
      };
      return [entry.value, entry.set];
    },
    useRef: (initial) =>
      slot("useRef", () => ({ ref: { current: initial } })).ref,
    useEffect: effect("useEffect"),
    useLayoutEffect: effect("useLayoutEffect"),
    useMemo: (create, deps) => memo("useMemo", create, deps),
    useCallback: (callback, deps) => memo("useCallback", () => callback, deps),
    useContext(context) {
      slot("useContext", () => ({}));
      seenContexts.push(context);
      return contexts.get(context);
    },
  };
  const hooks = new Proxy(known, {
    get(target, name) {
      if (typeof name === "symbol") return undefined;
      if (Object.hasOwn(target, name)) return target[name];
      throw new Error("Unknown hook: " + name);
    },
  });

  const runtime = {
    hooks,
    // True when a state changed (by !Object.is) since the last render.
    changed: false,
    // Every context read through useContext, in order.
    seenContexts,
    render(fn) {
      cursor = 0;
      runtime.changed = false;
      return fn();
    },
    // Runs the effects that are due; each cleanup runs before its effect.
    flush() {
      for (const entry of slots)
        if (entry?.effect && entry.pending) {
          if (typeof entry.cleanup === "function") entry.cleanup();
          entry.cleanup = entry.pending();
          entry.pending = undefined;
        }
    },
    // Renders and flushes until no state changes, as Preact renders again
    // after a state change; throws after `max` renders.
    settle(fn, { max = 20 } = {}) {
      for (let pass = 0; pass < max; pass++) {
        const result = runtime.render(fn);
        runtime.flush();
        if (!runtime.changed) return result;
      }
      throw new Error("render did not settle after " + max + " renders");
    },
    unmount() {
      for (const entry of slots)
        if (entry?.effect) {
          const cleanup = entry.cleanup;
          entry.cleanup = entry.pending = undefined;
          if (typeof cleanup === "function") cleanup();
        }
    },
  };
  return runtime;
}
