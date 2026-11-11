import { useRef, useState } from "preact/hooks";
import { api } from "../api";
import { confirmAction, confirmDeletion } from "../confirmation";
import { fileKey } from "../file-selection";
import { t } from "../i18n";
import { processMuxSelection } from "../mux-selection";
import { notify } from "../notifications";
import type { FileKey, MuxJob } from "../types";

// Marking the selected files for muxing and removing their marks, the logic
// its views share (the library's SelectionTools and Muxing's Remove mux
// marking; the 1.7.0 MuxSelectionActions left in Phase 5b): more than one
// file asks first, marking skips files that
// already have a job, removing skips running, queued and backed-up jobs,
// `done` of `total` counts the files handled, one run at a time, and one
// toast tells the result. `installed` is MKVToolNix: without it nothing is
// marked.
export function useMuxSelection({
  files,
  jobs,
  installed,
  changed,
  busyChanged,
}: {
  files: FileKey[];
  jobs: MuxJob[];
  installed: boolean;
  changed(): Promise<void>;
  busyChanged(busy: boolean): void;
}): {
  working: "mark" | "remove" | null;
  done: number;
  total: number;
  marked: number;
  removable: number;
  run(remove: boolean): Promise<void>;
} {
  const [working, setWorking] = useState<"mark" | "remove" | null>(null);
  const [done, setDone] = useState(0),
    [total, setTotal] = useState(0);
  const lock = useRef(false);
  const jobMap = new Map(jobs.map((j) => [j.service + ":" + j.fileId, j]));
  const marked = files.filter((k) => jobMap.has(fileKey(k))).length;
  const removable = files.filter((k) => {
    const j = jobMap.get(fileKey(k));
    return j && !j.backupName && !["running", "queued"].includes(j.status);
  }).length;
  const run = async (remove: boolean) => {
    if (lock.current || (!remove && !installed)) return;
    lock.current = true;
    setWorking(remove ? "remove" : "mark");
    busyChanged(true);
    const targets = remove
      ? files.filter((k) => jobMap.has(fileKey(k)))
      : files;
    const n = targets.length;
    setDone(0);
    setTotal(n);
    try {
      if (n > 1) {
        const accepted = remove
          ? await confirmDeletion(
              t("You are about to remove mux marking for {count} items.", {
                count: n,
              }),
              false,
              t("Remove"),
            )
          : await confirmAction(
              t("You are about to mark {count} items for muxing.", {
                count: n,
              }),
              t("Mark"),
            );
        if (!accepted) return;
      }
      const result = await processMuxSelection(
        targets,
        jobs,
        remove,
        (path, method, body) =>
          api(path, method, body, undefined, { notifyErrors: false }),
        setDone,
      );
      const skipped =
        remove && result.skipped
          ? " " +
            t("{count} running, queued or backed-up jobs skipped.", {
              count: result.skipped,
            })
          : "";
      if (result.failed)
        notify(
          t(
            remove
              ? "{ok} removed, {failed} not possible: {reason}"
              : "{ok} marked, {failed} not possible: {reason}",
            { ok: result.ok, failed: result.failed, reason: result.reason },
          ) + skipped,
          "warning",
        );
      else if (remove)
        notify(
          t(
            result.ok === 1
              ? "Mux marking removed."
              : "{count} mux markings removed.",
            { count: result.ok },
          ) + skipped,
        );
      // A marking offers the way to its jobs (V14).
      else if (result.ok)
        notify(
          t(
            n === 1 ? "Marked for muxing." : "{count} items marked for muxing.",
            { count: result.ok },
          ),
          undefined,
          undefined,
          { label: t("Open Muxing"), hash: "#/tools/mux" },
        );
      await changed();
    } catch {
      /* api() reports refresh failures. */
    } finally {
      lock.current = false;
      setWorking(null);
      busyChanged(false);
    }
  };
  return { working, done, total, marked, removable, run };
}
