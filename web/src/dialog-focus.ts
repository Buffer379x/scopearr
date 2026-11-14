import { topmostDialog } from "./dialog-stack";

// Where focus goes once a dialog has closed (Phase 5d, R-D) and nothing
// nearer takes it: the title of the dialog still open below it (a
// confirmation over Custom tags; the page's h1 is inert behind it), else
// the page's h1. Either takes focus by script only. Only the v2 dialogs
// import this module, so it stays out of the start set.
export function focusFallback(doc: Document = document): void {
  const below = topmostDialog();
  const target = below
    ? below.querySelector<HTMLElement>("h2")
    : doc.querySelector<HTMLElement>("h1");
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus();
}

// The next enabled, visible button of the row the element sits in, from
// it to the row's end and on from the row's start (a row's Cancel in
// Actions → its Mux options in Info), else null.
export function nextInRow(from: HTMLElement | null | undefined) {
  const buttons = [
    ...(from?.closest("tr, li, [role=row]")?.querySelectorAll("button") ?? []),
  ];
  const at = buttons.indexOf(from as HTMLButtonElement);
  return (
    [...buttons.slice(at + 1), ...buttons.slice(0, at)].find(
      (b) => !b.disabled && b.getClientRects().length > 0,
    ) ?? null
  );
}

// After a confirmed answer the dialog hands focus back to the element that
// asked. An action that then locks or removes it (a row's buttons while its
// request runs, 5b Task 10 M-6) would drop focus to the page: once that
// happens, focus goes on to the row's next button, else to focusFallback.
// The watch ends there, when focus moves elsewhere or after 10 s. A
// MutationObserver, as not every browser blurs a button it disables.
export function keepFocus(from: HTMLElement | null | undefined): void {
  if (!from || typeof MutationObserver === "undefined") return;
  const doc = from.ownerDocument;
  const observer = new MutationObserver(() => {
    if (!(from as HTMLButtonElement).disabled && from.isConnected) return;
    stop();
    // Once the dialog has closed and handed focus back.
    setTimeout(() => {
      const at = doc.activeElement;
      if (at !== from && at !== doc.body) return;
      const next = nextInRow(from);
      if (next) next.focus();
      else focusFallback(doc);
    });
  });
  const moved = (event: Event) => {
    if (event.target !== from) stop();
  };
  const timer = setTimeout(stop, 10000);
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
