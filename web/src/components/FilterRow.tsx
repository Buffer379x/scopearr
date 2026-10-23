import { Bookmark, ChevronDown, Search, Trash2 } from "lucide-preact";
import { ICON } from "../ui";
import { t } from "../i18n";
import type { Preset } from "../types";
export function FilterRow<P extends Pick<Preset, "id" | "name">>({
  allLabel,
  label,
  placeholder,
  value,
  change,
  collapsed,
  setCollapsed,
  controls,
  presets,
  selectedPreset,
  applyPreset,
  reset,
  savePreset,
  deletePreset,
}: {
  allLabel?: string;
  label: string;
  placeholder: string;
  value: string;
  change: (value: string) => void;
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  controls: string;
  presets: P[];
  selectedPreset?: P;
  applyPreset: (preset: P) => void;
  reset: () => void;
  savePreset: () => void;
  deletePreset: () => unknown;
}) {
  return (
    <div class="filter-always-visible">
      <label class="search-field">
        <span>{label}</span>
        <div class="input-wrap">
          <Search size={ICON.button} />
          <input
            placeholder={placeholder}
            value={value}
            onInput={(e) => change(e.currentTarget.value)}
          />
        </div>
      </label>
      <div class="preset-toolbar">
        <select
          aria-label={t("Filter preset")}
          value={selectedPreset ? String(selectedPreset.id) : "all"}
          disabled={!presets.length}
          onChange={(e) => {
            const preset = presets.find(
              (p) => String(p.id) === e.currentTarget.value,
            );
            if (preset) applyPreset(preset);
            else reset();
          }}
        >
          <option value="all">{allLabel || t("All files")}</option>
          {presets.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div class="filter-icon-tools">
        <button
          type="button"
          class="icon-button"
          aria-label={t("Save preset")}
          title={t("Save filters as a permanent preset")}
          onClick={savePreset}
        >
          <Bookmark size={ICON.button} />
        </button>
        <button
          type="button"
          class="icon-button danger-button"
          aria-label={t("Delete selected preset")}
          title={t("Delete selected preset")}
          disabled={!selectedPreset}
          onClick={deletePreset}
        >
          <Trash2 size={ICON.button} />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label={t(collapsed ? "Expand filters" : "Collapse filters")}
          title={t(collapsed ? "Expand filters" : "Collapse filters")}
          aria-expanded={!collapsed}
          aria-controls={controls}
          onClick={() => setCollapsed(!collapsed)}
        >
          <ChevronDown size={ICON.button} class={collapsed ? "" : "rotated"} />
        </button>
      </div>
    </div>
  );
}
