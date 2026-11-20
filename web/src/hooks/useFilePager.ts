import { useEffect, useRef, useState } from "preact/hooks";
import type { FilePager } from "../components/FileDialog";
import { filePager, type FileStep } from "../file-paging";
import type { MediaFile, Results } from "../types";

// Paging File & metadata through the whole filtered list (Phase 5d, E16,
// R-G, user decision F2): `position` is the open file's place on the
// loaded page (null when it is not there). A step on the page opens that
// file; a step past its end turns the list's page (setPage, like the
// pager) and opens the first or last file of the next answer for that
// page. Meanwhile the pager is busy and the dialog keeps the file it
// shows. `loading` is the list's request: when it ends without that page
// (it failed, and api() has shown its error), the step is given up, the
// list returns to the page it shows and the pager unlocks. In the season
// view (`grouped`) paging stays on the loaded page; a page of series
// (rc.4 R2) counts its place from the answer's offset. `active` is false
// while File & metadata is closed: closing during a page turn drops the
// step, so the page's answer opens nothing (position null is no signal,
// it is null while the step waits too). A page of series summaries (D33a)
// passes `entries`, every file of the page with the ones the answer holds:
// a step onto a file it lacks asks `load` for it (its series opens) and
// waits for the answer that holds it; when that ends without it, the step
// is given up.
export function useFilePager({
  results,
  entries,
  load,
  position,
  grouped,
  active,
  loading,
  setPage,
  open,
}: {
  results: Results;
  entries?: (MediaFile | undefined)[];
  load?(index: number): void;
  position: number | null;
  grouped: boolean;
  active: boolean;
  loading: boolean;
  setPage(page: number): void;
  open(file: MediaFile): void;
}): FilePager | undefined {
  // The step that waits for the answer of its page.
  const [pending, setPending] = useState<FileStep | null>(null),
    asked = useRef(false),
    // The step asked load for its file.
    fetched = useRef(false),
    // The page that holds the open file while a step waits.
    origin = useRef(0);
  useEffect(() => {
    if (!active) setPending(null);
  }, [active]);
  useEffect(() => {
    if (!pending || !active) return;
    if (results.page !== pending.page) {
      if (loading) asked.current = true;
      else if (asked.current) {
        setPending(null);
        setPage(results.page);
      }
      return;
    }
    const files = entries ?? results.files,
      at = pending.position === "last" ? files.length - 1 : pending.position;
    if (!files[at] && at >= 0 && at < files.length && load) {
      if (loading) return;
      if (!fetched.current) {
        fetched.current = true;
        load(at);
        return;
      }
    }
    setPending(null);
    if (files[at]) open(files[at]);
    // The list shrank meanwhile and the page has no file there: back to
    // the page that holds the open file, so its count returns.
    else setPage(origin.current);
  }, [results, pending, loading, active]);
  const last = useRef<FilePager>();
  if (position === null) return pending ? last.current : undefined;
  const model = filePager({
    page: results.page,
    pageSize: results.pageSize,
    total: results.total,
    position,
    count: (entries ?? results.files).length,
    grouped,
    series:
      results.pagedBy === "series"
        ? {
            offset: results.offset ?? 0,
            pages: Math.max(
              1,
              Math.ceil(results.displayTotal / results.pageSize),
            ),
          }
        : undefined,
  });
  const step = (to: FileStep | null) =>
    to && !pending
      ? () => {
          const file =
            to.position === "last"
              ? undefined
              : (entries ?? results.files)[to.position];
          if (to.page === results.page && file) open(file);
          else {
            asked.current = false;
            fetched.current = false;
            origin.current = results.page;
            setPending(to);
            if (to.page !== results.page) setPage(to.page);
          }
        }
      : undefined;
  last.current = {
    index: model.index,
    total: model.total,
    prev: step(model.prev),
    next: step(model.next),
    busy: !!pending,
  };
  return last.current;
}
