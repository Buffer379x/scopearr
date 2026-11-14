import { X } from "lucide-preact";
import type { ComponentChildren, JSX } from "preact";
import { useId, useLayoutEffect, useRef } from "preact/hooks";
import { trackDialogViewport } from "../../dialog-layout";
import { DIALOGS, type DialogId } from "../../dialog-model";
import { pushDialog, removeDialog } from "../../dialog-stack";
import { t, useI18n } from "../../i18n";
import { ICON } from "../../ui";

// The v2 modal (docs/STYLEGUIDE.md, Part 1, 10.9, Phase 5d E3–E5): a native
// dialog.v2-modal shown with showModal on the dialog stack, with aria-modal
// (a popover renders inside it, ⌘K waits). Its size and height kind come
// from its id (DIALOGS). Opening focuses the body's [autofocus] field, else
// the title; closing returns focus to what had it at the opening while it
// is connected and visible, else to returnFocus(), else to the page's h1.
// Escape runs cancel ?? close, a press on the backdrop closes only when it
// began there, and closeDisabled turns both and Close off.
export function Modal({
  id,
  title,
  close,
  cancel,
  closeDisabled = false,
  eyebrow = false,
  head,
  tools,
  foot,
  fitViewport = false,
  returnFocus,
  children,
}: {
  id: DialogId;
  title: string;
  close(): void;
  cancel?(): void;
  closeDisabled?: boolean;
  eyebrow?: boolean;
  head?: ComponentChildren;
  tools?: ComponentChildren;
  foot?: ComponentChildren;
  fitViewport?: boolean;
  returnFocus?(): HTMLElement | null;
  children: ComponentChildren;
}): JSX.Element {
  useI18n();
  const ref = useRef<HTMLDialogElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    // Where the press began: only one that began on the dialog itself (its
    // backdrop) closes it, not a drag from inside that ends there.
    pressed = useRef<EventTarget | null>(null),
    back = useRef(returnFocus);
  back.current = returnFocus;
  const headingId = useId();
  // Open before the paint, so the dialog never shows in the page's flow.
  useLayoutEffect(() => {
    const dialog = ref.current!,
      doc = dialog.ownerDocument;
    const opener =
      doc.activeElement === doc.body
        ? null
        : (doc.activeElement as HTMLElement | null);
    dialog.showModal();
    pushDialog(dialog);
    (
      dialog.querySelector<HTMLElement>(
        ":scope > .v2-modal-body [autofocus]",
      ) ?? heading.current
    )?.focus();
    return () => {
      dialog.close();
      removeDialog(dialog);
      const shown = (el: HTMLElement | null | undefined) =>
        el && el.isConnected && el.getClientRects().length > 0 ? el : null;
      const target = shown(opener) ?? shown(back.current?.());
      if (target) return target.focus();
      const h1 = doc.querySelector<HTMLElement>("h1");
      if (!h1) return;
      if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
      h1.focus();
    };
  }, []);
  useLayoutEffect(() => {
    if (fitViewport)
      return trackDialogViewport(ref.current!, ":scope > .v2-modal-body");
  }, [fitViewport]);
  const { size, height } = DIALOGS[id];
  return (
    <dialog
      ref={ref}
      class="v2-modal"
      data-size={size}
      data-height={height}
      aria-modal="true"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) (cancel ?? close)();
      }}
      onPointerDown={(event) => {
        pressed.current = event.target;
      }}
      onClick={(event) => {
        if (
          !closeDisabled &&
          event.target === event.currentTarget &&
          pressed.current === event.currentTarget
        )
          close();
      }}
    >
      <div class="v2-modal-head">
        <h2
          ref={heading}
          id={headingId}
          class={eyebrow ? "v2-modal-eyebrow" : "v2-modal-title"}
          tabIndex={-1}
        >
          {title}
        </h2>
        {head}
        <div class="v2-modal-tools">
          {tools}
          <button
            type="button"
            class="v2-icon-btn v2-icon-btn--sm"
            aria-label={t("Close")}
            title={t("Close")}
            disabled={closeDisabled}
            onClick={close}
          >
            <X size={ICON.button} />
          </button>
        </div>
      </div>
      <div class="v2-modal-body">{children}</div>
      {foot}
    </dialog>
  );
}

// The foot of a modal: a divider above, `lead` on the left (a count, a
// reason) and the actions on the right in the 1.7.0 order, Cancel or Close
// before the primary or danger action.
export function ModalFoot({
  lead,
  children,
}: {
  lead?: ComponentChildren;
  children: ComponentChildren;
}): JSX.Element {
  return (
    <div class="v2-modal-foot">
      {lead !== undefined && <div class="v2-modal-foot-lead">{lead}</div>}
      {children}
    </div>
  );
}
