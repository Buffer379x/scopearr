import { chunkRetry, lazyChunk } from "../../hooks/useLazyChunk";
import type LibraryFilterDrawer from "./LibraryFilterDrawer";

// The library's filter drawer, a chunk of its own (E6, ruling P10): the
// page preloads it at idle and opens it through useLazyChunk. The failure
// handler sits on the import() itself, so Vite keeps it inside its preload
// wrapper: a chunk that cannot load (offline, an old tab after an update)
// resolves null and never raises vite:preloadError.
// A failed import retries once under a fresh address (chunkRetry, 2.0.1).
const retry = chunkRetry();
export const drawerChunk = lazyChunk<typeof LibraryFilterDrawer>(
  () =>
    retry.fresh(
      (chunk: { default: typeof LibraryFilterDrawer }) => chunk.default,
    ) ??
    import("./LibraryFilterDrawer").then(
      (chunk) => chunk.default,
      retry.failed,
    ),
);
