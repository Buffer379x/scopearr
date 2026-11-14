import { TriangleAlert } from "lucide-preact";
import { useState } from "preact/hooks";
import { t } from "../i18n";
import { ICON } from "../ui";
import { companionDecision, type RenamePreview } from "../file-rename";
import { Modal, ModalFoot } from "./dialog/Modal";
import { check } from "./settings/Check";
import { ToolDiskTag } from "./tools/ToolDiskTag";

// The rename preview of File & metadata (docs/STYLEGUIDE.md, Part 1, 10.9;
// Phase 5d, R-M, user decision F4): md/auto, the file and its companions old
// → new with the disk each one is on (ToolDiskTag), the user-share hint, and
// with companions the checkbox "Rename companion files too" (on when every
// one can be renamed, off and locked with the notice when a target name
// exists). One button renames: save(checked), so an unchecked box is
// 1.7.0's "Only the media file". Without companions it is "Rename file".
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
  const some = preview.companions.length > 0;
  const [companions, setCompanions] = useState(canRenameAll);
  const diskItem = { disks: {}, target: "", scanStatus: "empty" as const };
  return (
    <Modal
      id="renameCompanions"
      title={t(some ? "Companion files found" : "Rename file")}
      close={close}
      foot={
        <ModalFoot>
          <button type="button" class="v2-btn" onClick={close}>
            {t("Cancel")}
          </button>
          <button
            type="button"
            class="v2-btn v2-btn--primary"
            onClick={() => save(some && canRenameAll && companions)}
          >
            {t("Rename file")}
          </button>
        </ModalFoot>
      }
    >
      <div class="v2-modal-sec">
        <p class="v2-modal-text">
          {t(
            some
              ? "These files belong to the media file. Rename them as well?"
              : service?.startsWith("sonarr")
                ? "Rename this file? Sonarr rescans the series and all connected services are updated."
                : "Rename this file? Radarr rescans the movie and all connected services are updated.",
          )}
        </p>
        {preview.userShare && (
          <p
            class="v2-modal-hint"
            title={t(
              "Set up Unraid under Settings → Services → Unraid to rename directly on the disk.",
            )}
          >
            {t("Renamed through the user share")}
          </p>
        )}
        <ul class="v2-modal-list">
          <li>
            <code class="v2-path">{preview.filename}</code>
            {preview.device && (
              <ToolDiskTag item={diskItem} disk={preview.device} />
            )}
          </li>
          {preview.companions.map((c) => (
            <li key={c.from}>
              {c.conflict && (
                <TriangleAlert
                  class="v2-modal-warn"
                  size={ICON.button}
                  role="img"
                  aria-label={t("A target name already exists")}
                />
              )}
              <code class="v2-path">
                {c.from} → {c.to}
              </code>
              {c.device && <ToolDiskTag item={diskItem} disk={c.device} />}
            </li>
          ))}
        </ul>
        {!canRenameAll && (
          <p class="v2-notice v2-notice--warn">
            {t("A target name already exists")}
          </p>
        )}
        {some &&
          check(
            t("Rename companion files too"),
            canRenameAll && companions,
            setCompanions,
            !canRenameAll,
          )}
      </div>
    </Modal>
  );
}
