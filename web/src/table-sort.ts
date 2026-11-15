export type TableSort = { field: string; direction: "asc" | "desc" } | null;

// Ascending, then descending, then back to the table's default order.
export function nextTableSort(current: TableSort, field: string): TableSort {
  if (current?.field !== field) return { field, direction: "asc" };
  return current.direction === "asc" ? { field, direction: "desc" } : null;
}

export function parseTableSort(value: string | null): TableSort {
  const [field, direction] = (value || "").split(":");
  return field && (direction === "asc" || direction === "desc")
    ? { field, direction }
    : null;
}

export function formatTableSort(sort: TableSort) {
  return sort ? `${sort.field}:${sort.direction}` : "";
}
