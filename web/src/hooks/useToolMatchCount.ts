import { useEffect, useState } from "preact/hooks";
import { api } from "../api";

// The pause after the last change, as the drawer of the libraries waits.
const COUNT_DELAY = 180;

// The live count of a tool's filter drawer (docs/STYLEGUIDE.md, Part 1,
// 10.5): the total of one item of the draft's results (toolCountPath:
// placement/items?…&limit=1 or filecheck/items?…&limit=1), 180ms after the
// last change, the request before it aborted. As with the libraries'
// useMatchCount, the last count stays while a changed draft's count loads,
// `stale` (the drawer dims it), so the text does not flash. Null before
// the first answer, when it fails (the list's own request reports errors,
// so this one is not toasted) and without a path (Mux counts locally).
export function useToolMatchCount(path: string | null): {
  count: number | null;
  stale: boolean;
} {
  const [found, setFound] = useState<[string | null, number | null]>([
    null,
    null,
  ]);
  useEffect(() => {
    if (path === null) return;
    const request = new AbortController();
    const timer = setTimeout(
      () =>
        void api<{ total?: unknown }>(path, "GET", undefined, request.signal, {
          notifyErrors: false,
        })
          .then(
            (results) =>
              typeof results.total === "number" ? results.total : null,
            () => null,
          )
          .then((total) => {
            if (!request.signal.aborted) setFound([path, total]);
          }),
      COUNT_DELAY,
    );
    return () => {
      clearTimeout(timer);
      request.abort();
    };
  }, [path]);
  if (path === null) return { count: null, stale: false };
  return { count: found[1], stale: found[0] !== path && found[1] !== null };
}
