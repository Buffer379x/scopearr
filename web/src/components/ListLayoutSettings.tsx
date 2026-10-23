import { ICON, CardHeading } from "../ui";
import { confirmReset } from "../confirmation";
import {
  RotateCcw,
  Link2,
  Play,
  FileVideo2,
  TriangleAlert,
  OctagonAlert,
} from "lucide-preact";
import type { Settings } from "../types";
import { t, useI18n } from "../i18n";
import { OrderedList } from "./OrderedList";
const labels: Record<string, string> = {
  link: "Show link to Radarr / Sonarr entry",
  media: "Show link to media server entry",
  details: "Show file details",
  metadata: "Show metadata disagreement warning",
  recognition: "Show recognition conflict warning",
};
export function ListLayoutSettings({
  settings,
  changed,
}: {
  settings: Settings;
  changed: (next: Settings) => void;
}) {
  useI18n();
  return (
    <section class="connection list-layout-settings">
      <CardHeading
        title={t("List display icons")}
        description={t(
          "Choose the icons in the Info column. Move them with the arrows to set their left-to-right order in both libraries. Warnings appear only for affected files.",
        )}
        actions={
          <button
            type="button"
            class="icon-button"
            aria-label={t("Restore defaults")}
            title={t("Restore defaults")}
            onClick={async () => {
              if (await confirmReset(t("Restore defaults?")))
                changed({
                  ...settings,
                  listInfoOrder: Object.keys(labels),
                  listInfoVisible: Object.keys(labels),
                });
            }}
          >
            <RotateCcw size={ICON.button} />
          </button>
        }
      />
      <OrderedList
        order={settings.listInfoOrder}
        visible={settings.listInfoVisible}
        labels={Object.fromEntries(
          Object.entries(labels).map(([k, v]) => [k, t(v)]),
        )}
        icons={{
          link: <Link2 size={ICON.button} />,
          media: <Play size={ICON.button} />,
          details: <FileVideo2 size={ICON.button} />,
          metadata: <TriangleAlert size={ICON.button} />,
          recognition: <OctagonAlert size={ICON.button} />,
        }}
        ariaPrefix={t("Info")}
        change={(order, visible) =>
          changed({
            ...settings,
            listInfoOrder: order,
            listInfoVisible: visible,
          })
        }
      />
    </section>
  );
}
