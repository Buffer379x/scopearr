import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n";
import { notify } from "../notifications";

// Without requestIdleCallback (Safari), the preload waits this long after
// the first paint instead.
const IDLE_FALLBACK = 500;

// The chunk of an overlay that opens on demand, such as the filter drawer
// (docs/STYLEGUIDE.md, Part 1, 10.5; ruling P10). `load` imports it and
// resolves null when it cannot: its handler sits on the import() itself,
// inside Vite's preload wrapper, so a failure never raises
// vite:preloadError and preload-recovery.ts never reloads the page (a
// rejection counts as a failure too). One import runs at a time.
export type LazyChunk<T> = {
  // The export once it is there, else null.
  loaded(): T | null;
  // A preload; its failure is ignored.
  prefetch(): void;
  // The export for an overlay that opens: the import in flight or a new
  // one, and once more when that fails, unless a failure came before
  // (then this import is the retry); null when it cannot load.
  open(): Promise<T | null>;
};
export function lazyChunk<T>(load: () => Promise<T | null>): LazyChunk<T> {
  let value: T | null = null,
    failed = false,
    pending: Promise<T | null> | null = null;
  const attempt = () =>
    (pending ??= (async () => load())()
      .catch(() => null)
      .then((got) => {
        pending = null;
        failed = !got;
        return (value = got ?? value);
      }));
  return {
    loaded: () => value,
    prefetch() {
      if (!value) void attempt();
    },
    async open() {
      if (value) return value;
      const retry = failed;
      return (await attempt()) ?? (retry ? null : attempt());
    },
  };
}

// A lazy chunk for a page: preloaded at idle once the page has painted
// (requestIdleCallback, else a timeout), so the first press does not wait;
// `preload` false (a page that cannot open it) skips the preload.
// While `open`, it returns the export once it is there; opening before it
// arrived waits for it (the overlay shows with its chunk), and when it
// cannot load, the error notice shows and `close` runs, without a reload.
export function useLazyChunk<T>(
  chunk: LazyChunk<T>,
  open: boolean,
  close: () => void,
  preload = true,
): T | null {
  const [, arrived] = useState(0);
  const closer = useRef(close);
  closer.current = close;
  useEffect(() => {
    if (!preload || chunk.loaded()) return;
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(() => chunk.prefetch());
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(() => chunk.prefetch(), IDLE_FALLBACK);
    return () => clearTimeout(id);
  }, [chunk, preload]);
  useEffect(() => {
    if (!open || chunk.loaded()) return;
    let live = true;
    void chunk.open().then((got) => {
      if (!live) return;
      if (got) arrived((n) => n + 1);
      else {
        notify(t("Scopearr is not reachable"), "error");
        closer.current();
      }
    });
    return () => {
      live = false;
    };
  }, [open, chunk]);
  return open ? chunk.loaded() : null;
}
