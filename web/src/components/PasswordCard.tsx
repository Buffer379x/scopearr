import { useState } from "preact/hooks";
import { LockKeyhole } from "lucide-preact";
import { t, useI18n } from "../i18n";
import { ICON } from "../ui";
import { card } from "./settings/Card";
import { Modal } from "./Modal";

export function PasswordCard({ demo }: { demo: boolean }) {
  useI18n();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  function close() {
    setOpen(false);
    setCurrent("");
    setPassword("");
  }
  // A card of System → Info (11.4): its text, then the button in its
  // body, full width; the 1.7.0 dialog (Phase 5d).
  return card(
    "system-password",
    t("Change password"),
    <>
      <p>{t("Changing the password signs out every session.")}</p>
      <button
        type="button"
        class="v2-btn"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <LockKeyhole size={ICON.label} />
        {t("Change password")}
      </button>
      {open && (
        <Modal title={t("Change password")} close={close}>
          <p class="quiet">
            {t("Changing the password signs out every session.")}
          </p>
          <div class="password-dialog-fields">
            <label>
              {t("Current password")}
              <input
                type="password"
                name="current"
                form="password-form"
                autoComplete="current-password"
                autoFocus
                value={current}
                required
                onInput={(e) => setCurrent(e.currentTarget.value)}
              />
            </label>
            <label>
              {t("New password")}
              <input
                type="password"
                name="password"
                form="password-form"
                autoComplete="new-password"
                value={password}
                required
                minLength={12}
                onInput={(e) => setPassword(e.currentTarget.value)}
              />
            </label>
          </div>
          <div class="modal-actions">
            <button type="button" class="button" onClick={close}>
              {t("Cancel")}
            </button>
            <button
              type="submit"
              class="primary"
              form="password-form"
              disabled={demo}
            >
              {t("Change password and sign out")}
            </button>
          </div>
        </Modal>
      )}
    </>,
  );
}
