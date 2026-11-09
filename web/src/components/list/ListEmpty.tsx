import type { ComponentChildren, JSX } from "preact";

// The empty state of a list, inside its table card (docs/STYLEGUIDE.md,
// Part 1, 10.8): div.v2-empty with the icon (ICON.empty) in a 48 tile, the
// heading and the explanation and action its caller gives. `pending`
// (Phase 5b) makes it the placeholder of a tool's card before its first
// answer: the same content, invisible (v2-empty--pending) and hidden from
// assistive technology, so the card keeps the empty state's height.
// Without it the DOM is as before.
export function ListEmpty({
  icon,
  title,
  pending = false,
  children,
}: {
  icon: ComponentChildren;
  title: string;
  pending?: boolean;
  children?: ComponentChildren;
}): JSX.Element {
  return (
    <div
      class={pending ? "v2-empty v2-empty--pending" : "v2-empty"}
      {...(pending ? { "aria-hidden": "true" } : {})}
    >
      <span class="v2-tile v2-tile--lg" aria-hidden="true">
        {icon}
      </span>
      <h3 class="v2-empty-title">{title}</h3>
      {children}
    </div>
  );
}
