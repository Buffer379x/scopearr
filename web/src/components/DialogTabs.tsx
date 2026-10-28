import type { ComponentChildren, ComponentProps } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { SegmentedTabs } from "../ui";
import { revealDialogTabs } from "../dialog-layout";

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
