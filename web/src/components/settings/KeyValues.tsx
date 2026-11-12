import type { ComponentChildren, JSX } from "preact";

// Key values (docs/STYLEGUIDE.md, Part 1, 10.4): dl.v2-kv with one div per
// row of its label (dt) and value (dd); an empty value reads "—". Two
// columns (v2-kv--2) put two pairs on a line, as the service status does.
export function KeyValues({
  rows,
  columns = 1,
}: {
  rows: { key: string; label: string; value: ComponentChildren }[];
  columns?: 1 | 2;
}): JSX.Element {
  return (
    <dl class={"v2-kv" + (columns === 2 ? " v2-kv--2" : "")}>
      {rows.map((row) => (
        <div key={row.key}>
          <dt>{row.label}</dt>
          <dd>
            {row.value == null || row.value === false || row.value === ""
              ? "—"
              : row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
