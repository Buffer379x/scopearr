import type { ComponentChildren, JSX } from "preact";

// A settings card (docs/STYLEGUIDE.md, Part 1, 11.4): a section named by
// its title, its head line (the title, then `head` on the right) and its
// body; `look` "v2-card--inset" makes it a card inside a card, with an h3.
// A helper, not a component, so the caller's tree holds the card itself.
export function card(
  id: string,
  title: ComponentChildren,
  body: ComponentChildren,
  head?: ComponentChildren,
  look = "v2-card",
): JSX.Element {
  const Title = look === "v2-card" ? "h2" : "h3";
  return (
    <section class={look + " v2-set-card"} aria-labelledby={id + "-title"}>
      <div class="v2-set-head">
        <Title id={id + "-title"}>{title}</Title>
        {head}
      </div>
      {body}
    </section>
  );
}

// A color table of Display → Colors (11.4): an inset v2 table card of
// the column heads and the rows (a key and its cells); each cell names its
// column (data-label) for the card rows of a narrow card, where the
// preview (the first cell) takes two places; the column `num` is a number.
export function colorTable(
  heads: string[],
  rows: [string, ComponentChildren[]][],
  num?: number,
): JSX.Element {
  const look = (at: number) =>
    at ? (at === num ? "v2-table-num" : undefined) : "v2-table-wide";
  return (
    <div class="v2-table-card v2-card--inset">
      <div class="v2-table-scroll">
        <table class="v2-table">
          <thead>
            <tr>
              {heads.map((head, at) => (
                <th
                  key={head}
                  scope="col"
                  class={at === num ? "v2-table-num" : undefined}
                >
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, cells]) => (
              <tr key={key} class="v2-row">
                {cells.map((cell, at) => (
                  <td key={at} class={look(at)} data-label={heads[at]}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
