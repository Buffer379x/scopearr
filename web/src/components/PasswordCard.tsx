import { useState } from "preact/hooks";
import { LockKeyhole } from "lucide-preact";
import { t, useI18n } from "../i18n";
import { ICON } from "../ui";
import { card } from "./settings/Card";
import { PasswordDialog } from "./dialog/PasswordDialog";

export function PasswordCard({ demo }: { demo: boolean }) {
  useI18n();
  const [open, setOpen] = useState(false);
  // A card of System → Info (11.4): its text, then the button in its
  // body, full width; it opens the v2 dialog (Phase 5d, Task 11).
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
      {open && <PasswordDialog demo={demo} close={() => setOpen(false)} />}
    </>,
  );
}
