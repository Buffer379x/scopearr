import { validateFilenameStem } from "./mux-spec.ts";
export type Companion = {
  from: string;
  to: string;
  conflict: boolean;
  device: string;
};
export type RenamePreview = {
  filename: string;
  companions: Companion[];
  device: string;
  userShare: boolean;
};
export type RenameResult = {
  refresh: string;
  warning?: string;
  newDevices?: string[];
};
export function renameResultTone(result: RenameResult): "success" | "warning" {
  return result.refresh !== "completed" ||
    result.warning ||
    result.newDevices?.length
    ? "warning"
    : "success";
}
export function splitFilename(filename: string): [string, string] {
  const dot = filename.lastIndexOf(".");
  return dot <= 0
    ? [filename, ""]
    : [filename.slice(0, dot), filename.slice(dot)];
}
export function renameState(filename: string, name: string) {
  const error =
    validateFilenameStem(name) ||
    validateFilenameStem(name.replace(/\.mkv$/i, ""));
  return { error, canSave: !error && name !== splitFilename(filename)[0] };
}
export function companionDecision(companions: Companion[]) {
  return {
    confirm: companions.length === 0,
    canRenameAll: !companions.some((c) => c.conflict),
  };
}
// The library's row of a renamed file once the library has read it again
// (Phase 5d, R-F): same service, the new filename; null when it is not on
// the loaded page, so File & metadata closes as in 1.7.0.
export function renamedRow<T extends { service: string; filename: string }>(
  files: T[],
  service: string,
  name: string,
): T | null {
  return (
    files.find((file) => file.service === service && file.filename === name) ??
    null
  );
}

// A completed rename the library follows up (R-F, review I1): the service
// and new name, the results before the reload and whether the reload has
// started. It acts only while File & metadata is open: new results show
// the renamed row (null when the page does not list it, which closes the
// dialog); a closed dialog, or a reload that ends without new results (it
// failed), forgets it, so a later change of the list touches nothing.
export type PendingRename<R> = {
  service: string;
  name: string;
  before: R;
  started: boolean;
};
export function renameFollowUp<
  R extends { files: { service: string; filename: string }[] },
>(
  pending: PendingRename<R> | null,
  open: boolean,
  results: R,
  busy: boolean,
):
  | { pending: PendingRename<R> | null }
  | { pending: null; file: R["files"][number] | null } {
  if (!pending) return { pending };
  if (!open) return { pending: null };
  if (results !== pending.before)
    return {
      pending: null,
      file: renamedRow(results.files, pending.service, pending.name),
    };
  if (busy)
    return {
      pending: pending.started ? pending : { ...pending, started: true },
    };
  return { pending: pending.started ? null : pending };
}
