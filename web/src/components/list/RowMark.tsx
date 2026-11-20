import type { ComponentChildren, JSX } from "preact";
import { followLink } from "../../nav-link";

// A title or outlier mark of a row (docs/STYLEGUIDE.md, Part 1, 10.7):
// .v2-mark.v2-mark--<tone>, 20 × 20, its icon in the tone. Without an action
// it is an image (span[role="img"]), with one a button, with an href a link
// (a plain click runs onClick, as NavLink). Always named; its title is the
// title or the label. A user warning color (Settings → Display) replaces
// the tone inline (--tone).
export function RowMark({
  tone,
  label,
  title,
  icon,
  color,
  onClick,
  href,
}: {
  tone: "warn" | "info" | "accent";
  label: string;
  title?: string;
  icon: ComponentChildren;
  color?: string;
  onClick?(): void;
  href?: string;
}): JSX.Element {
  const look = "v2-mark v2-mark--" + tone;
  const style = color ? { "--tone": color } : undefined;
  const name = title ?? label;
  if (href)
    return (
      <a
        class={look}
        style={style}
        href={href}
        aria-label={label}
        title={name}
        onClick={onClick ? (event) => followLink(event, onClick) : undefined}
      >
        {icon}
      </a>
    );
  if (onClick)
    return (
      <button
        type="button"
        class={look}
        style={style}
        aria-label={label}
        title={name}
        onClick={() => onClick()}
      >
        {icon}
      </button>
    );
  return (
    <span class={look} style={style} role="img" aria-label={label} title={name}>
      {icon}
    </span>
  );
}
