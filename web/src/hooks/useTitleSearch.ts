import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import type { TitleHits } from "../title-search";

// From two letters on, 180ms after the last keystroke (E18).
const SEARCH_MIN = 2,
  SEARCH_DELAY = 180;
const NONE: TitleHits = { radarr: [], sonarr: [] };

// Quick search's titles of the query (title-search.ts) and whether its
// answer is still on its way, also during the pause. A new query cancels
// the one before, and so does closing. Until the answer arrives, the
// titles of the query before stay, so the list does not empty and fill
// again while typing; below two letters there are none.
export function useTitleSearch(query: string) {
  const q = query.trim(),
    short = q.length < SEARCH_MIN;
  const [found, setFound] = useState<[string, TitleHits]>(["", NONE]);
  useEffect(() => {
    if (short) return void setFound(["", NONE]);
    const request = new AbortController();
    const timer = setTimeout(
      () =>
        void import("../title-search")
          .then((titles) => titles.findTitles(api, q, request.signal))
          // A chunk that cannot load (offline, a new deployment) finds
          // nothing, so the search ends.
          .catch(() => NONE)
          .then((hits) => {
            if (!request.signal.aborted) setFound([q, hits]);
          }),
      SEARCH_DELAY,
    );
    return () => {
      clearTimeout(timer);
      request.abort();
    };
  }, [q]);
  return { hits: short ? NONE : found[1], busy: !short && found[0] !== q };
}
