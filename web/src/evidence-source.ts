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

export function evidenceMenuPosition(
  anchor: { left: number; top: number; bottom: number; width: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  gap: number,
  mobile: boolean,
) {
  const width = Math.min(
    mobile ? anchor.width : Math.max(anchor.width, menu.width),
    viewport.width - 2 * gap,
  );
  const left = Math.max(
    gap,
    Math.min(anchor.left, viewport.width - width - gap),
  );
  const below = anchor.bottom + gap;
  const top = Math.max(
    gap,
    Math.min(
      below + menu.height <= viewport.height - gap
        ? below
        : anchor.top - menu.height - gap,
      viewport.height - menu.height - gap,
    ),
  );
  return { left, top, width };
}
