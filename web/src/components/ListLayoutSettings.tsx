import { ICON } from "../ui";
import { confirmReset } from "../confirmation";
import { ArrowDown, ArrowUp, RotateCcw } from "lucide-preact";
import type { Settings } from "../types";
import { t, useI18n } from "../i18n";
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
      <h3 class="card-title">{t("List display icons")}</h3>
      <p class="quiet">
        {t(
          "Choose the icons in the Info column. Move them with the arrows to set their left-to-right order in both libraries. Warnings appear only for affected files.",
        )}
      </p>
      <div class="column-options">
        {settings.listInfoOrder.map((key, index) => (
          <div class="column-option" key={key}>
            <label class="check-field">
              <input
                type="checkbox"
                checked={settings.listInfoVisible.includes(key)}
                onChange={(e) =>
                  changed({
                    ...settings,
                    listInfoVisible: e.currentTarget.checked
                      ? [...settings.listInfoVisible, key]
                      : settings.listInfoVisible.filter(
                          (value) => value !== key,
                        ),
                  })
                }
              />
              {t(labels[key])}
            </label>
            <div class="column-move-tools">
              {([-1, 1] as const).map((direction) => (
                <button
                  type="button"
                  class="icon-button"
                  aria-label={
                    t(labels[key]) +
                    " · " +
                    t(direction === -1 ? "Move up" : "Move down")
                  }
                  title={t(
                    direction === -1 ? "Move column left" : "Move column right",
                  )}
                  disabled={
                    index + direction < 0 ||
                    index + direction >= settings.listInfoOrder.length
                  }
                  onClick={() => {
                    const order = [...settings.listInfoOrder];
                    [order[index], order[index + direction]] = [
                      order[index + direction],
                      order[index],
                    ];
                    changed({ ...settings, listInfoOrder: order });
                  }}
                >
                  {direction === -1 ? (
                    <ArrowUp size={ICON.button} />
                  ) : (
                    <ArrowDown size={ICON.button} />
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        class="icon-button list-layout-reset"
        aria-label={t("Restore defaults")}
        title={t("Restore defaults")}
        onClick={async () => {
          if (await confirmReset(t("Restore defaults?")))
            changed({
              ...settings,
              listInfoOrder: [
                "link",
                "media",
                "details",
                "metadata",
                "recognition",
              ],
              listInfoVisible: [
                "link",
                "media",
                "details",
                "metadata",
                "recognition",
              ],
            });
        }}
      >
        <RotateCcw size={ICON.button} />
      </button>
    </section>
  );
}
