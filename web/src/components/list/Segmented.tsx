import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { t } from "../../i18n";
import type { ToolTone } from "../../tool-status";
import { NavLink } from "../frame/NavLink";

// Exclusive areas as one segmented control (docs/STYLEGUIDE.md, Part 1,
// 10.6): .v2-seg of .v2-seg-item entries, v2-seg--on-band on the band.
// "tabs" is a named tablist of tab buttons with aria-selected, a roving
// tabindex and ←/→, Home and End (each selects and focuses its tab); a tab
// controls "<idPrefix>-panel-<value>", the panel its caller renders.
// "links" is a named nav of NavLinks to each item's href, the current one
// with aria-current="page", a plain click selecting its value.
// "radio" (Phase 5c) is a named radiogroup of radio buttons with
// aria-checked and the keys of "tabs", ↓ and ↑ moving like → and ←. An
// item of tabs or radio may carry `dirty` (the unsaved-change mark, always
// rendered once given, shown by data-on, with "Unsaved changes" for screen
// readers while on) and `dot` (a toned dot before its label); without them
// it is its label alone.
type Item<T> = {
  value: T;
  label: string;
  href?: string;
  dirty?: boolean;
  dot?: ToolTone;
};
function content<T>({ label, dirty, dot }: Item<T>) {
  if (dirty === undefined && dot === undefined) return label;
  return [
    dot && <span class="v2-seg-dot" data-tone={dot} aria-hidden="true" />,
    label,
    dirty !== undefined && (
      <span
        class="v2-seg-dirty"
        data-on={dirty ? "" : undefined}
        aria-hidden="true"
      />
    ),
    dirty && <span class="v2-sr-only">{" " + t("Unsaved changes")}</span>,
  ];
}
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
  kind: "tabs" | "links" | "radio";
  value: T;
  items: Item<T>[];
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
  const role = kind === "radio" ? "radio" : "tab";
  const keydown = (event: KeyboardEvent) => {
    const at = Math.max(
      0,
      items.findIndex((item) => item.value === value),
    );
    // A radio group also moves with ↓/↑ (WAI-ARIA); a tablist keeps ←/→.
    const radio = kind === "radio",
      key = event.key;
    const next =
      key === "ArrowRight" || (radio && key === "ArrowDown")
        ? (at + 1) % items.length
        : key === "ArrowLeft" || (radio && key === "ArrowUp")
          ? (at + items.length - 1) % items.length
          : key === "Home"
            ? 0
            : key === "End"
              ? items.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    select(items[next].value);
    root.current
      ?.querySelectorAll<HTMLButtonElement>('[role="' + role + '"]')
      [next]?.focus();
  };
  return (
    <div
      ref={root}
      class={look}
      role={kind === "radio" ? "radiogroup" : "tablist"}
      aria-label={label}
      onKeyDown={keydown}
    >
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role={role}
          class="v2-seg-item"
          {...(kind === "radio"
            ? { "aria-checked": item.value === value }
            : {
                id: idPrefix && idPrefix + "-tab-" + item.value,
                "aria-controls": idPrefix && idPrefix + "-panel-" + item.value,
                "aria-selected": item.value === value,
              })}
          tabIndex={item.value === value ? 0 : -1}
          onClick={() => select(item.value)}
        >
          {content(item)}
        </button>
      ))}
    </div>
  );
}
