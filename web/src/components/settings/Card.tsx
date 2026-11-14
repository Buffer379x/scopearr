import type { ComponentChildren, JSX } from "preact";

// A settings card (docs/STYLEGUIDE.md, Part 1, 11.4): a section named by
// its title, its head line (the title, then `head` on the right) and its
// body; `look` "v2-card--inset" makes it a card inside a card, with an h3.
// A helper, not a component, so the caller's tree holds the card itself;
// its id is its key in a list.
export function card(
  id: string,
  title: ComponentChildren,
  body: ComponentChildren,
  head?: ComponentChildren,
  look = "v2-card",
): JSX.Element {
  const Title = look === "v2-card" ? "h2" : "h3";
  return (
    <section
      key={id}
      class={look + " v2-set-card"}
      aria-labelledby={id + "-title"}
    >
      <div class="v2-set-head">
        <Title id={id + "-title"}>{title}</Title>
        {head}
      </div>
      {body}
    </section>
  );
}

// The cycle of a tag's text color: Automatic (none) -> Black -> White;
// each stored value with its name and the next value.
export const TEXT_CYCLE: Record<string, [string, string]> = {
  "#000000": ["Black", "#ffffff"],
  "#ffffff": ["White", ""],
};

// A settings v2 table (11.4): the column heads and the rows (a key, its
// cells and the row's own class); each cell names its column (data-label)
// for the card rows of a narrow card, where the `wide` cell (the first by
// default) takes two places; the column `num` is a number. `head` gives a
// column its own head (Tag rules' sort heads), else it is a plain th. A
// placeholder row (v2-row--placeholder) is hidden from assistive
// technology. `table` adds a class of the table's own (System → Log's
// fixed columns, v2-set-log); without it the DOM is as before.
export function table(
  heads: string[],
  rows: [string, ComponentChildren[], string?][],
  num?: number,
  head?: (at: number) => JSX.Element | undefined,
  wide = 0,
  table?: string,
): JSX.Element {
  const look = (at: number) =>
    at === wide ? "v2-table-wide" : at === num ? "v2-table-num" : undefined;
  return (
    <table class={table ? "v2-table " + table : "v2-table"}>
      <thead>
        <tr>
          {heads.map(
            (label, at) =>
              head?.(at) ?? (
                <th
                  key={label}
                  scope="col"
                  class={at === num ? "v2-table-num" : undefined}
                >
                  {label}
                </th>
              ),
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map(([key, cells, row]) => (
          <tr
            key={key}
            class={row ? "v2-row " + row : "v2-row"}
            aria-hidden={row === "v2-row--placeholder" ? "true" : undefined}
          >
            {cells.map((cell, at) => (
              <td key={at} class={look(at)} data-label={heads[at]}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// A color table of Display → Colors and Widgets, and Tag rules' preview
// (11.4): the settings table in an inset table card.
export function colorTable(
  heads: string[],
  rows: [string, ComponentChildren[]][],
  num?: number,
): JSX.Element {
  return (
    <div class="v2-table-card v2-card--inset">
      <div class="v2-table-scroll">{table(heads, rows, num)}</div>
    </div>
  );
}
