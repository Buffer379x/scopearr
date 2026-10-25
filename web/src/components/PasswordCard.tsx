import { useState } from "preact/hooks";
import { LockKeyhole } from "lucide-preact";
import { t, useI18n } from "../i18n";
import { CardHeading, ICON } from "../ui";
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
  return (
    <section class="settings-card password-card">
      <CardHeading
        title={t("Change password")}
        actions={
          <button
            type="button"
            class="button"
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          >
            <LockKeyhole size={ICON.label} />
            {t("Change password")}
          </button>
        }
      />
      <p class="quiet">{t("Changing the password signs out every session.")}</p>
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
    </section>
  );
}
