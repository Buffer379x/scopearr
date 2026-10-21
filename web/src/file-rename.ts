import { validateFilenameStem } from "./mux-spec.ts";
export type Companion = { from: string; to: string; conflict: boolean };
export type RenamePreview = { filename: string; companions: Companion[] };
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
