import type { ComponentChildren, JSX } from "preact";
import { useI18n } from "../../i18n";
import type { TableSort } from "../../table-sort";
import { SelectionBox } from "../SelectionBox";
import { SortHeader } from "../list/SortHeader";

// A column of a tool table: its key (the 1.7.0 column ID, which names its
// width --tt-<key>), its label (translated), the 1.7.0 sort field when it
// sorts, and the 5a cell class it takes: numeric (v2-table-num), grow (the
// title, v2-table-title, no width of its own), wide (two card cells,
// v2-table-wide, the disks) or info (the Info buttons, v2-table-info, at
// the end of a card row's first line); a plain text column clips its
// cells (v2-table-clip: an ellipsis, as the 1.7.0 tool cells, its cell
// gives a text that can be cut its full text as title).
export type ToolColumn<T> = {
  key: string;
  label: string;
  sort?: string;
  numeric?: boolean;
  grow?: boolean;
  wide?: boolean;
  info?: boolean;
  clip?: boolean;
  cell(row: T): ComponentChildren;
};

const TT = "--tt-";
const NO_SORT = { field: "", direction: "asc" } as const;
const width = (key: string) => "width: var(" + TT + key + ")";
const role = (column: ToolColumn<unknown>) =>
  column.numeric
    ? "v2-table-num"
    : column.grow
      ? "v2-table-title"
      : column.wide
        ? "v2-table-wide"
        : column.info
          ? "v2-table-info"
          : undefined;
const cellClass = (column: ToolColumn<unknown>) =>
  column.clip
    ? [role(column), "v2-table-clip"].filter(Boolean).join(" ")
    : role(column);

// The table of a tool page (docs/STYLEGUIDE.md, Part 1, 10.10):
// table.v2-table.v2-table--fixed with the explicit table roles of
// MediaTable. Its widths never depend on its rows: a colgroup gives the
// selection and every column but the title its --tt-<key> (the style,
// from useToolColumnStyle), the title takes the rest. The selection
// column holds the page's tri-state box and each row's box, inside
// label.v2-table-hit (the 44 hit area on touch, ruling M15); only
// selectable rows count and can be chosen, every box locks while an
// action runs, and the page's box without selectable rows. With
// keepOthers the page's box adds or removes only the page's ids (Disk
// placement keeps its selection across pages). Sortable columns have a
// SortHeader (the 1.7.0 TableSort, null for its default), the others a
// th with their label. Rows are tr.v2-row, keyed by keyOf, with
// v2-row--selected and v2-row--removing (a removed row fades out and
// stays in the accessibility tree until it is gone); each cell names its
// column (data-label) and has its 5a class, so narrow cards apply.
export function ToolTable<T>(p: {
  rows: T[];
  keyOf(row: T): number;
  columns: ToolColumn<T>[];
  style: Record<string, string>;
  sort: TableSort;
  onSort(field: string): void;
  selection: {
    selected: number[];
    set(ids: number[]): void;
    selectable(row: T): boolean;
    disabled: boolean;
    allLabel: string;
    rowLabel(row: T): string;
    keepOthers?: boolean;
  };
  removing: Set<number>;
}): JSX.Element {
  useI18n();
  const { rows, keyOf, columns, selection } = p;
  const { selected } = selection;
  const ids = rows.filter((row) => selection.selectable(row)).map(keyOf);
  const chosen = ids.filter((id) => selected.includes(id));
  const page = (checked: boolean) =>
    selection.set(
      selection.keepOthers
        ? checked
          ? [...new Set([...selected, ...ids])]
          : selected.filter((id) => !ids.includes(id))
        : checked
          ? ids
          : [],
    );
  const box = (
    label: string,
    total: number,
    count: number,
    disabled: boolean,
    change: (checked: boolean) => void,
  ) => (
    <label class="v2-table-hit">
      <SelectionBox
        className="v2-check"
        label={label}
        total={total}
        count={count}
        disabled={disabled}
        change={change}
      />
    </label>
  );
  return (
    <table class="v2-table v2-table--fixed" role="table" style={p.style}>
      <colgroup>
        <col style={width("select")} />
        {columns.map((column) => (
          <col
            key={column.key}
            style={column.grow ? undefined : width(column.key)}
          />
        ))}
      </colgroup>
      <thead role="rowgroup">
        <tr role="row">
          <th role="columnheader" scope="col" class="v2-table-sel">
            {box(
              selection.allLabel,
              ids.length,
              chosen.length,
              selection.disabled || !ids.length,
              page,
            )}
          </th>
          {columns.map((column) =>
            column.sort ? (
              <SortHeader
                key={column.key}
                label={column.label}
                field={column.sort}
                sort={p.sort ?? NO_SORT}
                onSort={p.onSort}
                numeric={!!column.numeric}
                grow={!!column.grow}
              />
            ) : (
              <th
                key={column.key}
                role="columnheader"
                scope="col"
                class={
                  column.numeric
                    ? "v2-table-num"
                    : column.grow
                      ? "v2-table-title"
                      : undefined
                }
              >
                {column.label}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((row) => {
          const key = keyOf(row);
          const selectable = selection.selectable(row);
          const on = selectable && selected.includes(key);
          return (
            <tr
              key={key}
              role="row"
              class={
                "v2-row" +
                (on ? " v2-row--selected" : "") +
                (p.removing.has(key) ? " v2-row--removing" : "")
              }
            >
              <td role="cell" class="v2-table-sel">
                {box(
                  selection.rowLabel(row),
                  selectable ? 1 : 0,
                  on ? 1 : 0,
                  selection.disabled || !selectable,
                  (checked) =>
                    selection.set(
                      checked
                        ? [...selected, key]
                        : selected.filter((id) => id !== key),
                    ),
                )}
              </td>
              {columns.map((column) => (
                <td
                  key={column.key}
                  role="cell"
                  class={cellClass(column)}
                  data-label={column.label}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
