import { LoaderCircle } from "lucide-preact";
import type { ComponentChildren, JSX } from "preact";
import { useRef, useState } from "preact/hooks";
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
// Focused, it stays one until focus leaves it, so focus never falls to the
// page when the overflow ends.
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
  const [focused, setFocused] = useState(false);
  const named = overflow || focused;
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
        role={named ? "region" : undefined}
        aria-label={named ? regionLabel : undefined}
        tabIndex={named ? 0 : undefined}
        data-overflow={overflow ? "" : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {children}
      </div>
      <div class="v2-tc-foot">{foot}</div>
    </section>
  );
}

// The parts of a catalog text around its {count}; a bracket right around
// the placeholder goes, as the count slot frames the number itself.
export function countParts(text: string): [string, string] {
  const at = text.indexOf("{count}");
  if (at < 0) return [text, ""];
  return [
    text.slice(0, at).replace(/\s*\($/, ""),
    text.slice(at + "{count}".length).replace(/^\)/, ""),
  ];
}

// A page tool with a number in the chips row (docs/STYLEGUIDE.md, Part 1,
// 10.10), such as the selection actions: v2-btn v2-btn--sm with its icon,
// the catalog text around its {count} (`text`, the untranslated-parameter
// form of t()) in span.v2-tc-label, hidden below a card width of 1060, and
// the number in the button's count slot, so the label never carries the
// number. The slot holds, hidden, the largest number the tool can show
// (`max`, such as the page size), so it is always as wide as that and no
// count change moves a tool. It is on from 1, or while `on` (a run's
// progress). Its name and title carry the whole text with the number.
export function CountTool({
  icon,
  text,
  count: n,
  max,
  on = false,
  name,
  title,
  disabled,
  onClick,
}: {
  icon: ComponentChildren;
  text: string;
  count: number;
  max: number;
  on?: boolean;
  name: string;
  title: string;
  disabled: boolean;
  onClick(): void;
}): JSX.Element {
  const [before, after] = countParts(text);
  return (
    <button
      type="button"
      class="v2-btn v2-btn--sm"
      aria-label={name}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {before && <span class="v2-tc-label">{before}</span>}
      <span
        class={"v2-count" + (n || on ? " v2-count--on" : "")}
        aria-hidden="true"
      >
        <span class="v2-count-num">{count(n)}</span>
        <span class="v2-count-max">{count(Math.max(n, max))}</span>
      </span>
      {after && <span class="v2-tc-label">{after}</span>}
    </button>
  );
}
