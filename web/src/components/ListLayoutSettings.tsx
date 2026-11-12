import { ICON } from "../ui";
import {
  Scissors,
  Link2,
  Play,
  Film,
  TriangleAlert,
  OctagonAlert,
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import type { Settings } from "../types";
import { t, useI18n } from "../i18n";
import { ColumnOrderEditor } from "./settings/ColumnOrderEditor";
export const infoLabels: Record<string, string> = {
  link: "Show link to Radarr / Sonarr entry",
  media: "Show link to media server entry",
  details: "Show file details",
  metadata: "Show metadata disagreement warning",
  recognition: "Show recognition conflict warning",
  mux: "Show mux marking",
};
// The Icons list of Display → Lists & columns: its column editor, the
// children beside the preview.
export function ListLayoutSettings({
  settings,
  changed,
  children,
}: {
  settings: Settings;
  changed: (next: Settings) => void;
  children?: ComponentChildren;
}) {
  useI18n();
  return (
    <ColumnOrderEditor
      list={t("Info")}
      order={settings.listInfoOrder}
      visible={settings.listInfoVisible}
      labels={Object.fromEntries(
        Object.entries(infoLabels).map(([k, v]) => [k, t(v)]),
      )}
      icons={{
        mux: <Scissors size={ICON.button} />,
        link: <Link2 size={ICON.button} />,
        media: <Play size={ICON.button} />,
        details: <Film size={ICON.button} />,
        metadata: <TriangleAlert size={ICON.button} />,
        recognition: <OctagonAlert size={ICON.button} />,
      }}
      change={(order, visible) =>
        changed({
          ...settings,
          listInfoOrder: order,
          listInfoVisible: visible,
        })
      }
    >
      {children}
    </ColumnOrderEditor>
  );
}
