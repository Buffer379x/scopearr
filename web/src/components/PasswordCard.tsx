import { useState } from "preact/hooks";
import { LockKeyhole } from "lucide-preact";
import { t, useI18n } from "../i18n";
import { CardHeading, ICON } from "../ui";

export function PasswordCard({ demo }: { demo: boolean }) {
  useI18n();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  return (
    <section class="settings-card password-card">
      <CardHeading
        title={t("Change password")}
        actions={
          <button
            type="button"
            class="button"
            aria-expanded={open}
            aria-controls="password-card-fields"
            onClick={() => {
              setOpen(!open);
              if (open) {
                setCurrent("");
                setPassword("");
              }
            }}
          >
            <LockKeyhole size={ICON.label} />
            {t(open ? "Cancel" : "Change password")}
          </button>
        }
      />
      <p class="quiet">{t("Changing the password signs out every session.")}</p>
      {open && (
        <div class="password-card-fields" id="password-card-fields">
          <label>
            {t("Current password")}
            <input
              type="password"
              name="current"
              form="password-form"
              autoComplete="current-password"
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
          <button
            type="submit"
            class="button"
            form="password-form"
            disabled={demo}
          >
            {t("Change password and sign out")}
          </button>
        </div>
      )}
    </section>
  );
}
