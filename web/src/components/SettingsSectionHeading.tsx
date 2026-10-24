import type { ComponentChildren } from "preact";
import { Check, LoaderCircle } from "lucide-preact";
import { ICON } from "../ui";
import { t } from "../i18n";
export function SettingsSectionHeading({title, description, help, save}: {
 title: string; description: string; help?: ComponentChildren;
 save?: {busy:boolean; disabled:boolean; form?:string; action?:()=>void};
}) {
 return <header class="settings-section-heading">
  <h2>{t(title)}{help}</h2>
  {save && <button type={save.form ? "submit" : "button"} form={save.form} class="primary" disabled={save.busy || save.disabled} onClick={save.action}>
    {save.busy ? <LoaderCircle class="spin" size={ICON.label} /> : <Check size={ICON.label} />}{" "}{t("Save settings")}
  </button>}
  <p class="quiet">{t(description)}</p>
 </header>;
}
