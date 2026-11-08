import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useLayoutEffect, useRef } from "preact/hooks";
import { inToasts, TOASTS_EVENT } from "../../notifications";

// Distance to the anchor and the least distance to the viewport's edges, in
// pixels (an exception in docs/STYLEGUIDE.md, Part 1, 4).
const GAP = 6,
  MARGIN = 8;
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(value, high));
// The one shown overlay (a popover, quick search, the filter drawer) per
// scope: the page, or the modal an overlay opens in (the filter drawer).
// One that opens closes the one before it in its scope (close(false)),
// whoever owns it and however it opened, so a menu in the drawer closes
// another one there and leaves the drawer open. It returns the latest
// close, for listeners added once.
const shown = new Map<Element | null, { close(returnFocus: boolean): void }>();
export function useOneOverlay(
  close: (returnFocus: boolean) => void,
  scope: Element | null = null,
) {
  const closer = useRef(close);
  closer.current = close;
  useLayoutEffect(() => {
    const self = {
      close: (returnFocus: boolean) => closer.current(returnFocus),
    };
    const before = shown.get(scope);
    shown.set(scope, self);
    before?.close(false);
    return () => {
      if (shown.get(scope) === self) shown.delete(scope);
    };
  }, []);
  return closer;
}

// Toasts stay top right (E29) and clear of the open popover: while it
// shares their column and they would cover it, their region starts --sp-3
// below it; only the toasts move, and they move back once it closes. Each
// placement and each change of the toasts (TOASTS_EVENT) measures again;
// `clearing` is the popover the toasts avoid.
let clearing: HTMLElement | undefined;
function clearToasts(pop?: HTMLElement) {
  const region = document.querySelector<HTMLElement>(".v2-toasts");
  clearing = pop;
  if (!region) return;
  if (region.style.top) region.style.removeProperty("top");
  const own = region.getBoundingClientRect(),
    box = pop?.getBoundingClientRect();
  if (
    box &&
    own.height &&
    box.left < own.right &&
    own.left < box.right &&
    box.top < own.bottom &&
    own.top < box.bottom
  )
    region.style.top = `calc(${box.bottom}px + var(--sp-3))`;
}

// The one popover and menu (docs/STYLEGUIDE.md, Part 1, 10.8): rendered into
// body, or into the modal its anchor sits in (the open drawer), fixed at its
// anchor's rectangle and kept inside the viewport. It focuses its first
// element. Escape with focus in it, on its anchor or on body returns focus
// to the anchor and calls close(true), before the modal sees it; Escape
// elsewhere (a dialog) stays the page's. A press outside (not in the toast
// region) and a resize call close(false); after a resize, focus in it or
// on body returns to the anchor while that is still in the document. A
// menu moves with ↑/↓, Home and End over its entries (menuitem,
// menuitemradio and menuitemcheckbox, ruling P6), skipping disabled ones
// (disabled, aria-disabled="true"); Tab leaves from the anchor. Only one
// popover is open at a time in its scope (the page or the open drawer).
// Its width is the prop `wide`:
// true takes the widest popover width, so content that changes (a time)
// never moves it, and "track" the track popover's (--pop-track); without it
// the popover sizes to its content. Toasts keep clear of it (clearToasts).
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
  wide?: boolean | "track";
  children: ComponentChildren;
}) {
  const root = useRef<HTMLDivElement>(null);
  // Inside a modal (the open drawer) it renders there and is one of the
  // modal's overlays.
  const modal = anchor.closest<HTMLElement>('[aria-modal="true"]');
  // The latest close, for listeners added once per anchor.
  const closer = useOneOverlay(close, modal);

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
      clearToasts(pop);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(pop);
    const scroll = { capture: true, passive: true };
    window.addEventListener("scroll", place, scroll);
    window.addEventListener(TOASTS_EVENT, place);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", place, scroll);
      window.removeEventListener(TOASTS_EVENT, place);
      if (clearing === pop) clearToasts();
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
    // Focus in it, on its anchor or nowhere (body).
    const ours = () => {
      const active = document.activeElement;
      return !active || active === document.body || inside(active);
    };
    const outside = (event: Event) => {
      if (!inside(event.target as Node) && !inToasts(event.target))
        closer.current(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !ours()) return;
      event.preventDefault();
      anchor.focus();
      closer.current(true);
    };
    const resize = () => {
      if (anchor.isConnected && ours()) anchor.focus();
      closer.current(false);
    };
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
    const items = [
      ...pop.querySelectorAll<HTMLElement>(
        '[role^="menuitem"]:not([disabled]):not([aria-disabled="true"])',
      ),
    ];
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
        (wide === "track" ? " v2-pop--track" : wide ? " v2-pop--wide" : "")
      }
      role={role}
      aria-label={label}
      tabIndex={-1}
      onKeyDown={keydown}
    >
      {children}
    </div>,
    // Inside the modal, it stays in the modal's tree and focus trap.
    modal ?? document.body,
  );
}
