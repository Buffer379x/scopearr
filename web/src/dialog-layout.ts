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
