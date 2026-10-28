// Each invocation belongs to one open dialog; its maximum never survives close.
export function trackDialogHeight(dialog: HTMLDialogElement) {
  let tallest = 0;
  const measure = () => {
    const height = dialog.getBoundingClientRect().height;
    if (height <= tallest) return;
    tallest = height;
    dialog.style.minHeight = `min(${Math.ceil(tallest)}px, calc(100dvh - var(--layout-50)))`;
  };
  const observer = new ResizeObserver(measure);
  measure();
  observer.observe(dialog);
  return () => {
    observer.disconnect();
    dialog.style.removeProperty("min-height");
  };
}

export function revealDialogTabs(tablist: HTMLElement) {
  const dialog = tablist.closest("dialog");
  if (!dialog) return;
  const visible = dialog.getBoundingClientRect();
  const tabs = tablist.getBoundingClientRect();
  if (tabs.top < visible.top || tabs.bottom > visible.bottom)
    tablist.scrollIntoView({ block: "nearest" });
}

// The keyboard can resize only the visual viewport, leaving dvh unchanged.
export function trackDialogViewport(dialog: HTMLDialogElement) {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  const update = () => {
    dialog.style.setProperty(
      "--dialog-viewport-height",
      `${viewport.height}px`,
    );
    dialog.style.setProperty(
      "--dialog-viewport-top",
      `${viewport.offsetTop}px`,
    );
    const body = dialog.querySelector(".scan-dialog-body");
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
    dialog.style.removeProperty("--dialog-viewport-height");
    dialog.style.removeProperty("--dialog-viewport-top");
  };
}
