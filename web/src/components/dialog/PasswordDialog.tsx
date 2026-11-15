import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { t, useI18n } from "../../i18n";
import { field } from "../settings/Field";
import { Modal, ModalFoot } from "./Modal";

// Change password (Phase 5d, Task 11, E22; moved out of PasswordCard): a v2
// modal (sm). Both fields belong to the page's form#password-form
// (SettingsPage, outside the dialog and the settings form), so the dialog
// has no form of its own; Current password takes the focus, the new one
// needs 12 characters, the submit stands in the foot and is locked in the
// demo. Cancel, Close and Escape empty both fields and close.
export function PasswordDialog({
  demo,
  close,
}: {
  demo: boolean;
  close(): void;
}): JSX.Element {
  useI18n();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  function cancel() {
    setCurrent("");
    setPassword("");
    close();
  }
  return (
    <Modal
      id="password"
      title={t("Change password")}
      close={cancel}
      foot={
        <ModalFoot>
          <button type="button" class="v2-btn" onClick={cancel}>
            {t("Cancel")}
          </button>
          <button
            type="submit"
            class="v2-btn v2-btn--primary"
            form="password-form"
            disabled={demo}
          >
            {t("Change password and sign out")}
          </button>
        </ModalFoot>
      }
    >
      <div class="v2-modal-form">
        <p class="v2-modal-hint">
          {t("Changing the password signs out every session.")}
        </p>
        {field("password-current", t("Current password"), (a) => (
          <input
            {...a}
            class="v2-input"
            type="password"
            name="current"
            form="password-form"
            autoComplete="current-password"
            autoFocus
            value={current}
            required
            onInput={(e) => setCurrent(e.currentTarget.value)}
          />
        ))}
        {field("password-new", t("New password"), (a) => (
          <input
            {...a}
            class="v2-input"
            type="password"
            name="password"
            form="password-form"
            autoComplete="new-password"
            value={password}
            required
            minLength={12}
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
        ))}
      </div>
    </Modal>
  );
}
