import { useRef, useState } from "preact/hooks";
import { Scissors, CircleMinus } from "lucide-preact";
import { api } from "../api";
import { confirmAction, confirmDeletion } from "../confirmation";
import { t } from "../i18n";
import { notify } from "../notifications";
import { ICON } from "../ui";
import { fileKey } from "../hooks/useFileSelection";
import type { FileKey, MuxJob } from "../types";
import { Modal } from "./Modal";
type Report = {
  done: number;
  total: number;
  marked: number;
  already: number;
  removed: number;
  skipped: number;
  errors: { file: string; reason: string }[];
};
export function MuxSelectionActions({
  files,
  jobs,
  installed,
  changed,
}: {
  files: FileKey[];
  jobs: MuxJob[];
  installed: boolean;
  changed: () => Promise<void>;
}) {
  const [working, setWorking] = useState(false),
    [report, setReport] = useState<Report | null>(null);
  const cancel = useRef(false),
    lock = useRef(false);
  const jobMap = new Map(jobs.map((j) => [j.service + ":" + j.fileId, j]));
  const marked = files.filter((k) => jobMap.has(fileKey(k))).length;
  const run = async (remove: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setWorking(true);
    const targets = remove
      ? files.filter((k) => jobMap.has(fileKey(k)))
      : files.slice(0, 200);
    try {
      const n = targets.length;
      if (n > 1) {
        const accepted = remove
          ? await confirmDeletion(
              t(
                "Remove mux marking for {count} files? Media files are not changed.",
                { count: n },
              ),
              false,
              t("Remove mux marking ({count})", { count: n }),
            )
          : await confirmAction(
              t(
                "Mark {count} files for muxing? Each file is checked with mkvmerge. This may take some time. Media files are not changed.",
                { count: n },
              ) +
                (files.length > 200
                  ? " " +
                    t(
                      "Only the first 200 of {count} selected files will be marked.",
                      { count: files.length },
                    )
                  : ""),
              t("Mark ({count})", { count: n }),
            );
        if (!accepted) return;
      }
      cancel.current = false;
      const next: Report = {
        done: 0,
        total: n,
        marked: 0,
        already: 0,
        removed: 0,
        skipped: 0,
        errors: [],
      };
      setReport({ ...next });
      for (const key of targets) {
        if (cancel.current) break;
        const job = jobMap.get(fileKey(key));
        try {
          if (remove) {
            if (
              !job ||
              ["running", "queued"].includes(job.status) ||
              job.backupName
            )
              next.skipped++;
            else {
              await api("mux/jobs?id=" + job.id, "DELETE");
              next.removed++;
            }
          } else if (job) next.already++;
          else {
            await api("mux/jobs", "POST", {
              service: key.service,
              fileId: key.id,
            });
            next.marked++;
          }
        } catch (e) {
          next.errors.push({
            file: key.filename || key.title || fileKey(key),
            reason: (e as Error).message,
          });
        }
        next.done++;
        setReport({ ...next, errors: [...next.errors] });
      }
      await changed();
      notify(
        remove
          ? t("{count} mux markings removed.", { count: next.removed })
          : t("{count} files marked for muxing.", { count: next.marked }),
        next.errors.length ? "warning" : "success",
      );
    } finally {
      lock.current = false;
      setWorking(false);
    }
  };
  const unavailable = t(
    !files.length
      ? "Select entries first."
      : !installed
        ? "Install MKVToolNix first."
        : "Mark selected files for muxing",
  );
  return (
    <>
      <button
        class="button selection-action"
        type="button"
        disabled={working || !files.length || !installed}
        title={unavailable}
        onClick={() => void run(false)}
      >
        <Scissors size={ICON.label} />
        {t("Mark for muxing ({count})", { count: files.length })}
      </button>
      <button
        class="button selection-action"
        type="button"
        disabled={working || !marked}
        title={t(
          !files.length
            ? "Select entries first."
            : !marked
              ? "None of the selected files is marked."
              : "Remove mux marking",
        )}
        onClick={() => void run(true)}
      >
        <CircleMinus size={ICON.label} />
        {t("Remove mux marking ({count})", { count: marked })}
      </button>
      {report && (
        <Modal
          wide={report.errors.length > 0}
          title={t(working ? "Processing selection" : "Selection results")}
          close={() => {
            if (working) cancel.current = true;
            else setReport(null);
          }}
        >
          <div aria-live="polite">
            <progress max={Math.max(1, report.total)} value={report.done} />
            <p>
              {t("{done} of {total}", {
                done: report.done,
                total: report.total,
              })}
            </p>
          </div>
          <p>
            {t("{marked} marked · {already} already marked · {failed} failed", {
              marked: report.marked,
              already: report.already,
              failed: report.errors.length,
            })}
          </p>
          {!!(report.removed || report.skipped) && (
            <p>
              {t("{removed} removed · {skipped} skipped", {
                removed: report.removed,
                skipped: report.skipped,
              })}
            </p>
          )}
          {report.done < report.total && !working && (
            <p class="notice">{t("Cancelled after the current file.")}</p>
          )}
          {!!report.errors.length && (
            <div class="table-wrap">
              <table class="detail-table stack-mobile">
                <thead>
                  <tr>
                    <th scope="col">{t("File")}</th>
                    <th scope="col">{t("Reason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.errors.map((e) => (
                    <tr>
                      <td data-label={t("File")}>{e.file}</td>
                      <td data-label={t("Reason")}>{e.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div class="modal-actions">
            <button
              class="button"
              type="button"
              onClick={() => {
                if (working) cancel.current = true;
                else setReport(null);
              }}
            >
              {t(working ? "Cancel" : "Close")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
