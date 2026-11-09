import { useMemo } from "preact/hooks";
import { useFontsLoaded } from "./hooks/useFontsLoaded";
import { t, useI18n } from "./i18n";
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
