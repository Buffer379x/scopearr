import type { LogFilter } from "./event-log";

export type NotificationKind = "success" | "warning" | "error";
// An in-app link a toast offers (Open Muxing after a marking, V14).
export type NotificationAction = { label: string; hash: string };
// Background errors may pass a log filter; the toast then offers Show in
// log. Without one it offers the action, if any; either link closes the
// toast (openHash).
export function notify(
  message: string,
  kind: NotificationKind = "success",
  log?: LogFilter,
  action?: NotificationAction,
) {
  window.dispatchEvent(
    new CustomEvent("scopearr-notification", {
      detail: { message, kind, log, action },
    }),
  );
}
// The toasts changed (Notifications): an open popover places itself and
// them again.
export const TOASTS_EVENT = "scopearr-toasts";
// A press in the toast region is never a press outside a popover or menu:
// dismissing a toast keeps them open.
export const inToasts = (target: EventTarget | null) =>
  !!(target as Element | null)?.closest?.(".toast-region");

// Toasts stay top right (E29) and clear of what they would cover there:
// the open popover (`clearing`) and, in their host (the page or the open
// modal), the controls at a page's top (TOAST_CLEAR: a list's card head,
// the page header's actions while it has any, and in Settings → Services
// the service card's head and the row of the service tabs). Each one in their column
// that they would cover, from the highest down, moves their region to
// --sp-3 below it, as long as the whole region then still ends above the
// view's end and the tab bar; they start below the last one that fits,
// else at --toast-top, so they never cover the tab bar. Only the toasts
// move, and they move back once nothing is in their way. One placement
// reads every box once, then writes the region's top. A popover calls it
// on each placement (`pop`) and when it closes (`gone`); Notifications
// call it on each change of the toasts and, while they show, on each DOM
// change, scroll and resize. Those run once in the next frame however
// many come; `now` places at once (a toast or a popover that shows, a
// popover that resizes after the frame's callbacks), so no frame shows a
// toast in the way.
const TOAST_CLEAR =
  ".v2-tc-head, .v2-page-actions:not(:empty), .v2-svc-head, .v2-svc-bar";
let clearing: Element | undefined,
  pending = false;
const placeLater = () => {
  if (pending) placeNow();
};
export function placeToasts(pop?: Element, gone = false, now = false) {
  if (pop) clearing = !gone ? pop : clearing === pop ? undefined : clearing;
  if (now) placeNow();
  else if (!pending) {
    pending = true;
    requestAnimationFrame(placeLater);
  }
}
function placeNow() {
  pending = false;
  const region = document.querySelector<HTMLElement>(".v2-toasts");
  if (!region) return;
  const own = region.getBoundingClientRect(),
    style = getComputedStyle(region),
    gap = parseFloat(style.getPropertyValue("--sp-3")),
    bar = document.querySelector(".v2-tabbar")?.getBoundingClientRect(),
    end = Math.min(window.innerHeight, bar?.height ? bar.top : Infinity);
  let top = parseFloat(style.getPropertyValue("--toast-top")),
    below: number | undefined;
  if (own.height)
    for (const box of [
      clearing,
      ...(region.parentElement?.querySelectorAll(TOAST_CLEAR) ?? []),
    ]
      .flatMap((element) => (element ? [element.getBoundingClientRect()] : []))
      .sort((a, b) => a.top - b.top)) {
      if (
        box.left < own.right &&
        own.left < box.right &&
        box.top < top + own.height &&
        top < box.bottom
      ) {
        top = box.bottom + gap;
        if (top + own.height > end) break;
        below = box.bottom;
      }
    }
  const next = below === undefined ? "" : `calc(${below}px + var(--sp-3))`;
  if (region.style.top !== next) region.style.top = next;
}
