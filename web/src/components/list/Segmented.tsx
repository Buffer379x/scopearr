import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { NavLink } from "../frame/NavLink";

// Exclusive areas as one segmented control (docs/STYLEGUIDE.md, Part 1,
// 10.6): .v2-seg of .v2-seg-item entries, v2-seg--on-band on the band.
// "tabs" is a named tablist of tab buttons with aria-selected, a roving
// tabindex and ←/→, Home and End (each selects and focuses its tab); a tab
// controls "<idPrefix>-panel-<value>", the panel its caller renders.
// "links" is a named nav of NavLinks to each item's href, the current one
// with aria-current="page", a plain click selecting its value.
export function Segmented<T extends string>({
  label,
  kind,
  value,
  items,
  select,
  onBand = false,
  idPrefix,
}: {
  label: string;
  kind: "tabs" | "links";
  value: T;
  items: { value: T; label: string; href?: string }[];
  select(value: T): void;
  onBand?: boolean;
  idPrefix?: string;
}): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const look = "v2-seg" + (onBand ? " v2-seg--on-band" : "");
  if (kind === "links")
    return (
      <nav class={look} aria-label={label}>
        {items.map((item) => (
          <NavLink
            key={item.value}
            class="v2-seg-item"
            href={item.href ?? ""}
            current={item.value === value}
            open={() => select(item.value)}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    );
  const keydown = (event: KeyboardEvent) => {
    const at = Math.max(
      0,
      items.findIndex((item) => item.value === value),
    );
    const next =
      event.key === "ArrowRight"
        ? (at + 1) % items.length
        : event.key === "ArrowLeft"
          ? (at + items.length - 1) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    select(items[next].value);
    root.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  };
  return (
    <div
      ref={root}
      class={look}
      role="tablist"
      aria-label={label}
      onKeyDown={keydown}
    >
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          class="v2-seg-item"
          id={idPrefix && idPrefix + "-tab-" + item.value}
          aria-controls={idPrefix && idPrefix + "-panel-" + item.value}
          aria-selected={item.value === value}
          tabIndex={item.value === value ? 0 : -1}
          onClick={() => select(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
