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

// Tab inside an open modal (Phase 5d, Task 14): the native modal lets
// focus leave for the browser's own controls at its ends, and Chrome's
// Shift+Tab from the body's first control skips the head. So the dialog
// moves focus itself: to the next (Shift: previous) of its tab stops,
// wrapping at the ends. From an element that is no stop (the title, an
// unchecked radio, the dialog) it goes to the first stop after it (Shift:
// the last before it) in document order. `follows(a, b)` is true when b
// comes after a. Null without stops.
export function nextTabStop<T>(
  stops: readonly T[],
  active: T | null,
  back: boolean,
  follows: (a: T, b: T) => boolean,
): T | null {
  const n = stops.length;
  if (!n) return null;
  const at = active === null ? -1 : stops.indexOf(active);
  if (at >= 0) return stops[(at + (back ? n - 1 : 1)) % n];
  if (active === null) return back ? stops[n - 1] : stops[0];
  return back
    ? ([...stops].reverse().find((stop) => follows(stop, active)) ??
        stops[n - 1])
    : (stops.find((stop) => follows(active, stop)) ?? stops[0]);
}

// The tab stops of `root` in document order, as the browser's Tab reaches
// them: a details' summary too; not taken out of the order, not disabled
// (a disabled fieldset too), not under [inert], rendered and visible (not
// [hidden], display:none or visibility:hidden), not in the content of a
// closed details; and one radio per group (the checked one, else the
// first).
const TABBABLE =
  "a[href], button, input, select, textarea, [tabindex], " +
  "details > summary:first-of-type, " +
  "[contenteditable]:not([contenteditable=false]), iframe, " +
  "audio[controls], video[controls]";
export function tabStops(root: Element): HTMLElement[] {
  const seen = new Set<string>();
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => {
    if (el.tabIndex < 0 || el.matches(":disabled")) return false;
    if (el.closest("[inert]")) return false;
    const closed = el.closest("details:not([open])");
    if (closed && !(el.matches("summary") && el.parentElement === closed))
      return false;
    if (
      !(el.checkVisibility
        ? el.checkVisibility({ visibilityProperty: true })
        : el.getClientRects().length > 0)
    )
      return false;
    const radio = el as HTMLInputElement;
    if (radio.type !== "radio" || !radio.name) return true;
    const checked = [
      ...root.querySelectorAll<HTMLInputElement>("input[type=radio]"),
    ].find((other) => other.name === radio.name && other.checked);
    if (checked) return checked === radio;
    if (seen.has(radio.name)) return false;
    seen.add(radio.name);
    return true;
  });
}
