import { RotateCcw, Trash2 } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import {
  answerConfirmation,
  currentConfirmation,
  subscribeConfirmation,
} from "../confirmation";
import { confirmationView } from "../dialog-model";
import { t, useI18n } from "../i18n";
import { ICON } from "../ui";
import { Modal, ModalFoot } from "./dialog/Modal";

// The action's button per tone (docs/STYLEGUIDE.md, Part 1, 10.3 and 10.9).
const TONE = {
  primary: "v2-btn v2-btn--primary",
  secondary: "v2-btn",
  danger: "v2-btn v2-btn--danger",
} as const;

// The one pending confirmation (confirmation.ts) as a small v2 modal
// (Phase 5d, E10): its title, action, tone and icon from confirmationView,
// the message as the body and Cancel before the action. Nothing in the body
// takes focus, so the title has it and Enter confirms nothing by accident;
// Escape, Close and the backdrop answer no.
export function ConfirmationDialog() {
  useI18n();
  const [, refresh] = useState(0);
  useEffect(() => subscribeConfirmation(() => refresh((n) => n + 1)), []);
  const pending = currentConfirmation();
  if (!pending) return null;
  const view = confirmationView(pending);
  const no = () => answerConfirmation(false);
  return (
    <Modal
      id="confirm"
      title={t(view.title)}
      close={no}
      returnFocus={pending.returnFocus}
      foot={
        <ModalFoot>
          <button type="button" class="v2-btn" onClick={no}>
            {t("Cancel")}
          </button>
          <button
            type="button"
            class={TONE[view.tone]}
            onClick={() => answerConfirmation(true)}
          >
            {view.icon === "trash" ? (
              <Trash2 size={ICON.label} />
            ) : view.icon === "reset" ? (
              <RotateCcw size={ICON.label} />
            ) : null}
            {t(view.action)}
          </button>
        </ModalFoot>
      }
    >
      <p class="v2-modal-text">{pending.message}</p>
    </Modal>
  );
}
