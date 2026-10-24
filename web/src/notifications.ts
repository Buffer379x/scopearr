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
