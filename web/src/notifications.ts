import type { LogFilter } from "./event-log";

export type NotificationKind = "success" | "warning" | "error";
// Background errors may pass a log filter; the toast then offers Show in log.
export function notify(
  message: string,
  kind: NotificationKind = "success",
  log?: LogFilter,
) {
  window.dispatchEvent(
    new CustomEvent("scopearr-notification", {
      detail: { message, kind, log },
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
// the page header's actions while it has any). Each one in their column
// that they would cover, from the highest down, moves their region to
// --sp-3 below it, so they start below the last; only the toasts move, and
// they move back once nothing is in their way. Should their first toast
// then leave the view (or reach the tab bar), they keep --toast-top. A
// popover calls it on each placement (`pop`) and when it closes (`gone`);
// Notifications call it on each change of the toasts and, while they show,
// on each DOM change, scroll and resize.
const TOAST_CLEAR = ".v2-tc-head, .v2-page-actions:not(:empty)";
let clearing: Element | undefined;
export function placeToasts(pop?: Element, gone = false) {
  if (pop) clearing = !gone ? pop : clearing === pop ? undefined : clearing;
  const region = document.querySelector<HTMLElement>(".v2-toasts");
  if (!region) return;
  if (region.style.top) region.style.removeProperty("top");
  if (!region.getBoundingClientRect().height) return;
  const boxes = [
    clearing,
    ...(region.parentElement?.querySelectorAll(TOAST_CLEAR) ?? []),
  ]
    .flatMap((element) => (element ? [element.getBoundingClientRect()] : []))
    .sort((a, b) => a.top - b.top);
  for (const box of boxes) {
    const own = region.getBoundingClientRect();
    if (
      box.left < own.right &&
      own.left < box.right &&
      box.top < own.bottom &&
      own.top < box.bottom
    )
      region.style.top = `calc(${box.bottom}px + var(--sp-3))`;
  }
  const first = region.firstElementChild?.getBoundingClientRect();
  if (!first || !region.style.top) return;
  const bar = document.querySelector(".v2-tabbar")?.getBoundingClientRect();
  if (first.bottom > (bar?.height ? bar.top : window.innerHeight))
    region.style.removeProperty("top");
}
