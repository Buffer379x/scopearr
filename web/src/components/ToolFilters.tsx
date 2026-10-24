import { ICON } from "../ui";
import type { ComponentChildren } from "preact";
import { RotateCcw, X } from "lucide-preact";
import { t, useI18n } from "../i18n";
import type { FilterOption, FilterChip } from "../tool-filters";

export function FilterCheckList({
  title,
  options,
  selected,
  toggle,
  disabled = false,
}: {
  title: string;
  options: FilterOption[];
  selected: string[];
  toggle: (value: string, checked: boolean) => void;
  disabled?: boolean;
}) {
  const { locale } = useI18n();
  return (
    <div class="tool-filter-list">
      <h3>{title}</h3>
      <div class="placement-options">
        {options.map((option) => {
          const unavailable =
            disabled ||
            (option.count === 0 && !selected.includes(option.value));
          return (
            <label
              class="check-field"
              key={option.value}
              aria-disabled={unavailable}
            >
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                disabled={unavailable}
                onChange={(e) => toggle(option.value, e.currentTarget.checked)}
              />
              <span>{option.label}</span>
              {option.count !== undefined && (
                <span class="filter-count">
                  {option.count.toLocaleString(locale)}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
export function ActiveFilterBar({
  chips,
  reset,
  tools,
  help,
  active,
  hasFilters,
}: {
  chips: FilterChip[];
  reset: () => void;
  tools?: ComponentChildren;
  help?: ComponentChildren;
  active?: ComponentChildren;
  hasFilters?: boolean;
}) {
  useI18n();
  return (
    <div class="filter-footer">
      {active || (
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
      )}
      <div class="filter-footer-tools">
        {(hasFilters ?? !!chips.length) && (
          <button
            class="icon-button"
            title={t("Reset filters")}
            aria-label={t("Reset filters")}
            onClick={reset}
          >
            <RotateCcw size={ICON.button} />
          </button>
        )}
        {tools}
        {help}
      </div>
    </div>
  );
}
