import { lazyChunk } from "../../hooks/useLazyChunk";
import type { FileDialog } from "../FileDialog";

// File & metadata, a chunk of its own (Phase 5d, Task 6), like the filter
// drawer: the library preloads it at idle and opens it through
// useLazyChunk, so its tabs, tables, menus and the rename preview stay out
// of the library chunk. The failure handler sits on the import() itself: a
// chunk that cannot load resolves null and never reloads the page.
export const fileDialogChunk = lazyChunk<typeof FileDialog>(() =>
  import("../FileDialog").then(
    (chunk) => chunk.FileDialog,
    () => null,
  ),
);
