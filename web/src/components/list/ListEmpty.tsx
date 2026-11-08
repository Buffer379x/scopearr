import type { ComponentChildren, JSX } from "preact";

// The empty state of a list, inside its table card (docs/STYLEGUIDE.md,
// Part 1, 10.8): div.v2-empty with the icon (ICON.empty) in a 48 tile, the
// heading and the explanation and action its caller gives.
export function ListEmpty({
  icon,
  title,
  children,
}: {
  icon: ComponentChildren;
  title: string;
  children?: ComponentChildren;
}): JSX.Element {
  return (
    <div class="v2-empty">
      <span class="v2-tile v2-tile--lg" aria-hidden="true">
        {icon}
      </span>
      <h3 class="v2-empty-title">{title}</h3>
      {children}
    </div>
  );
}
