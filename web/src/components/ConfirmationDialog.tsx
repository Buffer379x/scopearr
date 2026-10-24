import { ICON } from "../ui";
import { useEffect, useState } from "preact/hooks";
import { RotateCcw, Trash2 } from "lucide-preact";
import { t, useI18n } from "../i18n";
import {
  currentConfirmation,
  subscribeConfirmation,
  answerConfirmation,
} from "../confirmation";
import { Modal } from "./Modal";
export function ConfirmationDialog() {
  useI18n();
  const [, refresh] = useState(0);
  useEffect(() => subscribeConfirmation(() => refresh((n) => n + 1)), []);
  const pending = currentConfirmation();
  if (!pending) return null;
  return (
    <Modal
      title={t(
        pending.actionLabel && !pending.danger
          ? "Confirm action"
          : pending.discard
            ? "Really cancel?"
            : pending.reset
              ? "Restore defaults"
              : "Confirm deletion",
      )}
      close={() => answerConfirmation(false)}
      className="confirmation-dialog"
    >
      <p>{pending.message}</p>
      <div class="modal-actions">
        <button
          type="button"
          class="button"
          onClick={() => answerConfirmation(false)}
        >
          {t("Cancel")}
        </button>
        <button
          type="button"
          class={
            pending.actionLabel && !pending.danger
              ? "primary"
              : pending.reset || pending.discard
                ? "button"
                : "button danger-button"
          }
          onClick={() => answerConfirmation(true)}
        >
          {pending.danger ? (
            <Trash2 size={ICON.label} />
          ) : pending.actionLabel || pending.discard ? null : pending.reset ? (
            <RotateCcw size={ICON.label} />
          ) : (
            <Trash2 size={ICON.label} />
          )}
          {t(
            pending.actionLabel ||
              (pending.discard
                ? "Discard changes"
                : pending.reset
                  ? "Restore defaults"
                  : "Delete"),
          )}
        </button>
      </div>
    </Modal>
  );
}
