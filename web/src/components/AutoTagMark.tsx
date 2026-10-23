import { ICON } from "../ui";
import { instanceByID, instanceLabel } from "../instances";
import { Settings as Gear } from "lucide-preact";
import { useState } from "preact/hooks";
import type { CustomTag, Settings } from "../types";
import { t } from "../i18n";
import { Modal } from "./Modal";
export function autoTagHint(tag: CustomTag, settings?: Settings | null) {
  return [
    t("Used by external auto-tag rules"),
    ...(tag.rules || []).map((rule) => {
      const [id, ...rest] = rule.split(" · ");
      return [
        instanceLabel(instanceByID(settings, id) || { id }),
        ...rest,
      ].join(" · ");
    }),
    t("Assignments and deletion are controlled by the service."),
  ].join("\n");
}
export function AutoTagMark({
  tag,
  settings,
}: {
  tag: CustomTag;
  settings?: Settings | null;
}) {
  const [open, setOpen] = useState(false);
  if (!tag.protected) return null;
  const hint = autoTagHint(tag, settings);
  return (
    <>
      <button
        type="button"
        class="auto-tag-mark"
        title={hint}
        aria-label={hint}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Gear size={ICON.button} />
      </button>
      {open && (
        <Modal title={t("External auto-tag")} close={() => setOpen(false)}>
          <p class="auto-tag-explanation">{hint}</p>
        </Modal>
      )}
    </>
  );
}
