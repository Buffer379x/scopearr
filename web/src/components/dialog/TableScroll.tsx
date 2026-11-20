import type { ComponentChildren, JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { useTableOverflow } from "../../hooks/useTableOverflow";

// The region of a table in a dialog (docs/STYLEGUIDE.md, Part 1, 10.9 and
// 10.10): div.v2-table-scroll, which becomes a named, focusable region
// (the keyboard scrolls it) once its table is wider than it is, or while
// it has focus, so it never changes size when it gets focus.
export function TableScroll({
  label,
  children,
}: {
  label: string;
  children: ComponentChildren;
}): JSX.Element {
  const scroll = useRef<HTMLDivElement>(null);
  const overflow = useTableOverflow(scroll);
  const [focused, setFocused] = useState(false);
  const named = overflow || focused;
  return (
    <div
      ref={scroll}
      class="v2-table-scroll"
      role={named ? "region" : undefined}
      aria-label={named ? label : undefined}
      tabIndex={named ? 0 : undefined}
      data-overflow={overflow ? "" : undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {children}
    </div>
  );
}
