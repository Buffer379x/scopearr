import { LoaderCircle } from "lucide-preact";
import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import { useTableOverflow } from "../../hooks/useTableOverflow";
import type { Density } from "../../list-prefs";
import { count, ICON } from "../../ui";

// The results card of a list (docs/STYLEGUIDE.md, Part 1, 10.10):
// section.v2-card.v2-table-card, named by its title, with the head (title,
// count, spinner place and hint line on the left, the filter bar on the
// right), the chips row, the table region and the footer. Every place is
// always rendered, so no count, busy or hint change moves anything: busy
// only shows the spinner, the hint line keeps its place when empty. The
// region is a focusable named region only while its table overflows
// (ruling P11/M1); then it scrolls sideways and the header does not stick.
export function TableCard({
  id,
  title,
  count: total,
  countTitle,
  busy,
  hint,
  bar,
  chips,
  density,
  regionLabel,
  foot,
  children,
}: {
  id: string;
  title: ComponentChildren;
  count: number;
  countTitle: string;
  busy: boolean;
  hint?: ComponentChildren;
  bar: ComponentChildren;
  chips: ComponentChildren;
  density: Density;
  regionLabel: string;
  foot: ComponentChildren;
  children: ComponentChildren;
}): JSX.Element {
  const scroll = useRef<HTMLDivElement>(null);
  const overflow = useTableOverflow(scroll);
  return (
    <section
      class="v2-card v2-table-card"
      aria-labelledby={id + "-title"}
      data-density={density}
    >
      <div class="v2-tc-head">
        <div class="v2-tc-heading">
          <h2 id={id + "-title"} class="v2-tc-title">
            <span class="v2-tc-text">{title}</span>
            <span class="v2-count v2-count--on" title={countTitle}>
              {count(total)}
            </span>
            <span
              class={"v2-tc-busy" + (busy ? " v2-tc-busy--on" : "")}
              aria-hidden="true"
            >
              <LoaderCircle
                class={busy ? "v2-spin" : undefined}
                size={ICON.button}
              />
            </span>
          </h2>
          <p
            class="v2-tc-hint"
            title={typeof hint === "string" ? hint : undefined}
          >
            {hint}
          </p>
        </div>
        {bar}
      </div>
      {chips}
      <div
        ref={scroll}
        class="v2-table-scroll"
        aria-busy={busy}
        role={overflow ? "region" : undefined}
        aria-label={overflow ? regionLabel : undefined}
        tabIndex={overflow ? 0 : undefined}
        data-overflow={overflow ? "" : undefined}
      >
        {children}
      </div>
      <div class="v2-tc-foot">{foot}</div>
    </section>
  );
}
