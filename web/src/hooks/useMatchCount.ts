import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { matchCountPath } from "../library-filters";
import type { Results, Service } from "../types";

// The pause after the last change, as the list's own query waits.
const COUNT_DELAY = 180;

// The filter drawer's live match count (docs/STYLEGUIDE.md, Part 1, 10.5):
// the total of one file of the draft's results (files?…&limit=1), 180ms
// after the last change, the request before it aborted. Null while it
// loads and when it fails (the drawer then shows "Apply" without a number;
// the list's own request reports errors, so this one is not toasted). Page
// and sort do not change it.
export function useMatchCount(service: Service, query: string): number | null {
  const path = matchCountPath(service, query);
  const [found, setFound] = useState<[string, number | null]>(["", null]);
  useEffect(() => {
    const request = new AbortController();
    const timer = setTimeout(
      () =>
        void api<Results>(path, "GET", undefined, request.signal, {
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
  return found[0] === path ? found[1] : null;
}
