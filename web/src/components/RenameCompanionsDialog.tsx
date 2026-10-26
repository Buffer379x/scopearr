import { ICON } from "../ui";
import { TriangleAlert } from "lucide-preact";
import { t } from "../i18n";
import { companionDecision, type RenamePreview } from "../file-rename";
import { Modal } from "./Modal";
import { DiskTag } from "./PlacementDialogs";
export function RenameCompanionsDialog({
  preview,
  close,
  save,
  service,
}: {
  preview: RenamePreview;
  close: () => void;
  save: (companions: boolean) => void;
  service?: string;
}) {
  const { canRenameAll } = companionDecision(preview.companions);
  const diskItem = { disks: {}, target: "", scanStatus: "empty" as const };
  return (
    <Modal
      title={t(
        preview.companions.length ? "Companion files found" : "Rename file",
      )}
      close={close}
      wide
      className="rename-companions-dialog"
    >
      <p>
        {t(
          preview.companions.length
            ? "These files belong to the media file. Rename them as well?"
            : service?.startsWith("sonarr")
              ? "Rename this file? Sonarr rescans the series and all connected services are updated."
              : "Rename this file? Radarr rescans the movie and all connected services are updated.",
        )}
      </p>
      {preview.userShare && (
        <p
          class="cell-hint"
          title={t(
            "Set up Unraid under Settings → Services → Unraid to rename directly on the disk.",
          )}
        >
          {t("Renamed through the user share")}
        </p>
      )}
      <div class="rename-companions">
        <div class="path-check-row">
          <span />
          <code>{preview.filename}</code>
          {preview.device && <DiskTag item={diskItem} disk={preview.device} />}
        </div>
        {preview.companions.map((c) => (
          <div class="path-check-row" key={c.from}>
            <span class="check-warning">
              {c.conflict && (
                <TriangleAlert
                  size={ICON.button}
                  aria-label={t("A target name already exists")}
                />
              )}
            </span>
            <code>
              {c.from} → {c.to}
            </code>
            {c.device && <DiskTag item={diskItem} disk={c.device} />}
          </div>
        ))}
      </div>
      {!canRenameAll && (
        <p class="notice">{t("A target name already exists")}</p>
      )}
      <div class="modal-actions">
        <button class="button" onClick={close}>
          {t("Cancel")}
        </button>
        {preview.companions.length > 0 && (
          <button class="button" onClick={() => save(false)}>
            {t("Only the media file")}
          </button>
        )}
        <button
          class="primary"
          disabled={!!preview.companions.length && !canRenameAll}
          onClick={() => save(!!preview.companions.length)}
        >
          {t(
            preview.companions.length
              ? "Rename companion files too"
              : "Rename file",
          )}
        </button>
      </div>
    </Modal>
  );
}
