import { useEffect, useState } from "preact/hooks";
import {
  readPreference,
  readSessionPreference,
  readToolFilters,
  writePreference,
  writeSessionPreference,
} from "../browser-storage";
import type { ToolFilters } from "../browser-storage";
import {
  formatTableSort,
  nextTableSort,
  parseTableSort,
  type TableSort,
} from "../table-sort";
import { TOOLS, toolRouteQuery, toolRouteState } from "../tool-route";
import type { ToolView } from "../router";

// The tool page's part of the route. Its query wins per part (filters, sort,
// page) over storage; after Back or Forward (fromHistory) the query names
// the whole state, so a part it leaves out is the default.
export type ToolRoute = {
  query: string;
  fromHistory: boolean;
  replace(query: string): void;
};

// Filters and sort persist in localStorage (scopearr-<tool>-filters/-sort),
// the page per tab in sessionStorage (scopearr-<tool>-page), in the formats
// of 1.7.0. With a route, the URL mirrors the whole state by replace.
export function useToolPageState(
  tool: (typeof TOOLS)[ToolView]["storage"],
  allowed: Parameters<typeof toolRouteState>[1],
  { resetPageOnSort }: { resetPageOnSort: boolean },
  route?: ToolRoute,
) {
  // The parts the route names; storage fills the others, except after
  // Back/Forward.
  const [named] = useState(() =>
    route ? toolRouteState(route.query, allowed) : {},
  );
  const stored = !route?.fromHistory;
  const [filters, setFilters] = useState<ToolFilters>(
    () =>
      named.filters ||
      (stored
        ? readToolFilters(`scopearr-${tool}-filters`, allowed)
        : { statuses: [], targets: [], kinds: [], q: "" }),
  );
  const changeFilters = (patch: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };
  useEffect(() => {
    writePreference(`scopearr-${tool}-filters`, JSON.stringify(filters));
  }, [filters]);
  const [sort, setSortState] = useState<TableSort>(
      () =>
        named.sort ||
        (stored
          ? parseTableSort(readPreference(`scopearr-${tool}-sort`))
          : null),
    ),
    [page, setPage] = useState(
      () =>
        named.page ||
        (stored
          ? Math.max(
              1,
              Number(readSessionPreference(`scopearr-${tool}-page`)) || 1,
            )
          : 1),
    );
  const sortBy = (field: string) => {
    const next = nextTableSort(sort, field);
    setSortState(next);
    writePreference(`scopearr-${tool}-sort`, formatTableSort(next));
    if (resetPageOnSort) setPage(1);
  };
  // A sort the route set, or left out after Back/Forward, replaces the
  // stored one; later sorts write it in sortBy. Otherwise the stored value
  // stays, also one the page cannot read.
  useEffect(() => {
    const value = formatTableSort(sort);
    if (
      route &&
      (named.sort || route.fromHistory) &&
      value !== (readPreference(`scopearr-${tool}-sort`) || "")
    )
      writePreference(`scopearr-${tool}-sort`, value);
  }, []);
  useEffect(() => {
    writeSessionPreference(`scopearr-${tool}-page`, String(page));
  }, [page]);
  const query = route
    ? toolRouteQuery(
        (Object.keys(TOOLS) as ToolView[]).find(
          (view) => TOOLS[view].storage === tool,
        )!,
        { filters, sort, page },
      )
    : "";
  useEffect(() => {
    route?.replace(query);
  }, [query]);
  return { filters, setFilters, changeFilters, sort, sortBy, page, setPage };
}
