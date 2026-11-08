import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useLayoutEffect, useRef } from "preact/hooks";

// Distance to the anchor and the least distance to the viewport's edges, in
// pixels (an exception in docs/STYLEGUIDE.md, Part 1, 4).
const GAP = 6,
  MARGIN = 8;
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(value, high));
// The one shown overlay (a popover, quick search): one that opens closes
// the one before it (close(false)), whoever owns it and however it opened.
// It returns the latest close, for listeners added once.
let shown: { close(returnFocus: boolean): void } | null = null;
export function useOneOverlay(close: (returnFocus: boolean) => void) {
  const closer = useRef(close);
  closer.current = close;
  useLayoutEffect(() => {
    const self = {
      close: (returnFocus: boolean) => closer.current(returnFocus),
    };
    const before = shown;
    shown = self;
    before?.close(false);
    return () => {
      if (shown === self) shown = null;
    };
  }, []);
  return closer;
}

// The one popover and menu (docs/STYLEGUIDE.md, Part 1, 10.8): rendered into
// body, or into the modal its anchor sits in (the open drawer), fixed at its
// anchor's rectangle and kept inside the viewport. It focuses its first
// element. Escape with focus in it, on its anchor or on body returns focus
// to the anchor and calls close(true), before the modal sees it; Escape
// elsewhere (a dialog) stays the page's. A press outside and a resize call
// close(false). A menu moves with ↑/↓, Home and End; Tab leaves from the
// anchor. Only one popover is open at a time. A wide popover has the widest
// popover width, so content that changes (a time) never moves it.
export function Popover({
  anchor,
  placement,
  role,
  label,
  close,
  wide = false,
  children,
}: {
  anchor: HTMLElement;
  placement: "bottom-end" | "top-end" | "right-end";
  role: "menu" | "dialog";
  label: string;
  close(returnFocus: boolean): void;
  wide?: boolean;
  children: ComponentChildren;
}) {
  const root = useRef<HTMLDivElement>(null);
  // The latest close, for listeners added once per anchor.
  const closer = useOneOverlay(close);

  // Placed at once, again when its size changes (content that loads after
  // opening) and on every scroll (the sticky topbar moves its anchor).
  useLayoutEffect(() => {
    const pop = root.current;
    if (!pop) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect(),
        width = pop.offsetWidth,
        height = pop.offsetHeight,
        viewWidth = document.documentElement.clientWidth,
        viewHeight = window.innerHeight;
      const below = rect.bottom + GAP,
        above = rect.top - GAP - height;
      const top =
        placement === "right-end"
          ? rect.bottom - height
          : placement === "top-end"
            ? above < MARGIN
              ? below
              : above
            : below + height > viewHeight - MARGIN
              ? above
              : below;
      const left =
        placement === "right-end" ? rect.right + GAP : rect.right - width;
      pop.style.left = clamp(left, MARGIN, viewWidth - width - MARGIN) + "px";
      pop.style.top = clamp(top, MARGIN, viewHeight - height - MARGIN) + "px";
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(pop);
    const scroll = { capture: true, passive: true };
    window.addEventListener("scroll", place, scroll);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", place, scroll);
    };
  }, [anchor, placement]);
  // The first element takes focus once per anchor.
  useLayoutEffect(() => {
    const pop = root.current;
    if (!pop) return;
    (pop.querySelector<HTMLElement>(FOCUSABLE) ?? pop).focus({
      preventScroll: true,
    });
  }, [anchor]);

  // Listening from the commit on, not after paint: an Escape or a press
  // right after the popover shows closes it too.
  useLayoutEffect(() => {
    const inside = (node: Node | null) =>
      !!node && (!!root.current?.contains(node) || anchor.contains(node));
    const outside = (event: Event) => {
      if (!inside(event.target as Node)) closer.current(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const active = document.activeElement;
      if (active && active !== document.body && !inside(active)) return;
      event.preventDefault();
      anchor.focus();
      closer.current(true);
    };
    const resize = () => closer.current(false);
    // Escape in the capture phase: a modal around the anchor (the drawer)
    // closes on its own Escape, which then finds it taken.
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", resize);
    };
  }, [anchor]);

  const keydown = (event: KeyboardEvent) => {
    const pop = root.current;
    if (!pop) return;
    const active = document.activeElement;
    if (event.key === "Tab") {
      const list = [...pop.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const last = event.shiftKey ? list[0] : list[list.length - 1];
      // Focus on a dialog itself (its pressed button locked, such as Sync
      // now): Tab goes to its first element, Shift+Tab to its last.
      if (role !== "menu" && list.length && active === pop) {
        event.preventDefault();
        (event.shiftKey ? list[list.length - 1] : list[0]).focus();
        return;
      }
      if (role !== "menu" && list.length && active !== last) return;
      // From the anchor, Tab goes on to the element after it.
      if (event.shiftKey) event.preventDefault();
      anchor.focus();
      closer.current(false);
      return;
    }
    if (role !== "menu") return;
    const items = [...pop.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = items.indexOf(active as HTMLElement);
    const move = (index: number) => {
      event.preventDefault();
      items[(index + items.length) % items.length]?.focus();
    };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at < 0 ? -1 : at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
  };

  return createPortal(
    <div
      ref={root}
      class={
        "v2-pop" +
        (role === "menu" ? " v2-menu" : "") +
        (wide ? " v2-pop--wide" : "")
      }
      role={role}
      aria-label={label}
      tabIndex={-1}
      onKeyDown={keydown}
    >
      {children}
    </div>,
    // Inside the modal, it stays in the modal's tree and focus trap.
    anchor.closest<HTMLElement>('[aria-modal="true"]') ?? document.body,
  );
}
