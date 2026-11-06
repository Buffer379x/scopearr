import { formatRoute, parseRoute } from "./router";

// The only access to window.history and location for routes. Every entry
// carries its index in history.state.scopearr, so a declined Back/Forward
// returns to the accepted entry with history.go and keeps the entries after
// it. Replaces are debounced and coalesced: Back leaves a list instead of
// replaying keystrokes, and Safari limits history calls (100 per 30 s).
export type RouteHistory = {
  // The canonical hash: formatRoute(parseRoute(location.hash)).
  hash(): string;
  // A new entry after the accepted one; a pending replace is written into
  // the current entry first.
  push(hash: string): void;
  // Debounced; the last hash wins.
  replace(hash: string): void;
  flush(): void;
  // Reports Back, Forward and typed hashes once for popstate plus hashchange.
  // A pending replace stays with the entry that was left; entries without an
  // index get the next one.
  listen(onExternal: (hash: string) => void): () => void;
  // The reported entry is shown now, or the shown entry is restored with
  // history.go (replaceState only as a fallback).
  accept(): void;
  restore(): void;
  // Flushes and stops listening; pagehide flushes as well.
  dispose(): void;
};

const canonical = (hash: string) => formatRoute(parseRoute(hash));

export function createRouteHistory(
  win: Window,
  { delay = 300 }: { delay?: number } = {},
): RouteHistory {
  const { history, location } = win;
  const indexOf = (): number | undefined => {
    const index = (history.state as { scopearr?: unknown } | null)?.scopearr;
    return typeof index === "number" && Number.isSafeInteger(index)
      ? index
      : undefined;
  };
  // A full history (Safari's limit) or blocked history keeps the app state.
  const write = (
    method: "pushState" | "replaceState",
    index: number,
    hash?: string,
  ) => {
    try {
      history[method]({ scopearr: index }, "", hash);
      return true;
    } catch {
      return false;
    }
  };
  try {
    history.scrollRestoration = "manual";
  } catch {}
  // accepted: the entry the app shows; shown: its route, including a pending
  // replace.
  let accepted = indexOf() ?? 0,
    shown = canonical(location.hash),
    pending: { hash: string; index: number } | undefined,
    timer: number | undefined,
    // The last reported step, so its second event is not reported again.
    arrival = "";
  if (indexOf() === undefined || location.hash !== shown)
    write("replaceState", accepted, shown);
  // Replaces still pending when the user left their entry. They are written
  // when the entry is shown again, so no keystroke is lost.
  const late = new Map<number, string>();
  const forget = (from: number) => {
    for (const index of late.keys()) if (index >= from) late.delete(index);
  };
  const flush = () => {
    win.clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    const { hash, index } = pending;
    pending = undefined;
    if (indexOf() !== index) late.set(index, hash);
    else if (location.hash !== hash) write("replaceState", index, hash);
  };
  const listeners: [string, () => void][] = [];
  const on = (type: string, listener: () => void) => {
    win.addEventListener(type, listener);
    listeners.push([type, listener]);
    return () => {
      win.removeEventListener(type, listener);
      const at = listeners.findIndex((entry) => entry[1] === listener);
      if (at >= 0) listeners.splice(at, 1);
    };
  };
  on("pagehide", flush);
  return {
    hash: () => canonical(location.hash),
    push(hash) {
      flush();
      if (!write("pushState", accepted + 1, hash)) return;
      accepted += 1;
      forget(accepted);
      shown = hash;
      arrival = "";
    },
    replace(hash) {
      pending = { hash, index: accepted };
      shown = hash;
      win.clearTimeout(timer);
      timer = win.setTimeout(flush, delay);
    },
    flush,
    listen(onExternal) {
      const arrive = () => {
        let index = indexOf();
        if (index === undefined) {
          // A typed hash or location.hash = …: a new entry after the
          // accepted one.
          index = accepted + 1;
          forget(index);
          write("replaceState", index, canonical(location.hash));
        }
        flush();
        const kept = late.get(index);
        if (kept !== undefined) {
          late.delete(index);
          write("replaceState", index, kept);
        }
        const hash = kept ?? canonical(location.hash);
        if (index === accepted && hash === shown) {
          // The shown entry again: a return after restore, or the second
          // event of an accepted step.
          arrival = "";
          return;
        }
        const step = index + " " + hash;
        if (step === arrival) return;
        arrival = step;
        onExternal(hash);
      };
      const stops = [on("popstate", arrive), on("hashchange", arrive)];
      return () => stops.forEach((stop) => stop());
    },
    accept() {
      const index = indexOf();
      if (index === undefined) return;
      accepted = index;
      shown = canonical(location.hash);
    },
    restore() {
      const index = indexOf();
      if (index === accepted) return;
      try {
        if (index === undefined) throw new Error("no index");
        history.go(accepted - index);
      } catch {
        write("replaceState", accepted, shown);
      }
    },
    dispose() {
      flush();
      while (listeners.length) {
        const [type, listener] = listeners.pop()!;
        win.removeEventListener(type, listener);
      }
    },
  };
}
