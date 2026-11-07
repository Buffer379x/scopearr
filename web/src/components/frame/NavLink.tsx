import type { ComponentChildren, JSX } from "preact";
import { followLink } from "../../nav-link";

// An in-app link of the frame (docs/STYLEGUIDE.md, Part 1, 10.1): a real
// <a href>. A plain left click (also Enter) runs `open`, the guarded action
// of its target (openLink); a middle click or one with Ctrl, Cmd, Shift or
// Alt keeps the browser's link, which opens the href in a new tab or window.
// `current` marks the shown page with aria-current="page". `label` names an
// icon-only link (aria-label and title); otherwise the text is the name.
// Other attributes and handlers pass through to the link.
export function NavLink({
  href,
  open,
  class: className,
  current,
  label,
  children,
  ...rest
}: {
  href: string;
  open: () => unknown;
  class?: string;
  current?: boolean;
  label?: string;
  children: ComponentChildren;
} & Omit<
  JSX.HTMLAttributes<HTMLAnchorElement>,
  | "href"
  | "class"
  | "className"
  | "label"
  | "children"
  | "onClick"
  | "aria-current"
  | "aria-label"
  | "title"
>) {
  return (
    <a
      {...rest}
      href={href}
      class={className}
      aria-current={current ? "page" : undefined}
      aria-label={label}
      title={label}
      onClick={(event) => followLink(event, open)}
    >
      {children}
    </a>
  );
}
