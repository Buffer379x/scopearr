import { useMemo } from "preact/hooks";
import { useFontsLoaded } from "./hooks/useFontsLoaded";
import { t, useI18n } from "./i18n";
import {
  domToolMetrics,
  toolColumnStyle,
  toolStatusTexts,
} from "./tool-columns";
import type { ToolButtons } from "./tool-columns";
import type { ToolKind } from "./tool-list";
import { toolTableStyle } from "./tool-table";

// Row-independent measurements follow language changes and the real webfont:
// again after document.fonts.ready and after every face that loads later.
export function useToolTableStyle(
  columns: readonly string[],
  kind: string,
  labels: Record<string, string>,
  statusLabels: Record<string, string>,
) {
  const { locale } = useI18n();
  const fonts = useFontsLoaded();
  return useMemo(
    () =>
      toolTableStyle(
        columns,
        kind,
        Object.fromEntries(
          Object.entries(labels).map(([key, label]) => [key, t(label)]),
        ),
        Object.values(statusLabels).map((label) => t(label)),
      ),
    [columns, kind, labels, statusLabels, locale, fonts],
  );
}

// The v2 tool table's widths (docs/STYLEGUIDE.md, Part 1, 10.10): the
// translated labels (English keys), every status text of the tool and the
// v2 metrics, measured again after a language change and whenever a face
// loads (useFontsLoaded). Nothing of the rows goes in.
export function useToolColumnStyle(
  columns: readonly string[],
  kind: ToolKind,
  labels: Record<string, string>,
  buttons: ToolButtons,
): Record<string, string> {
  const { locale } = useI18n();
  const fonts = useFontsLoaded();
  const { info, actions, infoPhone, actionsPhone } = buttons;
  return useMemo(
    () =>
      toolColumnStyle(
        columns,
        kind,
        Object.fromEntries(
          Object.entries(labels).map(([key, label]) => [key, t(label)]),
        ),
        toolStatusTexts(kind, t),
        { info, actions, infoPhone, actionsPhone },
        domToolMetrics(),
      ),
    [
      columns.join(),
      kind,
      JSON.stringify(labels),
      info,
      actions,
      infoPhone,
      actionsPhone,
      locale,
      fonts,
    ],
  );
}
