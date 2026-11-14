import type { JSX } from "preact";
import { t, useI18n } from "../../i18n";
import { Modal } from "./Modal";

// External auto-tag (Phase 5d, E11): the explanation of an auto tag
// (autoTagHint), one for the auto mark of the custom tags dialog
// (AutoTagMark) and of a v2 custom tag (list/CustomTag); its lines kept.
export function AutoTagDialog({
  hint,
  close,
}: {
  hint: string;
  close(): void;
}): JSX.Element {
  useI18n();
  return (
    <Modal id="autoTag" title={t("External auto-tag")} close={close}>
      <p class="v2-modal-text">{hint}</p>
    </Modal>
  );
}
