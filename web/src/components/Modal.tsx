import { pushDialog, removeDialog } from "../dialog-stack";
import { t, useI18n } from "../i18n";
import { X } from "lucide-preact";
import { useEffect, useId, useRef } from "preact/hooks";

export function Modal({
  title,
  close,
  closeDisabled = false,
  children,
  wide = false,
  className = "",
}: {
  title: string;
  close: () => void;
  closeDisabled?: boolean;
  children: preact.ComponentChildren;
  wide?: boolean;
  className?: string;
}) {
  useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    pushDialog(dialog);
    return () => {
      dialog.close();
      removeDialog(dialog);
    };
  }, []);
  return (
    <dialog
      class={["modal", wide && "wide", className].filter(Boolean).join(" ")}
      ref={ref}
      aria-labelledby={headingId}
      onCancel={(e) => {
        e.preventDefault();
        if (!closeDisabled) close();
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
          class="icon-button"
          aria-label={t("Close")}
          disabled={closeDisabled}
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
