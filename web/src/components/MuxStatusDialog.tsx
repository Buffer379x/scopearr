import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import type { MuxJob } from "../types";
import { t, useI18n } from "../i18n";
import {
  effectiveMuxStatus,
  muxStatusLabels,
  muxStatusShort,
  routineMuxMessages,
} from "../mux-spec";
import { Modal } from "./Modal";
import { PathCheckRow, DetailRow } from "./MuxPathDialog";
export function MuxStatusTag({ job }: { job: MuxJob }) {
  const status = effectiveMuxStatus(job);
  return (
    <span
      class={
        "tag status-" +
        ({
          ready: "ok",
          succeeded: "ok",
          warning: "warn",
          needs_review: "warn",
          failed: "error",
          needs_attention: "error",
          queued: "wait",
          running: "running",
        }[status] || "neutral")
      }
      title={t(muxStatusLabels[status] || status)}
      aria-label={t(muxStatusLabels[status] || status)}
    >
      {t(muxStatusShort[status] || status)}
    </span>
  );
}
export function MuxStatusDialog({
  job: j,
  workDir,
  refresh,
  close,
  busy,
  options,
  terminal,
}: {
  options: () => void;
  terminal: () => void;
  job: MuxJob;
  workDir: boolean;
  refresh: () => Promise<void>;
  close: () => void;
  busy: boolean;
}) {
  const { locale } = useI18n();
  const needsDetail = !["draft", "ready", "failed", "cancelled"].includes(
    j.status,
  );
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<MuxJob>();
  const [loading, setLoading] = useState(needsDetail);
  useEffect(() => {
    if (!needsDetail) return;
    const request = new AbortController();
    setDetail(undefined);
    setLoading(true);
    api<MuxJob>(`mux/jobs?id=${j.id}`, "GET", undefined, request.signal)
      .then((value) => {
        if (!request.signal.aborted) setDetail(value);
      })
      .catch(() => {})
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, [j.id, needsDetail, revision]);
  const check = needsDetail ? detail?.check : j.check;
  const labels = {
    exists: "Media file exists",
    readable: "Readable",
    writable: "Directory writable",
    freeSpace: "Enough free space",
    workWritable: "Working directory writable",
    workFreeSpace: "Working directory free space",
    sizeMatches: "Size matches Radarr/Sonarr",
    unchanged: "File unchanged since identification",
  };
  return (
    <Modal title={t("Status")} close={close} className="mux-status-dialog">
      <div class="settings-section">
        <div class="filename-box">
          <code>{j.sourceName}</code>
        </div>
        <MuxStatusTag job={j} />
        {j.message && !routineMuxMessages.has(j.message) && (
          <p class="notice">{t(j.message)}</p>
        )}
        <div class="mux-check-list">
          {loading && (
            <p role="status" class="quiet">
              {t("Loading …")}
            </p>
          )}
          {check &&
            Object.entries(labels)
              .filter(([key]) => workDir || !key.startsWith("work"))
              .map(([key, label]) => (
                <PathCheckRow
                  ok={!!check[key as keyof typeof check]}
                  label={t(label)}
                />
              ))}
          {(
            [
              ["Created", j.createdAt],
              ["Updated", j.updatedAt],
              ["Finished", j.finishedAt],
            ] as const
          )
            .filter(([, v]) => v)
            .map(([label, value]) => (
              <DetailRow
                label={t(label)}
                value={new Date(value!).toLocaleString(locale)}
              />
            ))}
        </div>
        {(check?.outputDisk || j.source.outputDisk) && (
          <DetailRow
            label={t("Output disk")}
            value={t(check?.outputDisk || j.source.outputDisk || "")}
          />
        )}
        {check?.diskConflict && (
          <p class="notice">{t("The media file exists on several disks")}</p>
        )}
        {j.backupName && (
          <p>
            {t("Preserved backup")}: {j.backupName}
          </p>
        )}
        <div class="modal-actions">
          <button class="button mobile-row-action" onClick={terminal}>
            {t("Terminal")}
          </button>
          <button class="button mobile-row-action" onClick={options}>
            {t("Mux options")}
          </button>
          <button
            class="button"
            disabled={busy}
            onClick={async () => {
              await refresh();
              if (needsDetail) setRevision((value) => value + 1);
            }}
          >
            {t("Check again")}
          </button>
          <button class="button" onClick={close}>
            {t("Close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
