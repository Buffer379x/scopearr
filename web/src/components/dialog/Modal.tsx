import { X } from "lucide-preact";
import type { ComponentChildren, JSX } from "preact";
import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { trackDialogViewport } from "../../dialog-layout";
import { DIALOGS, type DialogId } from "../../dialog-model";
import { focusFallback, nextTabStop, tabStops } from "../../dialog-focus";
import { pushDialog, removeDialog } from "../../dialog-stack";
import { t, useI18n } from "../../i18n";
import { ICON } from "../../ui";

// The v2 modal (docs/STYLEGUIDE.md, Part 1, 10.9, Phase 5d E3–E5): a native
// dialog.v2-modal shown with showModal on the dialog stack, with aria-modal
// (a popover renders inside it, ⌘K waits). Its size and height kind come
// from its id (DIALOGS). Opening focuses the body's [autofocus] field, else
// the title; closing returns focus to what had it at the opening while it
// is connected, enabled and visible, else to returnFocus(), else to the
// title of the dialog below it, else to the page's h1 (focusFallback). A
// body that scrolls (its content is taller than it) is a named region the
// keyboard reaches (tabindex 0); one that fits is a plain box.
// `bar` stands between the head and the scrolling body (the tabs row of
// File & metadata), so it never scrolls away. Escape runs cancel ?? close, a press on the backdrop closes only when it
// began and ended there, and closeDisabled turns both and Close off.
export function Modal({
  id,
  title,
  close,
  cancel,
  closeDisabled = false,
  eyebrow = false,
  head,
  tools,
  bar,
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
  bar?: ComponentChildren;
  foot?: ComponentChildren;
  fitViewport?: boolean;
  returnFocus?(): HTMLElement | null;
  children: ComponentChildren;
}): JSX.Element {
  useI18n();
  const ref = useRef<HTMLDialogElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    // Where the press began and ended: only one that began and ended on
    // the dialog itself (its backdrop) closes it, not a drag from inside
    // that ends there or one from there into the content (whose click goes
    // to the dialog, their common ancestor).
    pressed = useRef<EventTarget | null>(null),
    released = useRef<EventTarget | null>(null),
    back = useRef(returnFocus),
    closer = useRef(close),
    body = useRef<HTMLDivElement>(null),
    [scrolls, setScrolls] = useState(false);
  back.current = returnFocus;
  closer.current = close;
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
    // A new page closes it through its owner (closeDialogs).
    pushDialog(dialog, () => closer.current());
    (
      dialog.querySelector<HTMLElement>(
        ":scope > .v2-modal-body [autofocus]",
      ) ?? heading.current
    )?.focus();
    return () => {
      dialog.close();
      removeDialog(dialog);
      const shown = (el: HTMLElement | null | undefined) =>
        el &&
        el.isConnected &&
        !(el as HTMLButtonElement).disabled &&
        el.getClientRects().length > 0
          ? el
          : null;
      const target = shown(opener) ?? shown(back.current?.());
      if (target) target.focus();
      else focusFallback(doc);
    };
  }, []);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const over = el.scrollHeight > el.clientHeight + 1;
      setScrolls(over);
      // The body loses its tab stop: focus on the body itself (not on a
      // control inside it) moves to the title.
      const active = ref.current?.ownerDocument.activeElement ?? null;
      if (!over && active === el) heading.current?.focus();
    };
    // Each mutation measures at once (a layout read): cheap for the log
    // dialogs' polls today. A terminal that streams would batch this in
    // requestAnimationFrame instead (final review M-4).
    const size = new ResizeObserver(measure),
      content = new MutationObserver(measure);
    size.observe(el);
    content.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    measure();
    return () => {
      size.disconnect();
      content.disconnect();
    };
  }, []);
  useLayoutEffect(() => {
    if (fitViewport)
      return trackDialogViewport(ref.current!, ":scope > .v2-modal-body", [
        "--modal-vv-h",
        "--modal-vv-top",
      ]);
  }, [fitViewport]);
  // sm and auto unless DIALOGS says otherwise.
  const { size, height } = DIALOGS[id] ?? { size: "sm", height: "auto" };
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
      onKeyDown={(event) => {
        // Focus never leaves an open dialog: it moves through the
        // dialog's tab stops and wraps at the ends.
        if (
          event.key !== "Tab" ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.defaultPrevented
        )
          return;
        const dialog = event.currentTarget;
        const next = nextTabStop<Element>(
          tabStops(dialog),
          dialog.ownerDocument.activeElement,
          event.shiftKey,
          (a, b) =>
            !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING),
        );
        if (!next) return;
        event.preventDefault();
        (next as HTMLElement).focus();
      }}
      onPointerDown={(event) => {
        pressed.current = event.target;
      }}
      onPointerUp={(event) => {
        released.current = event.target;
      }}
      onClick={(event) => {
        if (
          !closeDisabled &&
          event.target === event.currentTarget &&
          pressed.current === event.currentTarget &&
          released.current === event.currentTarget
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
      {bar}
      <div
        ref={body}
        class="v2-modal-body"
        role={scrolls ? "region" : undefined}
        aria-labelledby={scrolls ? headingId : undefined}
        tabIndex={scrolls ? 0 : undefined}
      >
        {children}
      </div>
      {foot}
    </dialog>
  );
}

// The foot of a modal: a divider above, `lead` on the left (a count, a
// reason; none without one, null or undefined) and the actions on the right
// in the 1.7.0 order, Cancel or Close before the primary or danger action.
// A foot of many actions (`wrap`) breaks into lines on a narrow screen.
export function ModalFoot({
  lead,
  wrap = false,
  children,
}: {
  lead?: ComponentChildren;
  wrap?: boolean;
  children: ComponentChildren;
}): JSX.Element {
  return (
    <div class="v2-modal-foot" data-wrap={wrap ? "" : undefined}>
      {lead != null && <div class="v2-modal-foot-lead">{lead}</div>}
      {children}
    </div>
  );
}
