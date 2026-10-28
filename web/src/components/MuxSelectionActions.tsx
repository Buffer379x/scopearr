import { useRef, useState } from "preact/hooks";
import { Scissors, CircleMinus, LoaderCircle } from "lucide-preact";
import { api } from "../api";
import { confirmAction, confirmDeletion } from "../confirmation";
import { t } from "../i18n";
import { notify } from "../notifications";
import { ICON, count } from "../ui";
import { fileKey } from "../file-selection";
import { processMuxSelection } from "../mux-selection";
import type { FileKey, MuxJob } from "../types";
export function MuxSelectionActions({
  files,
  jobs,
  installed,
  changed,
  busyChanged,
  actions = ["mark", "remove"],
  busy = false,
  compact = false,
}: {
  compact?: boolean;
  actions?: ("mark" | "remove")[];
  busy?: boolean;
  files: FileKey[];
  jobs: MuxJob[];
  installed: boolean;
  changed: () => Promise<void>;
  busyChanged: (busy: boolean) => void;
}) {
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
    if (lock.current) return;
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
      else if (result.ok)
        notify(
          t(
            n === 1 ? "Marked for muxing." : "{count} items marked for muxing.",
            { count: result.ok },
          ),
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
  const markLabel =
    working === "mark"
      ? t("Marking … {done}/{total}", { done, total })
      : t("Mark for muxing ({count})", { count: files.length });
  const removeLabel =
    working === "remove"
      ? t("Removing … {done}/{total}", { done, total })
      : t("Remove mux marking ({count})", { count: marked });
  return (
    <>
      {actions.includes("mark") && (
        <button
          class={
            "button selection-action" +
            (compact ? " compact-selection-action" : "")
          }
          type="button"
          disabled={busy || !!working || !files.length || !installed}
          aria-label={markLabel}
          title={
            markLabel +
            " · " +
            t(
              !files.length
                ? "Select entries first."
                : !installed
                  ? "Install MKVToolNix first."
                  : "Mark selected files for muxing",
            )
          }
          onClick={() => void run(false)}
        >
          {working === "mark" ? (
            <LoaderCircle class="spin" size={ICON.label} />
          ) : (
            <Scissors size={ICON.label} />
          )}
          <span class="selection-action-label">{markLabel}</span>
          {compact && (
            <span class="selection-action-count" aria-hidden="true">
              {count(files.length)}
            </span>
          )}
        </button>
      )}
      {actions.includes("remove") && (
        <button
          class={
            "button selection-action" +
            (compact ? " compact-selection-action" : "")
          }
          type="button"
          disabled={busy || !!working || !marked || !removable}
          aria-label={removeLabel}
          title={
            removeLabel +
            " · " +
            t(
              !files.length
                ? "Select entries first."
                : !marked
                  ? "None of the selected files is marked."
                  : !removable
                    ? "None of the selected jobs can be removed."
                    : "Remove mux marking",
            )
          }
          onClick={() => void run(true)}
        >
          {working === "remove" ? (
            <LoaderCircle class="spin" size={ICON.label} />
          ) : (
            <CircleMinus size={ICON.label} />
          )}
          <span class="selection-action-label">{removeLabel}</span>
          {compact && (
            <span class="selection-action-count" aria-hidden="true">
              {count(marked)}
            </span>
          )}
        </button>
      )}
    </>
  );
}
