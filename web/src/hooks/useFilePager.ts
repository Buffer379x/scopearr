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
// view (`grouped`) paging stays on the loaded page. `active` is false
// while File & metadata is closed: closing during a page turn drops the
// step, so the page's answer opens nothing (position null is no signal,
// it is null while the step waits too).
export function useFilePager({
  results,
  position,
  grouped,
  active,
  loading,
  setPage,
  open,
}: {
  results: Results;
  position: number | null;
  grouped: boolean;
  active: boolean;
  loading: boolean;
  setPage(page: number): void;
  open(file: MediaFile): void;
}): FilePager | undefined {
  // The step that waits for the answer of its page.
  const [pending, setPending] = useState<FileStep | null>(null),
    asked = useRef(false);
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
    const { files } = results,
      at = pending.position === "last" ? files.length - 1 : pending.position;
    setPending(null);
    if (files[at]) open(files[at]);
  }, [results, pending, loading, active]);
  const last = useRef<FilePager>();
  if (position === null) return pending ? last.current : undefined;
  const model = filePager({
    page: results.page,
    pageSize: results.pageSize,
    total: results.total,
    position,
    count: results.files.length,
    grouped,
  });
  const step = (to: FileStep | null) =>
    to && !pending
      ? () => {
          if (to.page === results.page && to.position !== "last")
            open(results.files[to.position]);
          else {
            asked.current = false;
            setPending(to);
            setPage(to.page);
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
