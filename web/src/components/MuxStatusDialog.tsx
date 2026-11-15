import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import type { MuxJob } from "../types";
import { t, useI18n } from "../i18n";
import { routineMuxMessages } from "../mux-spec";
import { muxStatusView } from "../tool-status";
import { CheckRow } from "./dialog/CheckRow";
import { Modal, ModalFoot } from "./dialog/Modal";
import { KeyValues } from "./settings/KeyValues";
import { StatusValue } from "./settings/ServiceStatus";

// Mux status (Phase 5d, Task 8; E19): a v2 modal (md, fixed height). The
// checks stand in fixed rows (eight, six without a working directory), their
// detail "—" until the answer, so nothing moves when it arrives.
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
  const outputDisk = check?.outputDisk || j.source.outputDisk;
  const details: { key: string; label: string; value: string }[] = [];
  for (const [key, label, value] of [
    ["created", "Created", j.createdAt],
    ["updated", "Updated", j.updatedAt],
    ["finished", "Finished", j.finishedAt],
  ] as const)
    if (value)
      details.push({
        key,
        label: t(label),
        value: new Date(value).toLocaleString(locale),
      });
  if (outputDisk)
    details.push({
      key: "disk",
      label: t("Output disk"),
      value: t(outputDisk),
    });
  return (
    <Modal
      id="muxStatus"
      title={t("Status")}
      close={close}
      foot={
        <ModalFoot>
          <button type="button" class="v2-btn" onClick={terminal}>
            {t("Terminal")}
          </button>
          <button type="button" class="v2-btn" onClick={options}>
            {t("Mux options")}
          </button>
          <button
            type="button"
            class="v2-btn"
            disabled={busy}
            onClick={async () => {
              await refresh();
              if (needsDetail) setRevision((value) => value + 1);
            }}
          >
            {t("Check again")}
          </button>
          <button type="button" class="v2-btn" onClick={close}>
            {t("Close")}
          </button>
        </ModalFoot>
      }
    >
      <section class="v2-modal-sec">
        <div class="v2-card--inset v2-path">{j.sourceName}</div>
        <StatusValue view={muxStatusView(j, t)} />
        {j.message && !routineMuxMessages.has(j.message) && (
          <p class="v2-notice">{t(j.message)}</p>
        )}
        <div aria-busy={loading}>
          {Object.entries(labels)
            .filter(([key]) => workDir || !key.startsWith("work"))
            .map(([key, label]) => (
              <CheckRow
                key={key}
                ok={!!check?.[key as keyof typeof check]}
                pending={!check}
                label={t(label)}
                detail={check ? undefined : "—"}
              />
            ))}
        </div>
        <KeyValues rows={details} />
        {check?.diskConflict && (
          <p class="v2-notice v2-notice--warn">
            {t("The media file exists on several disks")}
          </p>
        )}
        {j.backupName && (
          <p class="v2-modal-hint">
            {t("Preserved backup")}: {j.backupName}
          </p>
        )}
      </section>
    </Modal>
  );
}
