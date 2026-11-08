import { RotateCcw, X } from "lucide-preact";
import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { pushDialog, removeDialog } from "../../dialog-stack";
import { t, useI18n } from "../../i18n";
import { ICON } from "../../ui";
import { useOneOverlay } from "../frame/Popover";

const TITLE = "v2-drawer-title",
  SUBTITLE = "v2-drawer-sub";

// The filter drawer of a list (docs/STYLEGUIDE.md, Part 1, 10.5; 5b uses it
// for the tools), open while mounted: a native modal dialog.v2-drawer on
// the dialog stack (so ⌘K waits) and one overlay of the page
// (useOneOverlay), with aria-modal, so a popover in it renders inside it.
// Its head holds the title, the card title as its description, and Close,
// which takes focus; its foot Reset (the caller clears its draft) and
// Apply, with the live count once there. Escape, the backdrop and Close
// close it without applying; the caller returns focus to its trigger.
export function FilterDrawer({
  title,
  subtitle,
  count,
  apply,
  reset,
  close,
  children,
}: {
  title: string;
  subtitle?: string;
  count: number | null;
  apply(): void;
  reset(): void;
  close(): void;
  children: ComponentChildren;
}): JSX.Element {
  useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  useOneOverlay(() => close());
  // Open before the paint, so it never shows in the page's flow.
  useLayoutEffect(() => {
    const shown = dialog.current!;
    shown.showModal();
    pushDialog(shown);
    first.current?.focus();
    return () => {
      shown.close();
      removeDialog(shown);
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      class="v2-drawer"
      aria-modal="true"
      aria-labelledby={TITLE}
      aria-describedby={subtitle ? SUBTITLE : undefined}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div class="v2-drawer-head">
        <h2 id={TITLE} class="v2-drawer-title">
          {title}
        </h2>
        {subtitle && (
          <p id={SUBTITLE} class="v2-drawer-sub">
            {subtitle}
          </p>
        )}
        <button
          ref={first}
          type="button"
          class="v2-icon-btn"
          aria-label={t("Close")}
          title={t("Close")}
          onClick={close}
        >
          <X size={ICON.close} />
        </button>
      </div>
      <div class="v2-drawer-body">{children}</div>
      <div class="v2-drawer-foot">
        <button type="button" class="v2-btn" onClick={reset}>
          <RotateCcw size={ICON.label} />
          {t("Reset")}
        </button>
        <button type="button" class="v2-btn v2-btn--primary" onClick={apply}>
          {count === null
            ? t("Apply")
            : t("Apply ({count} matches)", { count })}
        </button>
      </div>
    </dialog>
  );
}
