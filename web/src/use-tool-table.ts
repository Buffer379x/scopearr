import { useEffect, useMemo, useState } from "preact/hooks";
import { t, useI18n } from "./i18n";
import { toolTableStyle } from "./tool-table";

// Row-independent measurements follow language changes and the real webfont.
export function useToolTableStyle(
  columns: readonly string[],
  kind: string,
  labels: Record<string, string>,
  statusLabels: Record<string, string>,
) {
  const { locale } = useI18n();
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let active = true;
    if (document.fonts)
      void document.fonts.ready.then(() => {
        if (active) setFontsReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
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
    [columns, kind, labels, statusLabels, locale, fontsReady],
  );
}
