const stack: HTMLDialogElement[] = [];
export function topmost<T extends { open: boolean }>(items: T[]): T | null {
  return [...items].reverse().find((item) => item.open) ?? null;
}
export function pushDialog(dialog: HTMLDialogElement) {
  const index = stack.indexOf(dialog);
  if (index >= 0) stack.splice(index, 1);
  stack.push(dialog);
  window.dispatchEvent(new Event("scopearr-dialogs"));
}
export function removeDialog(dialog: HTMLDialogElement) {
  const index = stack.indexOf(dialog);
  if (index >= 0) stack.splice(index, 1);
  window.dispatchEvent(new Event("scopearr-dialogs"));
}
export function topmostDialog(): HTMLDialogElement | null {
  return topmost(stack.filter((dialog) => dialog.isConnected));
}

export function trackNativeDialog(dialog: HTMLDialogElement) {
  if (!stack.includes(dialog)) pushDialog(dialog);
}
