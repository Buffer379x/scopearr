import { ArrowDown, ArrowUp, ChevronDown } from "lucide-preact";
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { t, useI18n } from "../../i18n";
import type { FilmSort } from "../../types";
import { ICON } from "../../ui";
import { Popover } from "../frame/Popover";

// The sort menu of a phone card list (docs/STYLEGUIDE.md, Part 1, 10.10;
// rc.4 R6), in place of the column heads: a small button "Sort: {field}"
// with the direction's arrow, named "Sort: {field}, ascending" or
// "…, descending" (what aria-sort says on a column head), that opens a
// Popover menu "Sort by" of menuitemradio entries, one per sortable field
// in column order (the audio tracks also by channels, as their head's
// menu), each named "Sort by {field}" and titled with what a press does.
// A press runs the column heads' cycle (onSort: ascending, descending,
// the default), returns focus to the button and closes the menu.
export function SortMenu({
  fields,
  sort,
  label,
  onSort,
}: {
  fields: { field: string; label: string }[];
  sort: FilmSort;
  // The label of the field the list is sorted by.
  label: string;
  onSort(field: string): void;
}): JSX.Element {
  useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const Arrow = sort.direction === "asc" ? ArrowUp : ArrowDown;
  const [before, after = ""] = t("Sort: {field}", { field: "\u0000" }).split(
    "\u0000",
  );
  const name = t(
    sort.direction === "asc"
      ? "Sort: {field}, ascending"
      : "Sort: {field}, descending",
    { field: label },
  );
  const title = t("Sort by");
  const next = (entry: string, current: boolean) =>
    t(
      current && sort.direction === "desc"
        ? "Restore default sort"
        : current
          ? "Sort {field} descending"
          : "Sort {field} ascending",
      { field: entry },
    );
  return (
    <>
      <button
        type="button"
        class="v2-btn v2-btn--sm v2-table-sort"
        aria-label={name}
        title={name}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(event) =>
          setAnchor(anchor ? null : (event.currentTarget as HTMLElement))
        }
      >
        <span class="v2-table-sort-text">
          {before}
          <b>{label}</b>
          {after}
        </span>
        <Arrow size={ICON.arrow} class="v2-table-sort-arrow" />
        <ChevronDown size={ICON.sort} class="v2-table-sort-chev" />
      </button>
      {anchor && (
        <Popover
          anchor={anchor}
          placement="bottom-end"
          role="menu"
          label={title}
          close={() => setAnchor(null)}
        >
          <p class="v2-pop-title" role="none">
            {title}
          </p>
          {fields.map((entry) => {
            const current = entry.field === sort.field;
            return (
              <button
                key={entry.field}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                class="v2-menu-item"
                aria-label={t("Sort by {field}", { field: entry.label })}
                title={next(entry.label, current)}
                onClick={() => {
                  anchor.focus();
                  setAnchor(null);
                  onSort(entry.field);
                }}
              >
                <span class="v2-menu-text">{entry.label}</span>
                {current && <Arrow size={ICON.arrow} />}
              </button>
            );
          })}
        </Popover>
      )}
    </>
  );
}
