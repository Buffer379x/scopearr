import { useEffect, useState } from "preact/hooks";
import { readPreference, writePreference } from "./browser-storage";

const SEEN_KEY = "scopearr-log-seen";

export const logSeen = () => Number(readPreference(SEEN_KEY) || 0);
export function markLogSeen(lastError: number) {
  if (lastError <= logSeen()) return;
  writePreference(SEEN_KEY, String(lastError));
  window.dispatchEvent(new CustomEvent("scopearr-log-seen"));
}
// Errors count as unseen when they are newer than the last Log visit and
// still inside the 24-hour window.
export function useUnseenErrors(lastError = 0) {
  const [seen, setSeen] = useState(logSeen);
  useEffect(() => {
    const update = () => setSeen(logSeen());
    window.addEventListener("scopearr-log-seen", update);
    return () => window.removeEventListener("scopearr-log-seen", update);
  }, []);
  return lastError > seen && Date.now() - lastError < 86_400_000;
}
