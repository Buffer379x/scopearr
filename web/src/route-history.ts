import { LINK_EVENT } from "./event-log";
import { formatRoute, parseRoute } from "./router";

// The only access to window.history and location for routes. Every entry
// carries its index in history.state.scopearr, so a declined Back/Forward
// returns to the accepted entry with history.go and keeps the entries after
// it. Replaces are debounced and coalesced: Back leaves a list instead of
// replaying keystrokes, and Safari limits history calls (100 per 30 s).
// How a reported route arrived. fresh: the entry had no index (a typed or
// pasted hash, location.hash = …), so it starts like a page load. link: a
// link to the shown route, which starts it again.
export type Arrival = { link?: boolean; fresh?: boolean };
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
  // index get the next one and arrive `fresh`. A link (scopearr:link, see
  // openLog) to the shown route is reported with `link`, after a pending
  // replace is written.
  listen(onExternal: (hash: string, arrival: Arrival) => void): () => void;
  // The reported entry is shown now, or the shown entry is restored with
  // history.go (replaceState only as a fallback).
  accept(): void;
  restore(): void;
  // Flushes and stops listening; pagehide flushes as well.
  dispose(): void;
};

const canonical = (hash: string) => formatRoute(parseRoute(hash));
// A replace still waiting for its delay, so a reload of its entry keeps it:
// a reload loads the URL the entry had before pagehide could write it.
const PENDING_KEY = "scopearr-pending-route";
export type RouteStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function createRouteHistory(
  win: Window,
  { delay = 300, storage }: { delay?: number; storage?: RouteStorage } = {},
): RouteHistory {
  const { history, location } = win;
  const url = () => location.href.split("#")[0];
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
  // The entry index of the pending replace in storage.
  let stored: number | undefined;
  const store = (index: number, hash: string) => {
    stored = index;
    try {
      storage?.setItem(
        PENDING_KEY,
        JSON.stringify({ index, url: url(), hash }),
      );
    } catch {}
  };
  const unstore = () => {
    stored = undefined;
    try {
      storage?.removeItem(PENDING_KEY);
    } catch {}
  };
  // accepted: the entry the app shows; shown: its route, including a pending
  // replace. A state-less entry (a fresh load, or a hash typed while nothing
  // listened) is the newest one, so its index is its place in the history.
  let accepted = indexOf() ?? history.length - 1,
    shown = canonical(location.hash),
    pending: { hash: string; index: number } | undefined,
    timer: number | undefined,
    // The last reported step, so its second event is not reported again.
    arrival = "";
  // A reload of the entry of a stored replace shows that replace.
  try {
    const kept = JSON.parse(storage?.getItem(PENDING_KEY) || "null");
    if (
      kept?.index === indexOf() &&
      kept?.url === url() &&
      typeof kept?.hash === "string"
    )
      shown = canonical(kept.hash);
  } catch {}
  unstore();
  if (indexOf() === undefined || location.hash !== shown)
    write("replaceState", accepted, shown);
  // Replaces still pending when the user left their entry. They are written
  // when the entry is shown again, so no keystroke is lost.
  const late = new Map<number, string>();
  const forget = (from: number) => {
    for (const index of late.keys()) if (index >= from) late.delete(index);
    if (stored !== undefined && stored >= from) unstore();
  };
  // pagehide keeps the stored replace: a reload does not see this write.
  const flush = (keep = false) => {
    win.clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    const { hash, index } = pending;
    pending = undefined;
    if (indexOf() !== index) return void late.set(index, hash);
    if (location.hash !== hash) write("replaceState", index, hash);
    if (!keep && stored === index) unstore();
  };
  const listeners: [string, (event: Event) => void][] = [];
  const on = (type: string, listener: (event: Event) => void) => {
    win.addEventListener(type, listener);
    listeners.push([type, listener]);
    return () => {
      win.removeEventListener(type, listener);
      const at = listeners.findIndex((entry) => entry[1] === listener);
      if (at >= 0) listeners.splice(at, 1);
    };
  };
  on("pagehide", () => flush(true));
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
      store(accepted, hash);
      win.clearTimeout(timer);
      timer = win.setTimeout(() => flush(), delay);
    },
    flush: () => flush(),
    listen(onExternal) {
      const arrive = () => {
        let index = indexOf();
        const fresh = index === undefined;
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
          if (stored === index) unstore();
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
        onExternal(hash, { fresh });
      };
      // A link to another route sets the hash itself (then reported as a
      // typed hash); one to the shown route would change nothing, so it is
      // cancelled and reported here.
      const link = (event: Event) => {
        flush();
        const hash = canonical(String((event as CustomEvent).detail));
        if (hash !== canonical(location.hash)) return;
        event.preventDefault();
        onExternal(hash, { link: true });
      };
      const stops = [
        on("popstate", arrive),
        on("hashchange", arrive),
        on(LINK_EVENT, link),
      ];
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
