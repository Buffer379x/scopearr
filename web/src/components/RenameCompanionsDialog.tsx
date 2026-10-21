import { AlertTriangle } from "lucide-preact";
import { t } from "../i18n";
import { companionDecision, type RenamePreview } from "../file-rename";
import { Modal } from "./Modal";
export function RenameCompanionsDialog({
  preview,
  close,
  save,
}: {
  preview: RenamePreview;
  close: () => void;
  save: (companions: boolean) => void;
}) {
  const { canRenameAll } = companionDecision(preview.companions);
  return (
    <Modal
      title={t("Companion files found")}
      close={close}
      wide
      className="rename-companions-dialog"
    >
      <p>{t("These files belong to the media file. Rename them as well?")}</p>
      <div class="rename-companions">
        {preview.companions.map((c) => (
          <div class="path-check-row" key={c.from}>
            <span class="check-warning">
              {c.conflict && (
                <AlertTriangle
                  size={16}
                  aria-label={t("A target name already exists")}
                />
              )}
            </span>
            <code>
              {c.from} → {c.to}
            </code>
          </div>
        ))}
      </div>
      {!canRenameAll && (
        <p class="notice">{t("A target name already exists")}</p>
      )}
      <div class="modal-actions">
        <button
          class="primary"
          disabled={!canRenameAll}
          onClick={() => save(true)}
        >
          {t("Rename companion files too")}
        </button>
        <button class="button" onClick={() => save(false)}>
          {t("Only the media file")}
        </button>
        <button class="button" onClick={close}>
          {t("Cancel")}
        </button>
      </div>
    </Modal>
  );
}
