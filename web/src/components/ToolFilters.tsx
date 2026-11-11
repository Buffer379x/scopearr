import { ICON } from "../ui";
import { RotateCcw, X } from "lucide-preact";
import { t, useI18n } from "../i18n";
import type { FilterChip } from "../tool-filters";

export function ActiveFilterBar({
  chips,
  reset,
}: {
  chips: FilterChip[];
  reset: () => void;
}) {
  useI18n();
  return (
    <div class="filter-footer">
      <div class="active-filters">
        {chips.length ? (
          chips.map((chip) => (
            <button class="filter-chip" key={chip.key} onClick={chip.remove}>
              {chip.label}
              <X size={ICON.chip} />
            </button>
          ))
        ) : (
          <span class="quiet">{t("No active filters")}</span>
        )}
      </div>
      <div class="filter-footer-tools">
        {!!chips.length && (
          <button
            class="icon-button"
            title={t("Reset filters")}
            aria-label={t("Reset filters")}
            onClick={reset}
          >
            <RotateCcw size={ICON.button} />
          </button>
        )}
      </div>
    </div>
  );
}
