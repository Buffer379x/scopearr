import { ICON } from "../ui";
import { pushDialog, removeDialog } from "../dialog-stack";
import { t, useI18n } from "../i18n";
import { X } from "lucide-preact";
import { useEffect, useId, useRef } from "preact/hooks";
import { trackDialogHeight, trackDialogViewport } from "../dialog-layout";

export function Modal({
  title,
  close,
  cancel,
  closeDisabled = false,
  children,
  wide = false,
  tabs = false,
  fitViewport = false,
  className = "",
}: {
  title: string;
  close: () => void;
  cancel?: () => void;
  closeDisabled?: boolean;
  children: preact.ComponentChildren;
  wide?: boolean;
  tabs?: boolean;
  fitViewport?: boolean;
  className?: string;
}) {
  useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    pushDialog(dialog);
    const stopTracking = tabs ? trackDialogHeight(dialog) : undefined;
    const stopViewport = fitViewport ? trackDialogViewport(dialog) : undefined;
    return () => {
      stopViewport?.();
      stopTracking?.();
      dialog.close();
      removeDialog(dialog);
    };
  }, [tabs, fitViewport]);
  return (
    <dialog
      class={["modal", wide && "wide", tabs && "modal-tabbed", className]
        .filter(Boolean)
        .join(" ")}
      ref={ref}
      aria-labelledby={headingId}
      onCancel={(e) => {
        e.preventDefault();
        if (!closeDisabled) (cancel || close)();
      }}
      onClick={(e) => {
        if (!closeDisabled && e.target === ref.current) {
          const box = ref.current!.getBoundingClientRect();
          if (
            e.clientX < box.left ||
            e.clientX > box.right ||
            e.clientY < box.top ||
            e.clientY > box.bottom
          )
            close();
        }
      }}
    >
      <div class="modal-heading">
        <h2 id={headingId}>{title}</h2>
        <button
          type="button"
          class="icon-button"
          aria-label={t("Close")}
          disabled={closeDisabled}
          onClick={close}
          title={t("Close")}
        >
          <X size={ICON.close} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
