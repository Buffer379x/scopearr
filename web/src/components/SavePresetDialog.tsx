import type { ComponentChildren } from "preact";
import { t } from "../i18n";
import { Modal, ModalFoot } from "./dialog/Modal";
import { field } from "./settings/Field";

// Save filter view (Phase 5d, E11), one dialog for the library and the
// tools: the error above the field, the description and the field “Name”;
// the foot holds Cancel and the caller's own save button, a submit button
// of the form “save-preset-form” (the foot stands outside the body).
export function SavePresetDialog({
  description,
  name,
  setName,
  placeholder,
  error,
  submit,
  close,
  children,
}: {
  description: string;
  name: string;
  setName: (value: string) => void;
  placeholder?: string;
  error: string;
  submit: (e: Event) => void;
  close: () => void;
  children: ComponentChildren;
}) {
  return (
    <Modal
      id="savePreset"
      title={t("Save filter view")}
      close={close}
      foot={
        <ModalFoot>
          <button type="button" class="v2-btn" onClick={close}>
            {t("Cancel")}
          </button>
          {children}
        </ModalFoot>
      }
    >
      <form id="save-preset-form" class="v2-modal-form" onSubmit={submit}>
        {error && (
          <p class="v2-notice v2-notice--error" role="alert">
            {error}
          </p>
        )}
        <p class="v2-modal-hint">{description}</p>
        {field("save-preset-name", t("Name"), (a) => (
          <input
            {...a}
            class="v2-input"
            autoFocus
            required
            maxLength={80}
            value={name}
            placeholder={placeholder}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        ))}
      </form>
    </Modal>
  );
}
