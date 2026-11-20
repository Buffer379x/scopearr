import { useEffect, useRef } from "preact/hooks";
import { api } from "../api";
import type { FilmSort, Results, Service } from "../types";
type QueryArgs = {
  view: string;
  service: Service;
  filters: Record<Service, string>;
  page: number;
  movieSort: FilmSort;
  lastSuccess: string | null | undefined;
  seasonMode: string | undefined;
  pageSize: number | undefined;
  // The collapsed series view (rc.4 R2): the page holds series, asked as
  // summaries (D33a) with the files of the `expand` series
  // ("<service>/<mediaId>") only.
  bySeries: boolean;
  summary?: boolean;
  expand?: string[];
  setResults: (r: Results) => void;
  // `expanding`: the request differs from the last one only by expand.
  setBusy: (b: boolean, expanding?: boolean) => void;
};
export function useLibraryQuery({
  view,
  service,
  filters,
  page,
  movieSort,
  lastSuccess,
  seasonMode,
  pageSize,
  bySeries,
  summary = false,
  expand = [],
  setResults,
  setBusy,
}: QueryArgs) {
  const lastRequest = useRef(0);
  const lastBase = useRef("");
  const asSummary = bySeries && summary;
  const opened = asSummary ? expand.join(",") : "";
  useEffect(() => {
    if (view !== "library") return;
    const id = ++lastRequest.current;
    const controller = new AbortController();
    const base = JSON.stringify([
      service,
      filters[service],
      page,
      movieSort,
      lastSuccess,
      seasonMode,
      pageSize,
      bySeries,
      asSummary,
    ]);
    // The answer last shown had the same base: only series open or close.
    const expanding = asSummary && base === lastBase.current;
    setBusy(true, expanding);
    // A chevron asks at once; typing in the search waits a moment.
    const delay = expanding ? 0 : 180;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(filters[service]);
      // limit is quick search's page size; a route never sets it (1.7.0).
      params.delete("limit");
      params.set("service", service);
      params.set("page", String(page));
      params.set("sort", movieSort.field);
      params.set("dir", movieSort.direction);
      if (bySeries) params.set("pageBy", "series");
      if (asSummary) {
        params.set("summary", "1");
        for (const key of expand) params.append("expand", key);
      }
      api<Results>(
        "files?" + params.toString(),
        "GET",
        undefined,
        controller.signal,
      )
        .then((r) => {
          if (id !== lastRequest.current) return;
          lastBase.current = base;
          setResults(r);
        })
        .catch(() => {})
        .finally(() => {
          if (id === lastRequest.current) setBusy(false);
        });
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
      ++lastRequest.current;
    };
  }, [
    view,
    movieSort.field,
    movieSort.direction,
    service,
    filters[service],
    page,
    lastSuccess,
    seasonMode,
    pageSize,
    bySeries,
    asSummary,
    opened,
  ]);
}
// The facets of a service while `enabled` (the open filter drawer, ruling
// P11/M15), loaded again after every change of lastSuccess; the caller
// keeps the last ones until new ones arrive.
export function useFacets(
  enabled: boolean,
  service: Service,
  lastSuccess: string | null | undefined,
  setFacets: (f: Record<string, string[]>) => void,
) {
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let current = true;
    api<Record<string, string[]>>(
      "facets?service=" + service,
      "GET",
      undefined,
      controller.signal,
    )
      .then((f) => {
        if (current) setFacets(f);
      })
      .catch(() => {});
    return () => {
      current = false;
      controller.abort();
    };
  }, [enabled, service, lastSuccess]);
}
