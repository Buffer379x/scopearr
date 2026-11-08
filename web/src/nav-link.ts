// In-app links are real links: a plain left click (also Enter) opens the
// target in the app; the middle button and clicks with Ctrl, Cmd, Shift or
// Alt keep the browser's link, which opens the href in a new tab or window.
export function isPlainClick(
  e: Pick<MouseEvent, "button" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
): boolean {
  return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
}

export function followLink(e: MouseEvent, open: () => unknown): void {
  if (!isPlainClick(e)) return;
  e.preventDefault();
  open();
}

// Quick search's shortcut: ⌘K or Ctrl+K (also K with Caps Lock). With Shift
// or Alt it stays the browser's (Firefox opens its console with
// Ctrl+Shift+K; AltGr is Ctrl+Alt).
export function isSearchKey(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
): boolean {
  return (
    (e.metaKey || e.ctrlKey) &&
    !e.shiftKey &&
    !e.altKey &&
    e.key.toLowerCase() === "k"
  );
}
