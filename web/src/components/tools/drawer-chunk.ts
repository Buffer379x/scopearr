import { chunkRetry, lazyChunk } from "../../hooks/useLazyChunk";
import type ToolFilterDrawer from "./ToolFilterDrawer";

// The tools' filter drawer, a chunk of its own (ruling I4), as the
// library's (library/drawer-chunk.ts): a tool page preloads it at idle and
// opens it through useLazyChunk. The failure handler sits on the import()
// itself, so Vite keeps it inside its preload wrapper: a chunk that cannot
// load resolves null and never raises vite:preloadError. Both drawers
// share FilterDrawer, which the build then puts into a small chunk of its
// own.
// A failed import retries once under a fresh address (chunkRetry, 2.0.1).
const retry = chunkRetry();
export const toolDrawerChunk = lazyChunk<typeof ToolFilterDrawer>(
  () =>
    retry.fresh(
      (chunk: { default: typeof ToolFilterDrawer }) => chunk.default,
    ) ??
    import("./ToolFilterDrawer").then((chunk) => chunk.default, retry.failed),
);
