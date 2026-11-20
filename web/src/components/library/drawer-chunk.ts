import { lazyChunk } from "../../hooks/useLazyChunk";
import type LibraryFilterDrawer from "./LibraryFilterDrawer";

// The library's filter drawer, a chunk of its own (E6, ruling P10): the
// page preloads it at idle and opens it through useLazyChunk. The failure
// handler sits on the import() itself, so Vite keeps it inside its preload
// wrapper: a chunk that cannot load (offline, an old tab after an update)
// resolves null and never raises vite:preloadError.
export const drawerChunk = lazyChunk<typeof LibraryFilterDrawer>(() =>
  import("./LibraryFilterDrawer").then(
    (chunk) => chunk.default,
    () => null,
  ),
);
