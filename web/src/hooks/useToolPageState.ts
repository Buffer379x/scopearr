import { useEffect, useState } from "preact/hooks";
import {
  readPreference,
  readSessionPreference,
  readToolFilters,
  writePreference,
  writeSessionPreference,
} from "../browser-storage";
import {
  formatTableSort,
  nextTableSort,
  parseTableSort,
  type TableSort,
} from "../components/SortableHeader";

// Filters and sort persist in localStorage (scopearr-<tool>-filters/-sort),
// the page per tab in sessionStorage (scopearr-<tool>-page).
export function useToolPageState(
  tool: "mux" | "placement" | "filecheck",
  allowed: Parameters<typeof readToolFilters>[1],
  { resetPageOnSort }: { resetPageOnSort: boolean },
) {
  const [filters, setFilters] = useState(() =>
    readToolFilters(`scopearr-${tool}-filters`, allowed),
  );
  const changeFilters = (patch: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };
  useEffect(() => {
    writePreference(`scopearr-${tool}-filters`, JSON.stringify(filters));
  }, [filters]);
  const [sort, setSortState] = useState<TableSort>(
      parseTableSort(readPreference(`scopearr-${tool}-sort`)),
    ),
    [page, setPage] = useState(() =>
      Math.max(1, Number(readSessionPreference(`scopearr-${tool}-page`)) || 1),
    );
  const sortBy = (field: string) => {
    const next = nextTableSort(sort, field);
    setSortState(next);
    writePreference(`scopearr-${tool}-sort`, formatTableSort(next));
    if (resetPageOnSort) setPage(1);
  };
  useEffect(() => {
    writeSessionPreference(`scopearr-${tool}-page`, String(page));
  }, [page]);
  return { filters, setFilters, changeFilters, sort, sortBy, page, setPage };
}
