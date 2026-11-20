import type { Evidence, FieldConfirmation } from "./types";
export function evidenceChoices(
  e: Partial<Evidence>,
): { source: FieldConfirmation["source"]; value: string }[] {
  return (["filename", "api", "mediaServer", "mediainfo"] as const).flatMap(
    (source) => {
      const value = source === "mediaServer" ? e.emby : e[source];
      return value ? [{ source, value }] : [];
    },
  );
}
export function evidenceSelectable(
  e: Partial<Evidence>,
  ruleConflict = false,
): boolean {
  return (
    !!e.confirmed ||
    !!e.conflict ||
    ruleConflict ||
    evidenceChoices(e).length >= 2
  );
}
