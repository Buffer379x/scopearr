// A stale tab can reference a removed chunk after an update. Persist the guard
// before reloading so a genuinely broken deployment cannot cause a reload loop.
export function installPreloadRecovery() {
  window.addEventListener("vite:preloadError", (event) => {
    try {
      const key = "scopearr-preload-reloaded";
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      return;
    }
    event.preventDefault();
    window.location.reload();
  });
}
