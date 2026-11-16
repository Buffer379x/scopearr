import type { LogFilter } from "./event-log";

export type NotificationKind = "success" | "warning" | "error";
// An in-app link a toast offers (Open Muxing after a marking, V14). The
// label is a catalog key: the toast translates it when it shows, so the
// link follows the language without a new toast.
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
  !!(target as Element | null)?.closest?.(".v2-toasts");

// Toasts stay bottom right (rc.4 R3; on phones above the tab bar, by the
// region's CSS) and clear of what they would cover there: the open popover
// (`clearing`) and, in their host (the page or the open modal), the
// controls at the bottom (TOAST_CLEAR: a dialog's foot with its actions,
// the filter drawer's foot, the settings' save dock). Each one in their
// column that they would cover, from the lowest up, lifts their region to
// --sp-3 above it (`--toast-lift`, added to the region's own bottom), as
// long as the whole region then still starts inside the view; else it
// keeps the lowest clearance that fits. Only the toasts move, and they
// move back once nothing is in their way. One placement reads every box
// once, then writes the lift. A popover calls it on each placement (`pop`)
// and when it closes (`gone`); Notifications call it on each change of the
// toasts and, while they show, on each DOM change, scroll and resize.
// Those run once in the next frame however many come; `now` places at
// once (a toast or a popover that shows, a popover that resizes after the
// frame's callbacks), so no frame shows a toast in the way.
const TOAST_CLEAR = ".v2-modal-foot, .v2-drawer-foot, .v2-save-dock";
let clearing: Element | undefined,
  pending = false;
// The lift (px) each region shows now; a region that mounts again starts
// without one.
const lifted = new WeakMap<Element, number>();
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
    gap = parseFloat(getComputedStyle(region).getPropertyValue("--sp-3")),
    shown = lifted.get(region) ?? 0,
    // Where the region ends and starts without any lift.
    base = own.bottom + shown;
  let lift = 0;
  if (own.height)
    for (const box of [
      clearing,
      ...(region.parentElement?.querySelectorAll(TOAST_CLEAR) ?? []),
    ]
      .flatMap((element) => (element ? [element.getBoundingClientRect()] : []))
      .sort((a, b) => b.top - a.top)) {
      if (
        box.left < own.right &&
        own.left < box.right &&
        box.top < base - lift &&
        base - lift - own.height < box.bottom
      ) {
        const next = base - box.top + gap;
        if (base - next - own.height < 0) break;
        lift = next;
      }
    }
  lifted.set(region, lift);
  // The lift is the box's top less the region's own bottom, --sp-3 more.
  const next = lift ? `calc(${lift - gap}px + var(--sp-3))` : "";
  if (region.style.getPropertyValue("--toast-lift") !== next)
    next
      ? region.style.setProperty("--toast-lift", next)
      : region.style.removeProperty("--toast-lift");
}
