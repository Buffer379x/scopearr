import { useEffect, useRef } from "preact/hooks";

// The focus return of a tool page's filter drawer (fix wave F-M4, once
// for Muxing, Disk placement and Files & permissions): `drawer` is the
// Filters button that opened it, null while it is closed. Once it has
// closed, focus goes back to that button, unless focus went elsewhere
// meanwhile or the button is gone.
export function useDrawerAnchor(drawer: HTMLElement | null): void {
  const anchor = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (drawer) {
      anchor.current = drawer;
      return;
    }
    const last = anchor.current;
    anchor.current = null;
    const focused = document.activeElement;
    if (last?.isConnected && (!focused || focused === document.body))
      last.focus({ preventScroll: true });
  }, [drawer]);
}
