import { useEffect, useState } from "preact/hooks";

// Whether the page is scrolled past `threshold` pixels (docs/STYLEGUIDE.md,
// Part 1, 10.1): the topbar turns into glass from 4px on. A passive scroll
// listener; the first render already reads the position.
export function useScrolled(threshold = 4): boolean {
  const [scrolled, setScrolled] = useState(() => window.scrollY > threshold);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > threshold);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [threshold]);
  return scrolled;
}
