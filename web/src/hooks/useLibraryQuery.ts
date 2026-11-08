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
  setResults: (r: Results) => void;
  setBusy: (b: boolean) => void;
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
  setResults,
  setBusy,
}: QueryArgs) {
  const lastRequest = useRef(0);
  useEffect(() => {
    if (view !== "library") return;
    const id = ++lastRequest.current;
    const controller = new AbortController();
    setBusy(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams(filters[service]);
      // limit is quick search's page size; a route never sets it (1.7.0).
      params.delete("limit");
      params.set("service", service);
      params.set("page", String(page));
      params.set("sort", movieSort.field);
      params.set("dir", movieSort.direction);
      api<Results>(
        "files?" + params.toString(),
        "GET",
        undefined,
        controller.signal,
      )
        .then((r) => {
          if (id === lastRequest.current) setResults(r);
        })
        .catch(() => {})
        .finally(() => {
          if (id === lastRequest.current) setBusy(false);
        });
    }, 180);
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
