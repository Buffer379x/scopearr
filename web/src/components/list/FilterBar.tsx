import { Bookmark, Search, SlidersHorizontal, Trash2 } from "lucide-preact";
import type { JSX } from "preact";
import { t, useI18n } from "../../i18n";
import { count, ICON } from "../../ui";

// The filter bar in the head of a table card (docs/STYLEGUIDE.md, Part 1,
// 10.5): the search, named by its label; the preset select “Filter preset”,
// which shows the disabled “Custom selection” (last, value "") while the
// filters match no preset (ruling R-I); and the Filters button, which opens
// the drawer from itself. Its count sits in a slot two digits wide, hidden
// from assistive technology: the chips name the filters. Without a preset
// (Phase 5c, the event log) there is no select.
export function FilterBar({
  search,
  preset,
  filters,
}: {
  search: {
    label: string;
    placeholder: string;
    value: string;
    change(value: string): void;
  };
  preset?: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    custom: boolean;
    choose(value: string): void;
    // Save preset and Delete selected preset, icon buttons right beside
    // the select (D32 6.1); delete is locked without a chosen preset.
    save?(): void;
    remove?(): void;
    removeDisabled?: boolean;
  };
  filters: {
    count: number;
    expanded: boolean;
    open(anchor: HTMLElement): void;
  };
}): JSX.Element {
  useI18n();
  return (
    <div class="v2-filter-bar">
      <div class="v2-input-group">
        <Search class="v2-input-icon" size={ICON.button} />
        <input
          class="v2-input"
          aria-label={search.label}
          placeholder={search.placeholder}
          value={search.value}
          onInput={(e) => search.change(e.currentTarget.value)}
        />
      </div>
      {preset && (
        <select
          class="v2-select"
          aria-label={preset.label}
          value={preset.custom ? "" : preset.value}
          onChange={(e) => preset.choose(e.currentTarget.value)}
        >
          {preset.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {preset.custom && (
            <option value="" disabled>
              {t("Custom selection")}
            </option>
          )}
        </select>
      )}
      {preset?.save && (
        <button
          type="button"
          class="v2-icon-btn v2-filter-bar-act"
          aria-label={t("Save preset")}
          title={t("Save filters as a permanent preset")}
          onClick={preset.save}
        >
          <Bookmark size={ICON.button} />
        </button>
      )}
      {preset?.remove && (
        <button
          type="button"
          class="v2-icon-btn v2-filter-bar-act"
          aria-label={t("Delete selected preset")}
          title={t("Delete selected preset")}
          disabled={preset.removeDisabled}
          onClick={preset.remove}
        >
          <Trash2 size={ICON.button} />
        </button>
      )}
      <button
        type="button"
        class="v2-btn"
        aria-haspopup="dialog"
        aria-expanded={filters.expanded}
        onClick={(e) => filters.open(e.currentTarget)}
      >
        <SlidersHorizontal size={ICON.label} />
        {t("Filters")}
        <span
          class={"v2-count" + (filters.count ? " v2-count--on" : "")}
          aria-hidden="true"
        >
          {count(filters.count)}
        </span>
      </button>
    </div>
  );
}
