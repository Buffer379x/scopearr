import { useEffect } from "preact/hooks";
import { readPreference, writePreference } from "./browser-storage";
import { notify } from "./notifications";

// Tool pages never render result-dependent boxes above their results. Errors
// become toasts; api() failures already showed one and are not repeated.
export function reportError(e: unknown) {
  const error = e as (Error & { notified?: boolean }) | undefined;
  if (!error || error.name === "AbortError" || error.notified) return;
  notify(error.message, "error");
}

// A finished scan's error is shown once, even across page visits.
export function useScanErrorToast(
  key: string,
  scan: { startedAt?: string; error?: string; running?: boolean } | undefined,
  format: (error: string) => string,
) {
  useEffect(() => {
    if (!scan?.error || scan.running) return;
    const id = (scan.startedAt || "") + "|" + scan.error;
    if (readPreference(key) === id) return;
    writePreference(key, id);
    notify(format(scan.error), "error");
  }, [scan?.error, scan?.startedAt, scan?.running]);
}
