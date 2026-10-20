import type { MuxJob } from "../types";
import { t, useI18n } from "../i18n";
import { effectiveMuxStatus, muxStatusLabels } from "../mux-spec";
import { Modal } from "./Modal";
import { PathCheckRow } from "./MuxPathDialog";
export function MuxStatusTag({ job }: { job: MuxJob }) {
  const status = effectiveMuxStatus(job);
  return (
    <span class={"tag mux-status-" + status}>
      {t(muxStatusLabels[status] || status)}
    </span>
  );
}
export function MuxStatusDialog({
  job: j,
  workDir,
  refresh,
  close,
  busy,
}: {
  job: MuxJob;
  workDir: boolean;
  refresh: () => void;
  close: () => void;
  busy: boolean;
}) {
  const { locale } = useI18n();
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
    <Modal title={t("Status")} close={close}>
      <div class="filename-box">{j.sourceName}</div>
      <MuxStatusTag job={j} />
      <div class="mux-check-list">
        {Object.entries(labels)
          .filter(([key]) => workDir || !key.startsWith("work"))
          .map(([key, label]) => (
            <PathCheckRow
              ok={j.check[key as keyof typeof j.check]}
              label={t(label)}
            />
          ))}
      </div>
      {j.message && <p>{t(j.message)}</p>}
      <dl class="system-details">
        {(
          [
            ["Created", j.createdAt],
            ["Updated", j.updatedAt],
            ["Finished", j.finishedAt],
          ] as const
        )
          .filter(([, v]) => v)
          .map(([label, value]) => (
            <>
              <dt>{t(label)}</dt>
              <dd>{new Date(value!).toLocaleString(locale)}</dd>
            </>
          ))}
      </dl>
      {j.backupName && (
        <p>
          {t("Preserved backup")}: {j.backupName}
        </p>
      )}
      <div class="row-actions">
        <button class="button" disabled={busy} onClick={refresh}>
          {t("Check again")}
        </button>
        <button class="button" onClick={close}>
          {t("Close")}
        </button>
      </div>
    </Modal>
  );
}
