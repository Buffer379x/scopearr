const stack: HTMLDialogElement[] = [];
// How each open modal closes through its owner (its close prop), so the
// owner's state forgets it; one without falls back to the native close.
const closers = new Map<HTMLDialogElement, () => void>();
export function topmost<T extends { open: boolean }>(items: T[]): T | null {
  return [...items].reverse().find((item) => item.open) ?? null;
}
export function pushDialog(dialog: HTMLDialogElement, close?: () => void) {
  const index = stack.indexOf(dialog);
  if (index >= 0) stack.splice(index, 1);
  stack.push(dialog);
  if (close) closers.set(dialog, close);
  window.dispatchEvent(new Event("scopearr-dialogs"));
}
export function removeDialog(dialog: HTMLDialogElement) {
  const index = stack.indexOf(dialog);
  if (index >= 0) stack.splice(index, 1);
  closers.delete(dialog);
  window.dispatchEvent(new Event("scopearr-dialogs"));
}
export function topmostDialog(): HTMLDialogElement | null {
  return topmost(stack.filter((dialog) => dialog.isConnected));
}

export function trackNativeDialog(dialog: HTMLDialogElement) {
  if (!stack.includes(dialog)) pushDialog(dialog);
}

// The open modals, the topmost last.
export function openDialogs(): HTMLDialogElement[] {
  return stack.filter((dialog) => dialog.isConnected && dialog.open);
}

// A new page (rc.4 R9): the modals that were open on the page before and
// are still open close, topmost first, through their owners. A modal that
// lives outside the page (File & metadata, the shell's) would otherwise
// stay open over the new page and keep it inert, whichever way the route
// changed: a toast's link inside the dialog, Back or Forward. Modals of
// the page that left are gone already; ones the new page opened in the
// same commit are not in `before`.
export function closeDialogs(before: HTMLDialogElement[]) {
  for (const dialog of [...before].reverse()) {
    if (!dialog.isConnected || !dialog.open) continue;
    const close = closers.get(dialog);
    if (close) close();
    else dialog.close();
  }
}
