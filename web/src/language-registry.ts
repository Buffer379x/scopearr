// The full language registry, a chunk of its own (language-data). The import
// stands alone, so Vite's preload helper wraps only the import: a failed chunk
// load (an old tab after an update) reaches the reload guard in
// preload-recovery.ts before languages.ts handles the failure.
export function importLanguageRegistry(): Promise<{ default: unknown }> {
  return import("../../internal/langdata/registry.json", {
    with: { type: "json" },
  });
}
