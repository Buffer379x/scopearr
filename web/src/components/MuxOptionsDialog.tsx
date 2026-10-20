import type { MuxJob, MuxSpec } from "../types";
import { t } from "../i18n";
import { Modal } from "./Modal";
import { MuxTrackTable } from "./MuxTrackTable";
export function MuxOptionsDialog({
  job: j,
  spec,
  dirty,
  busy,
  edit,
  save,
  discard,
  close,
  action,
}: {
  job: MuxJob;
  spec: MuxSpec;
  dirty: boolean;
  busy: boolean;
  edit: (spec: MuxSpec) => void;
  save: () => void;
  discard: () => void;
  close: () => void;
  action: (route: string) => void;
}) {
  const locked = ["queued", "running", "succeeded", "needs_attention"].includes(
    j.status,
  );
  return (
    <Modal
      wide
      title={t("Mux options")}
      close={close}
      closeDisabled={busy}
      className="mux-options-dialog"
    >
      <div class="settings-section">
        <h3>{j.title}</h3>
        <div class="filename-box">
          <code>{j.sourceName}</code>
        </div>
        <MuxTrackTable
          job={j}
          spec={spec}
          disabled={locked || busy}
          change={edit}
        />
        <label>
          {t("Output filename")}
          <div class="input-suffix">
            <input
              value={spec.outputName}
              disabled={locked || busy}
              onInput={(e) =>
                edit({ ...spec, outputName: e.currentTarget.value })
              }
            />
            <b>.mkv</b>
          </div>
        </label>
        {j.backupName && (
          <p>
            {t("Preserved backup")}: {j.backupName}
          </p>
        )}
        <div class="row-actions">
          {!locked && (
            <button
              class="primary"
              disabled={busy || j.status === "needs_review"}
              title={
                j.status === "needs_review"
                  ? t("Identify the media file again before saving")
                  : undefined
              }
              onClick={save}
            >
              {t("Save")}
            </button>
          )}
          {dirty && (
            <button class="button" disabled={busy} onClick={discard}>
              {t("Discard")}
            </button>
          )}
          <button class="button" disabled={busy} onClick={close}>
            {t("Close")}
          </button>
          {j.status === "needs_review" && (
            <button
              class="button"
              disabled={busy}
              onClick={() => action("identify")}
            >
              {t("Identify again")}
            </button>
          )}
          {j.status === "needs_attention" && (
            <button
              class="button"
              disabled={busy}
              onClick={() => action("rescan")}
            >
              {t("Retry rescan")}
            </button>
          )}
          {j.backupName && !["running", "queued"].includes(j.status) && (
            <button
              class="button danger-button"
              disabled={busy}
              onClick={() => action("backup")}
            >
              {t("Delete backup")}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
