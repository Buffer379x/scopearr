export type Confirmation = {
  message: string;
  actionLabel?: string;
  danger?: boolean;
  reset?: boolean;
  discard?: boolean;
  // Where focus goes when the element that asked is gone or locked once the
  // dialog closes: the next enabled button of its row (5b Task 10 M-6).
  returnFocus?: () => HTMLElement | null;
  resolve: (accepted: boolean) => void;
};
let active: Confirmation | null = null,
  opener: HTMLElement | null = null;
const emit = () => listeners.forEach((listener) => listener());
const listeners = new Set<() => void>();
// The element that asked (a row's button) and the next enabled, visible
// button of its row, read when a question opens.
function ask(confirmation: Omit<Confirmation, "returnFocus">) {
  const doc = globalThis.document,
    focused = doc?.activeElement as HTMLElement | null | undefined;
  opener = focused && focused !== doc.body ? focused : null;
  const from = opener;
  active = {
    ...confirmation,
    returnFocus: () => {
      const row = from?.closest("tr, li, [role=row]");
      const buttons = [
        ...(row?.querySelectorAll<HTMLButtonElement>("button") ?? []),
      ];
      return (
        buttons
          .slice(buttons.indexOf(from as HTMLButtonElement) + 1)
          .concat(buttons)
          .find(
            (b) =>
              b !== from &&
              b.isConnected &&
              !b.disabled &&
              b.getClientRects().length > 0,
          ) ?? null
      );
    },
  };
  emit();
}
// After an answer the dialog hands focus back to the element that asked.
// An action that then locks it (a row's buttons while its request runs)
// would drop focus to the page: once it is disabled while it still has
// focus, or focus fell to the page, focus goes on to returnFocus(), else to
// the page's h1. The watch ends there, when focus moves on or after 10 s.
function keepFocus(from: HTMLElement | null, next: () => HTMLElement | null) {
  const doc = globalThis.document;
  if (!from || typeof MutationObserver === "undefined") return;
  const observer = new MutationObserver(() => {
    if (!(from as HTMLButtonElement).disabled && from.isConnected) return;
    stop();
    // Once the dialog has closed and handed focus back.
    setTimeout(() => {
      const at = doc.activeElement;
      if (at !== from && at !== doc.body) return;
      const target = next() ?? doc.querySelector<HTMLElement>("h1");
      if (!target) return;
      if (target.tagName === "H1" && !target.hasAttribute("tabindex"))
        target.setAttribute("tabindex", "-1");
      target.focus();
    });
  });
  const moved = (event: FocusEvent) => {
    if (event.target !== from) stop();
  };
  const timer = setTimeout(() => stop(), 10000);
  function stop() {
    observer.disconnect();
    doc.removeEventListener("focusin", moved);
    clearTimeout(timer);
  }
  observer.observe(doc.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["disabled"],
  });
  doc.addEventListener("focusin", moved);
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
  const from = opener;
  active = null;
  opener = null;
  emit();
  if (accepted) keepFocus(from, pending.returnFocus!);
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
