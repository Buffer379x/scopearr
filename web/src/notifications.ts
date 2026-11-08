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
// The toasts changed (Notifications): an open popover keeps them clear.
export const TOASTS_EVENT = "scopearr-toasts";
// A press in the toast region is never a press outside a popover or menu:
// dismissing a toast keeps them open.
export const inToasts = (target: EventTarget | null) =>
  !!(target as Element | null)?.closest?.(".toast-region");
