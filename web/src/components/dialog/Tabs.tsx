import type { ComponentChildren, JSX } from "preact";

// Tabs in dialogs and cards (docs/STYLEGUIDE.md, Part 1, 10.6, Phase 5d E7):
// a named tablist with the ids of the 1.7.0 SegmentedTabs (<id>-tab-<value>,
// the panel <id>-panel-<value>, which the caller renders), a roving
// tabindex, and ←/→ (wrapping), Home and End, which choose and focus. A
// label may carry a v2-tabs-count; `accessory` sits at the row's right end.
// `reserve` keeps the row, empty and hidden, while there are no tabs, so
// the body below starts at the same place.
export function Tabs<T extends string>({
  id,
  label,
  value,
  items,
  change,
  accessory,
  reserve = false,
}: {
  id: string;
  label: string;
  value: T;
  items: { value: T; label: ComponentChildren }[];
  change(value: T): void;
  accessory?: ComponentChildren;
  reserve?: boolean;
}): JSX.Element | null {
  if (!items.length)
    return reserve ? <div class="v2-tabs" aria-hidden="true" /> : null;
  return (
    <div class="v2-tabs">
      <div
        class="v2-tabs-list"
        role="tablist"
        aria-label={label}
        onKeyDown={(e) => {
          const index = items.findIndex((item) => item.value === value);
          let next = index;
          if (e.key === "ArrowRight") next = (index + 1) % items.length;
          else if (e.key === "ArrowLeft")
            next = (index + items.length - 1) % items.length;
          else if (e.key === "Home") next = 0;
          else if (e.key === "End") next = items.length - 1;
          else return;
          e.preventDefault();
          change(items[next].value);
          const button =
            e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[
              next
            ];
          button?.focus();
          button?.scrollIntoView({ block: "nearest", inline: "nearest" });
        }}
      >
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={id + "-tab-" + item.value}
            aria-controls={id + "-panel-" + item.value}
            aria-selected={item.value === value}
            tabIndex={item.value === value ? 0 : -1}
            class="v2-tabs-tab"
            onClick={() => change(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {accessory !== undefined && (
        <div class="v2-tabs-accessory">{accessory}</div>
      )}
    </div>
  );
}
