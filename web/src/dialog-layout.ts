// The keyboard can resize only the visual viewport, leaving dvh unchanged.
// The body that scrolls a focused field into view: the 1.7.0 scan dialogs'
// (.scan-dialog-body), or the v2 modal's (Phase 5d), which names its two
// local properties (the visible height and top) itself.
export function trackDialogViewport(
  dialog: HTMLDialogElement,
  bodySelector = ".scan-dialog-body",
  names = ["--dialog-viewport-height", "--dialog-viewport-top"],
) {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  const update = () => {
    dialog.style.setProperty(names[0], `${viewport.height}px`);
    dialog.style.setProperty(names[1], `${viewport.offsetTop}px`);
    const body = dialog.querySelector(bodySelector);
    const focused = dialog.ownerDocument.activeElement;
    if (!body || !focused || !body.contains(focused)) return;
    const bounds = body.getBoundingClientRect();
    const input = focused.getBoundingClientRect();
    if (input.top < bounds.top || input.bottom > bounds.bottom)
      focused.scrollIntoView({ block: "nearest" });
  };
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  return () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    dialog.style.removeProperty(names[0]);
    dialog.style.removeProperty(names[1]);
  };
}
