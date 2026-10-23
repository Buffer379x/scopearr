import { ICON } from "../ui";
import { ArrowDown, ArrowDownUp, ArrowUp } from "lucide-preact";
import { t } from "../i18n";

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

export function SortableHeader({
  label,
  active,
  direction,
  onSort,
  className,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onSort: () => void;
  className?: string;
}) {
  return (
    <th
      title={label}
      scope="col"
      class={className}
      aria-sort={
        active ? (direction === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        class={"sort-button" + (active ? " current" : "")}
        onClick={onSort}
        aria-label={t("Sort by {field}", { field: label })}
        title={t(
          active && direction === "asc"
            ? "Sort {field} descending"
            : "Sort {field} ascending",
          { field: label },
        )}
      >
        <span class="sort-label">{label}</span>
        {active ? (
          direction === "asc" ? (
            <ArrowUp size={ICON.sort} />
          ) : (
            <ArrowDown size={ICON.sort} />
          )
        ) : (
          <ArrowDownUp size={ICON.sort} />
        )}
      </button>
    </th>
  );
}
