import type { ComponentChildren, JSX, Ref } from "preact";

// The framed tile of the Info column and the row actions (docs/STYLEGUIDE.md,
// Part 1, 10.3): a.v2-row-btn for a link, else button.v2-row-btn; sm is 24.
// Always named: aria-label is the label, title the title or the label. A
// link into another app (newTab) opens a new tab without opener or
// referrer. A locked one (disabled) is a disabled button in the same place,
// its reason in the title. A menu or dialog trigger (popup) carries
// aria-haspopup and aria-expanded and is on while open. Phase 5b: a
// removing action (Remove, Cancel, Delete) takes tone="danger"
// (v2-row-btn--danger); only="desk" hides it at ≤ 739 and only="phone"
// above (v2-row-btn--desk, --phone), the cell's other buttons keeping
// their place. rc.3 K3: a disclosure (Show or Hide a series' episodes)
// carries aria-expanded and, while there is one, aria-controls, and is
// not on. Without them the DOM is as before.
export function RowButton({
  label,
  icon,
  title,
  onClick,
  href,
  newTab = false,
  size,
  on = false,
  disabled = false,
  popup,
  expanded = false,
  buttonRef,
  tone,
  only,
  disclosure = false,
  controls,
}: {
  label: string;
  icon: ComponentChildren;
  title?: string;
  onClick?(e: MouseEvent): void;
  href?: string;
  newTab?: boolean;
  size?: "sm";
  on?: boolean;
  disabled?: boolean;
  popup?: "menu" | "dialog";
  expanded?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  tone?: "danger";
  only?: "desk" | "phone";
  disclosure?: boolean;
  controls?: string;
}): JSX.Element {
  const name = title ?? label;
  const look =
    "v2-row-btn" +
    (size === "sm" ? " v2-row-btn--sm" : "") +
    (on || (popup && expanded) ? " v2-row-btn--on" : "") +
    (tone ? " v2-row-btn--" + tone : "") +
    (only ? " v2-row-btn--" + only : "");
  if (href && !disabled)
    return (
      <a
        class={look}
        href={href}
        target={newTab ? "_blank" : undefined}
        rel={newTab ? "noopener noreferrer" : undefined}
        referrerPolicy={newTab ? "no-referrer" : undefined}
        aria-label={label}
        title={name}
        onClick={onClick}
      >
        {icon}
      </a>
    );
  return (
    <button
      type="button"
      ref={buttonRef}
      class={look}
      aria-label={label}
      title={name}
      disabled={disabled}
      aria-haspopup={popup}
      aria-expanded={popup || disclosure ? expanded : undefined}
      {...(disclosure && controls ? { "aria-controls": controls } : {})}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
