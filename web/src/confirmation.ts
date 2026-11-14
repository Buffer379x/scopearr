export type Confirmation = {
  message: string;
  actionLabel?: string;
  danger?: boolean;
  reset?: boolean;
  discard?: boolean;
  // The element that asked (a row's button), read when the question opens;
  // the dialog keeps focus near it (dialog-focus.ts).
  opener?: HTMLElement | null;
  resolve: (accepted: boolean) => void;
};
let active: Confirmation | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
function ask(confirmation: Confirmation) {
  const doc = globalThis.document,
    at = doc?.activeElement as HTMLElement | null | undefined;
  active = { ...confirmation, opener: at === doc?.body ? null : at };
  emit();
}
export function currentConfirmation() {
  return active;
}
export function subscribeConfirmation(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function confirmDeletion(
  message: string,
  reset = false,
  actionLabel?: string,
): Promise<boolean> {
  if (active) return Promise.resolve(false);
  return new Promise((resolve) =>
    ask({ message, reset, resolve, actionLabel, danger: !reset }),
  );
}
export function answerConfirmation(accepted: boolean) {
  const pending = active;
  if (!pending) return;
  active = null;
  emit();
  pending.resolve(accepted);
}

export function confirmReset(message: string) {
  return confirmDeletion(message, true);
}

export function confirmDiscard(message: string): Promise<boolean> {
  if (active) return Promise.resolve(false);
  return new Promise((resolve) => ask({ message, discard: true, resolve }));
}

export function confirmAction(
  message: string,
  actionLabel: string,
): Promise<boolean> {
  if (active) return Promise.resolve(false);
  return new Promise((resolve) => ask({ message, actionLabel, resolve }));
}
