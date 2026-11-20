import type { MuxJob, MuxSpec } from "../types";
import { t } from "../i18n";
import { Modal, ModalFoot } from "./dialog/Modal";
import { MuxTrackTable } from "./MuxTrackTable";
import { field } from "./settings/Field";

// Mux options (Phase 5d, Task 8; E19): a v2 modal (lg, auto) with the job's
// title and source file, the track table, the output filename with its
// fixed suffix and the preserved backup. The foot keeps the 1.7.0 order and
// conditions: Discard (a draft), Close, Identify again or Retry rescan,
// Delete backup and Save (locked while the job needs a review).
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
      id="muxOptions"
      title={t("Mux options")}
      close={close}
      closeDisabled={busy}
      foot={
        <ModalFoot>
          {dirty && (
            <button
              type="button"
              class="v2-btn"
              disabled={busy}
              onClick={discard}
            >
              {t("Discard")}
            </button>
          )}
          <button type="button" class="v2-btn" disabled={busy} onClick={close}>
            {t("Close")}
          </button>
          {j.status === "needs_review" && (
            <button
              type="button"
              class="v2-btn"
              disabled={busy}
              onClick={() => action("identify")}
            >
              {t("Identify again")}
            </button>
          )}
          {j.status === "needs_attention" && (
            <button
              type="button"
              class="v2-btn"
              disabled={busy}
              onClick={() => action("rescan")}
            >
              {t("Retry rescan")}
            </button>
          )}
          {j.backupName && !["running", "queued"].includes(j.status) && (
            <button
              type="button"
              class="v2-btn v2-btn--danger"
              disabled={busy}
              onClick={() => action("backup")}
            >
              {t("Delete backup")}
            </button>
          )}
          {!locked && (
            <button
              type="button"
              class="v2-btn v2-btn--primary"
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
        </ModalFoot>
      }
    >
      <section class="v2-modal-sec">
        <h3 class="v2-modal-h">{j.title}</h3>
        <div class="v2-card--inset v2-path">{j.sourceName}</div>
        <MuxTrackTable
          job={j}
          spec={spec}
          disabled={locked || busy}
          change={edit}
        />
        {field("mux-output-name", t("Output filename"), (a) => (
          <div class="v2-modal-row">
            <input
              {...a}
              class="v2-input"
              value={spec.outputName}
              disabled={locked || busy}
              onInput={(e) =>
                edit({ ...spec, outputName: e.currentTarget.value })
              }
            />
            <b class="v2-modal-suffix">.mkv</b>
          </div>
        ))}
        {j.backupName && (
          <p class="v2-modal-hint">
            {t("Preserved backup")}: {j.backupName}
          </p>
        )}
      </section>
    </Modal>
  );
}
