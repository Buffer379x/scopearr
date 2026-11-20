import type { RefObject } from "preact";
import { useLayoutEffect } from "preact/hooks";
import type { FlyoutInput } from "../../flyout";
import type { NavEntry } from "../../nav-model";
import type { NavTarget } from "../../router";
import { count } from "../../ui";
import { NavLink } from "./NavLink";

export const FLYOUT_ID = "v2-fly";

// What the rail flyout shows for one rail entry: a group (a header, linked
// when the group has a page of its own, and its entries) or only the label.
export type FlyoutContent = {
  key: string;
  label: string;
  head?: NavEntry;
  entries?: NavEntry[];
};

// The rail flyout (docs/STYLEGUIDE.md, Part 1, 10.1): a sibling of the
// sidebar, fixed beside the rail. The sidebar runs the state machine
// (flyout.ts) and hands it the shown content; this component draws it,
// places it at its rail entry and handles the keys inside it: ↑/↓, Home and
// End move, ← and Escape go back to the entry (back), Tab leaves (tab).
// A label-only flyout is decorative (aria-hidden): its entry has the name.
export function SidebarFlyout({
  panel,
  content,
  visible,
  anchor,
  hrefOf,
  pick,
  send,
  back,
  tab,
  focusOut,
  focusRequest,
}: {
  panel: RefObject<HTMLDivElement>;
  content: FlyoutContent | null;
  visible: boolean;
  anchor: HTMLElement | null;
  hrefOf(target: NavTarget): string;
  // A plain click on an entry: closes the flyout and opens the target.
  pick(target: NavTarget): void;
  send(input: FlyoutInput): void;
  back(): void;
  tab(backward: boolean): void;
  focusOut(next: Node | null): void;
  // Counts up when → or Enter opened a group: focus its current entry.
  focusRequest: number;
}) {
  const entries = content?.entries;
  // A group starts at the top of its entry, kept inside the sidebar card; a
  // label is centered on its entry (the stylesheet shifts it by half).
  useLayoutEffect(() => {
    const element = panel.current;
    if (!visible || !anchor || !element) return;
    const rect = anchor.getBoundingClientRect();
    if (!entries) {
      element.style.top = rect.top + rect.height / 2 + "px";
      return;
    }
    const card = anchor.closest(".v2-sidebar")?.getBoundingClientRect();
    const top = card
      ? Math.max(
          card.top,
          Math.min(rect.top, card.bottom - element.offsetHeight),
        )
      : rect.top;
    element.style.top = top + "px";
  }, [visible, anchor, content?.key]);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!focusRequest || !visible || !element) return;
    (
      element.querySelector<HTMLElement>('a[aria-current="page"]') ??
      element.querySelector<HTMLElement>("a")
    )?.focus();
  }, [focusRequest]);

  const keydown = (event: KeyboardEvent) => {
    const links = [...(panel.current?.querySelectorAll("a") ?? [])];
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    const move = (index: number) => {
      event.preventDefault();
      links[(index + links.length) % links.length]?.focus();
    };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at < 0 ? -1 : at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(links.length - 1);
    else if (event.key === "ArrowLeft" || event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      back();
    } else if (event.key === "Tab") {
      event.preventDefault();
      tab(event.shiftKey);
    }
  };
  const pointer = (type: "flyoutenter" | "leave") => (event: PointerEvent) => {
    if (event.pointerType !== "touch") send({ type });
  };
  const link = (entry: NavEntry, className: string, label = entry.label) => (
    <NavLink
      key={entry.key}
      class={className}
      href={hrefOf(entry.target)}
      current={entry.current}
      open={() => pick(entry.target)}
    >
      <span>{label}</span>
      {className === "v2-fly-item" && !!entry.count && (
        <span class="v2-fly-meta" aria-hidden="true">
          {count(entry.count)}
        </span>
      )}
    </NavLink>
  );
  return (
    <div
      ref={panel}
      id={FLYOUT_ID}
      class={entries ? "v2-fly" : "v2-fly v2-fly--label"}
      data-open={visible ? "" : undefined}
      role={entries ? "group" : undefined}
      aria-label={entries ? content?.label : undefined}
      aria-hidden={entries && visible ? undefined : "true"}
      onPointerEnter={pointer("flyoutenter")}
      onPointerLeave={pointer("leave")}
      onFocusIn={() => send({ type: "focusin" })}
      onFocusOut={(event) => focusOut(event.relatedTarget as Node | null)}
      onKeyDown={keydown}
    >
      {content &&
        (entries ? (
          <>
            <p class="v2-fly-head">
              {content.head ? (
                link(content.head, "v2-fly-head-link", content.label)
              ) : (
                <span>{content.label}</span>
              )}
            </p>
            {entries.map((entry) => link(entry, "v2-fly-item"))}
          </>
        ) : (
          <span class="v2-fly-label">{content.label}</span>
        ))}
    </div>
  );
}
