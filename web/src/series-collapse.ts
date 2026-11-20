import { useEffect, useState } from "preact/hooks";

// The TV series the user collapsed or opened in the library (rc.3 K3, rc.4
// R2, docs/STYLEGUIDE.md, Part 1, 10.10). In the expanded view (the
// default) every series starts expanded, as in 1.7.0, and `collapsed` holds
// the ones whose Info column's chevron hid their season and episode rows;
// in the collapsed series view (a page of series) every series starts
// collapsed and `opened` holds the ones shown again. Only this session's
// memory holds the choice (nothing is stored, not even in the browser), so
// it outlasts a page, sort, filter or route change and ends with a reload;
// "Collapse all series", "Expand all series" and a dashboard link start
// their view again (resetSeries). A series is "service/mediaId", as the
// table groups.
type SeriesState = {
  collapsed: ReadonlySet<string>;
  opened: ReadonlySet<string>;
};
let state: SeriesState = { collapsed: new Set(), opened: new Set() };
const listeners = new Set<() => void>();
const changed = (next: SeriesState) => {
  state = next;
  for (const listener of listeners) listener();
};

export const seriesKey = (file: { service: string; mediaId: number }) =>
  file.service + "/" + file.mediaId;

// Shows (open) or hides a series' episodes in the expanded view, or with
// `seriesView` in the collapsed series view; false when nothing changed.
export function setSeriesOpen(
  key: string,
  open: boolean,
  seriesView = false,
): boolean {
  const field = seriesView ? "opened" : "collapsed",
    listed = seriesView === open;
  if (state[field].has(key) === listed) return false;
  const next = new Set(state[field]);
  if (listed) next.add(key);
  else next.delete(key);
  changed({ ...state, [field]: next });
  return true;
}

// Starts a view again: every series expanded (the expanded view) or
// collapsed (`seriesView`).
export function resetSeries(seriesView: boolean): void {
  const field = seriesView ? "opened" : "collapsed";
  if (state[field].size) changed({ ...state, [field]: new Set() });
}

// The series collapsed in the expanded view, or with `seriesView` the ones
// opened in the collapsed view; the component renders again on every
// change.
function useSeries(field: keyof SeriesState): ReadonlySet<string> {
  const [current, setCurrent] = useState(state[field]);
  useEffect(() => {
    const listener = () => setCurrent(state[field]);
    listeners.add(listener);
    listener();
    return () => void listeners.delete(listener);
  }, [field]);
  return current;
}
export const useCollapsedSeries = () => useSeries("collapsed");
export const useOpenedSeries = () => useSeries("opened");
