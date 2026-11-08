import type { RefObject } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";

// Whether the table in a table card's region is wider than the region
// (docs/STYLEGUIDE.md, Part 1, 10.10, V7). A ResizeObserver watches the
// region and its table (a new table, after an empty state, replaces the
// old one); a difference below half a pixel is rounding, no overflow.
// Measured before the first paint, so the header never sticks first and
// then scrolls.
export function useTableOverflow(scroll: RefObject<HTMLElement>): boolean {
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const region = scroll.current;
    if (!region) return;
    let table: Element | null = null;
    const measure = () => {
      const next = region.querySelector("table");
      if (next !== table) {
        if (table) observer.unobserve(table);
        table = next;
        if (table) observer.observe(table);
      }
      setOverflow(
        !!table &&
          table.getBoundingClientRect().width >
            region.getBoundingClientRect().width + 0.5,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    measure();
    return () => observer.disconnect();
  }, [scroll]);
  return overflow;
}
