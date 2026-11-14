import { ArrowDown, ArrowDownUp, ArrowUp } from "lucide-preact";
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { t, useI18n } from "../../i18n";
import type { FilmSort } from "../../types";
import { ICON } from "../../ui";
import { Popover } from "../frame/Popover";
import type { TableSort } from "../SortableHeader";

// SortHeader takes a FilmSort: without a sort, the fallback field is
// active (rules: "priority", as 1.7.0 shows it; the log: "", no header).
export function asFilmSort(sort: TableSort, fallback: string): FilmSort {
  return sort
    ? { field: sort.field, direction: sort.direction }
    : { field: fallback, direction: "asc" };
}

// A sortable column header (docs/STYLEGUIDE.md, Part 1, 10.10):
// th[scope="col"][aria-sort] with button.v2-sort, named "Sort by {field}".
// A press asks onSort(field); the caller cycles ascending, descending and
// its default (nextTableSort), and the title says what the press does, as
// in 1.7.0. With a menu the button opens a Popover menu of menuitemradio
// entries "Sort by {field}", one per field (the audio tracks column: audio,
// then channels); a choice sorts by its field and returns focus to the
// button, and aria-sort follows the active entry. A numeric column puts the
// arrow before its label and aligns right (v2-table-num); the title column
// grows (v2-table-title). The explicit role keeps the header a column
// header when a narrow card turns the head into a sort bar.
export function SortHeader({
  label,
  field,
  sort,
  onSort,
  numeric = false,
  grow = false,
  menu,
}: {
  label: string;
  field: string;
  sort: FilmSort;
  onSort(field: string): void;
  numeric?: boolean;
  grow?: boolean;
  menu?: { fields: { field: string; label: string }[] };
}): JSX.Element {
  useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const fields = menu?.fields ?? [{ field, label }];
  const active = fields.some((entry) => entry.field === sort.field);
  const Arrow = active
    ? sort.direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowDownUp;
  // What a press on an entry does: the next step of the cycle.
  const next = (name: string, current: boolean) =>
    t(
      current && sort.direction === "desc"
        ? "Restore default sort"
        : current
          ? "Sort {field} descending"
          : "Sort {field} ascending",
      { field: name },
    );
  const name = t("Sort by {field}", { field: label });
  return (
    <th
      scope="col"
      role="columnheader"
      class={numeric ? "v2-table-num" : grow ? "v2-table-title" : undefined}
      aria-sort={
        active
          ? sort.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button
        type="button"
        class={"v2-sort" + (numeric ? " v2-sort--num" : "")}
        aria-label={name}
        title={menu ? name : next(label, active)}
        aria-haspopup={menu ? "menu" : undefined}
        aria-expanded={menu ? !!anchor : undefined}
        onClick={(event) =>
          menu ? setAnchor(anchor ? null : event.currentTarget) : onSort(field)
        }
      >
        {label}
        <Arrow size={ICON.arrow} class="v2-sort-arrow" />
      </button>
      {menu && anchor && (
        <Popover
          anchor={anchor}
          placement="bottom-end"
          role="menu"
          label={name}
          close={() => setAnchor(null)}
        >
          {menu.fields.map((entry) => {
            const current = entry.field === sort.field;
            return (
              <button
                key={entry.field}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                class="v2-menu-item"
                title={next(entry.label, current)}
                onClick={() => {
                  anchor.focus();
                  setAnchor(null);
                  onSort(entry.field);
                }}
              >
                <span class="v2-menu-text">
                  {t("Sort by {field}", { field: entry.label })}
                </span>
                {current && <Arrow size={ICON.arrow} />}
              </button>
            );
          })}
        </Popover>
      )}
    </th>
  );
}
