import type { ComponentChildren, ComponentProps } from "preact";
import { useId, useLayoutEffect, useRef } from "preact/hooks";
import { revealDialogTabs } from "../dialog-layout";

// The 1.7.0 segmented tabs, moved here unchanged from ui.tsx (Phase 5d,
// Task 3: out of the start set); DialogTabs is their only user, and both
// go when the last 1.7.0 dialog does.
export function SegmentedTabs({
  label,
  items,
  value,
  change,
  id: givenID,
}: {
  label: string;
  items: { value: string; label: ComponentChildren }[];
  value: string;
  change: (value: string) => void;
  id?: string;
}) {
  const generated = useId(),
    id = givenID || generated,
    ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      class="segmented"
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
          ref.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next];
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
          class={item.value === value ? "active" : ""}
          onClick={() => change(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function DialogTabs({
  children,
  accessory,
  heading,
  ...tabs
}: ComponentProps<typeof SegmentedTabs> & {
  children: ComponentChildren;
  accessory?: ComponentChildren;
  heading?: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = ref.current?.querySelector<HTMLElement>(
      ':scope > .dialog-tabs-heading > [role="tablist"]',
    );
    if (bar) revealDialogTabs(bar);
  }, [tabs.value]);
  return (
    <div class="dialog-tabs" ref={ref}>
      {heading && <h3 class="card-title">{heading}</h3>}
      {tabs.items.length > 0 && (
        <div class="dialog-tabs-heading">
          <SegmentedTabs {...tabs} />
          {accessory}
        </div>
      )}
      {children}
    </div>
  );
}
