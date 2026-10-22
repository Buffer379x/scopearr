import { presentedTagLabel } from "../tag-labels";
import {
  Bookmark,
  ChevronDown,
  CircleHelp,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-preact";
import { useContext, useId, useState } from "preact/hooks";
import { getLocale, t, useI18n } from "../i18n";
import { audioLanguageLabel } from "../languages";
import type { Preset, Service } from "../types";

import {
  mediaStateFilters,
  mediaStateHelp,
  seasonLanguageHelp,
  seasonTechnicalHelp,
} from "../media-filters";
import {
  TagLabels,
  embyMatchLabels,
  FilterOperator,
  FilterUpdate,
  labels,
  operatorLabels,
} from "../ui";
import { MultiFilter } from "./MultiFilter";
import { StateFilter } from "./StateFilter";
type Props = {
  instances?: { id: string; name: string }[];
  q: URLSearchParams;
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  active: [string, string][];
  service: Service;
  facets: Record<string, string[]>;
  presets: Preset[];
  selectedPreset: Preset | undefined;
  applyPreset: (preset: Preset) => void;
  reset: () => void;
  setSavePreset: (value: boolean) => void;
  deletePreset: () => Promise<void>;
  change: (key: string, values: FilterUpdate) => void;
};
export function FilterPanel({
  q,
  instances = [],
  collapsed,
  setCollapsed,
  active,
  service,
  facets,
  presets,
  selectedPreset,
  applyPreset,
  reset,
  setSavePreset,
  deletePreset,
  change,
}: Props) {
  useI18n();
  const tagLabels = useContext(TagLabels);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  return (
    <section
      class={"filter-panel filter-panel-v2" + (collapsed ? " collapsed" : "")}
      aria-label={t("Filters")}
    >
      <div class="filter-always-visible">
        <label class="search-field">
          <span>{t("Title or filename")}</span>
          <div class="input-wrap">
            <Search size={17} />
            <input
              placeholder={
                service === "radarr"
                  ? t("Search movie or file …")
                  : t("Series, episode or file …")
              }
              value={q.get("q") || ""}
              onInput={(e) =>
                change(
                  "q",
                  e.currentTarget.value ? [e.currentTarget.value] : [],
                )
              }
            />
          </div>
        </label>
        <div class="preset-toolbar">
          <select
            aria-label={t("Filter preset")}
            value={selectedPreset ? String(selectedPreset.id) : "all"}
            disabled={!presets.some((p) => p.service === service)}
            onChange={(e) => {
              const preset = presets.find(
                (p) => String(p.id) === e.currentTarget.value,
              );
              if (preset) applyPreset(preset);
              else if (e.currentTarget.value === "all") reset();
            }}
          >
            <option value="all">{t("All files")}</option>
            {presets
              .filter((p) => p.service === service)
              .map((p) => (
                <option value={String(p.id)}>{p.name}</option>
              ))}
          </select>
        </div>
        <div class="filter-icon-tools">
          <button
            class="icon-button"
            aria-label={t("Save preset")}
            title={t("Save filters as a permanent preset")}
            onClick={() => setSavePreset(true)}
          >
            <Bookmark size={16} />
          </button>
          <button
            class="icon-button danger-button"
            aria-label={t("Delete selected preset")}
            title={t("Delete selected preset")}
            disabled={!selectedPreset}
            onClick={deletePreset}
          >
            <Trash2 size={16} />
          </button>
          <button
            class="icon-button"
            aria-label={collapsed ? t("Expand filters") : t("Collapse filters")}
            title={collapsed ? t("Expand filters") : t("Collapse filters")}
            aria-expanded={!collapsed}
            aria-controls="filter-controls"
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronDown size={17} class={!collapsed ? "rotated" : ""} />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div id="filter-controls" class="filter-groups">
          <section class="attribute-filters">
            <div class="state-filter-heading">
              <h2>{t("Media attributes")}</h2>
              <div
                class={"filter-logic-help" + (helpOpen ? " open" : "")}
                onMouseEnter={() => setHelpOpen(true)}
                onMouseLeave={() => setHelpOpen(false)}
              >
                <button
                  type="button"
                  class="icon-button"
                  aria-label={t("Filter logic")}
                  onFocus={() => setHelpOpen(true)}
                  aria-describedby={helpId}
                  aria-expanded={helpOpen}
                  onClick={() => setHelpOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setHelpOpen(false);
                  }}
                  onBlur={() => setHelpOpen(false)}
                >
                  <CircleHelp size={17} />
                </button>
                <p id={helpId} role="tooltip" class="filter-logic-tooltip">
                  {t(
                    "Different fields use AND. For audio, HDR and language, the operator decides whether some or all selected values are required. “Does not contain all” means at least one is missing from the known metadata, which does not prove its absence in the file. “Unknown” also finds partially unknown audio tracks.",
                  )}
                </p>
              </div>
            </div>
            <div class="attribute-grid">
              {[
                "resolution",
                "codec",
                "source",
                "processing",
                "family",
                "bitDepth",
                "hdr",
                "audio",
                "language",
                "channels",
                "custom",
              ].map((k) => (
                <MultiFilter
                  key={k}
                  name={k}
                  values={facets[k] || []}
                  selected={q.getAll(k)}
                  operator={(q.get(k + "Op") || "eq") as FilterOperator}
                  operatorChange={(op) =>
                    change(k + "Op", op === "eq" ? [] : [op])
                  }
                  change={(v) => change(k, v)}
                />
              ))}
              <label class="range-field">
                <span>{t("Year")}</span>
                <div class="year-inputs">
                  {["yearMin", "yearMax"].map((k, index) => (
                    <>
                      <input
                        type="number"
                        min="1800"
                        max="3000"
                        placeholder={index ? t("To") : t("From")}
                        aria-label={index ? t("Year to") : t("Year from")}
                        value={q.get(k) || ""}
                        onInput={(e) =>
                          change(
                            k,
                            e.currentTarget.value
                              ? [e.currentTarget.value]
                              : [],
                          )
                        }
                      />
                      {!index && <span>–</span>}
                    </>
                  ))}
                </div>
              </label>
              <label class="range-field">
                <span>{t("File size (GB)")}</span>
                <div class="year-inputs">
                  {["sizeMin", "sizeMax"].map((k, index) => (
                    <>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        placeholder={index ? t("To") : t("From")}
                        aria-label={
                          index
                            ? t("File size to (GB)")
                            : t("File size from (GB)")
                        }
                        value={q.has(k) ? Number(q.get(k)) / 1e9 : ""}
                        onInput={(e) =>
                          change(
                            k,
                            e.currentTarget.value
                              ? [
                                  String(
                                    Math.round(
                                      Number(e.currentTarget.value) * 1e9,
                                    ),
                                  ),
                                ]
                              : [],
                          )
                        }
                      />
                      {!index && <span>–</span>}
                    </>
                  ))}
                </div>
              </label>
            </div>
          </section>
          <section class="state-filters">
            <h2>{t("Status and metadata quality")}</h2>
            <StateFilter
              name="conflict"
              label="Metadata disagreement"
              help="Filename recognition and service metadata disagree on a known value. Excluding this finds files without that disagreement."
              value={q.get("conflict") || ""}
              positive="true"
              negative="false"
              change={change}
            />
            <StateFilter
              name="ruleConflict"
              label="Conflicting recognition rules"
              help="Multiple matching recognition rules assign incompatible values to the same attribute. Excluding this finds files without a rule conflict."
              value={q.get("ruleConflict") || ""}
              positive="true"
              negative="false"
              change={change}
            />
            <StateFilter
              name="metadata"
              label="Incomplete metadata"
              help="At least one required media attribute is unknown: resolution, codec, source, audio or language. Excluding this selects complete metadata; HDR may be SDR or unknown."
              value={q.get("metadata") || ""}
              positive="incomplete"
              negative="complete"
              change={change}
            />
            {service === "sonarr" && (
              <>
                <StateFilter
                  name="seasonOutlier"
                  label="Technical outliers"
                  value={q.get("seasonOutlier") || ""}
                  positive="true"
                  negative="false"
                  change={change}
                  help={seasonTechnicalHelp}
                />
                <StateFilter
                  name="languageOutlier"
                  label="Language outliers"
                  value={q.get("languageOutlier") || ""}
                  positive="true"
                  negative="false"
                  change={change}
                  help={seasonLanguageHelp}
                />
              </>
            )}
            <section
              class="media-match-filters"
              aria-label={t("Media server matching")}
            >
              <h2>{t("Media server matching")}</h2>
              {Object.entries(mediaStateFilters).map(([key, label]) => (
                <StateFilter
                  key={key}
                  name={key}
                  label={label}
                  help={mediaStateHelp[key]}
                  value={q.get(key) || ""}
                  positive="true"
                  negative="false"
                  change={change}
                />
              ))}
            </section>
          </section>
        </div>
      )}
      <div class="filter-footer">
        <div class="active-filters">
          {active.length ? (
            active
              .filter(
                ([k], i) =>
                  !["all", "notAll"].includes(q.get(k + "Op") || "") ||
                  active.findIndex(([key]) => key === k) === i,
              )
              .map(([k, v]) => (
                <button
                  class={
                    "filter-chip" +
                    (["not", "notAll"].includes(q.get(k + "Op") || "")
                      ? " excluded"
                      : "")
                  }
                  onClick={() =>
                    change(k, (current) =>
                      ["all", "notAll"].includes(q.get(k + "Op") || "")
                        ? []
                        : current.filter((x) => x !== v),
                    )
                  }
                >
                  {labels[k] ||
                    (
                      {
                        q: t("Search"),
                        instance: t("Service"),
                        yearMin: t("From"),
                        yearMax: t("To"),
                        conflict: t("Metadata disagreement"),
                        ruleConflict: t("Conflicting recognition rules"),
                        embyMatch: t("Media server matching"),
                        seasonOutlier: t("Technical outliers"),
                        languageOutlier: t("Language outliers"),
                        ...Object.fromEntries(
                          Object.entries(mediaStateFilters).map(([k, v]) => [
                            k,
                            t(v),
                          ]),
                        ),
                        metadata: t("Metadata status"),
                        sizeMin: t("Bytes from"),
                        sizeMax: t("Bytes to"),
                        unknownYear: t("Unknown year"),
                        unknownSize: t("Unknown size"),
                      } as Record<string, string>
                    )[k] ||
                    k}
                  {["all", "notAll"].includes(q.get(k + "Op") || "")
                    ? " " +
                      operatorLabels[q.get(k + "Op") as FilterOperator] +
                      ": "
                    : q.get(k + "Op") === "not"
                      ? " ≠ "
                      : ": "}
                  {(["all", "notAll"].includes(q.get(k + "Op") || "")
                    ? q.getAll(k)
                    : [v]
                  )
                    .map((value) =>
                      k === "instance"
                        ? instances.find((instance) => instance.id === value)
                            ?.name || value
                        : k === "embyMatch"
                          ? embyMatchLabels[value] || value
                          : [
                                "conflict",
                                "ruleConflict",
                                "seasonOutlier",
                                "languageOutlier",
                                ...Object.keys(mediaStateFilters),
                              ].includes(k)
                            ? t(value === "true" ? "is" : "is not")
                            : value === "__unknown__"
                              ? t("Unknown")
                              : k === "metadata"
                                ? value === "incomplete"
                                  ? t("incomplete")
                                  : t("complete")
                                : k === "language"
                                  ? t(audioLanguageLabel(value, getLocale()))
                                  : presentedTagLabel(k, value, tagLabels),
                    )
                    .join(" + ")}
                  <X size={12} />
                </button>
              ))
          ) : (
            <span class="quiet">{t("No active filters")}</span>
          )}
        </div>
        {active.length > 0 && (
          <button
            class="icon-button"
            onClick={reset}
            aria-label={t("Reset filters")}
            title={t("Reset filters")}
          >
            <RotateCcw size={16} />
          </button>
        )}
      </div>
    </section>
  );
}
