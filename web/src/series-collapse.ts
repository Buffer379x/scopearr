import { useEffect, useState } from "preact/hooks";

// The TV series the user collapsed in the library (rc.3 K3, docs/STYLEGUIDE.md,
// Part 1, 10.10): every series starts expanded, as in 1.7.0; its Info
// column's chevron hides its season and episode rows and shows them again.
// Only this session's memory holds the choice (nothing is stored, not even
// in the browser), so it outlasts a page, sort, filter or route change and
// ends with a reload. A series is "service/mediaId", as the table groups.
let collapsed: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export const seriesKey = (file: { service: string; mediaId: number }) =>
  file.service + "/" + file.mediaId;

// Shows (open) or hides a series' episodes; false when nothing changed.
export function setSeriesOpen(key: string, open: boolean): boolean {
  if (collapsed.has(key) !== open) return false;
  const next = new Set(collapsed);
  if (open) next.delete(key);
  else next.add(key);
  collapsed = next;
  for (const listener of listeners) listener();
  return true;
}

// The collapsed series; the component renders again on every change.
export function useCollapsedSeries(): ReadonlySet<string> {
  const [current, setCurrent] = useState(collapsed);
  useEffect(() => {
    const listener = () => setCurrent(collapsed);
    listeners.add(listener);
    listener();
    return () => void listeners.delete(listener);
  }, []);
  return current;
}
