import { ICON } from "../ui";
import { resolutionFilterValues } from "../resolution-groups";
import { sortFilterValues } from "../filter-values";
import { presentedTagLabel } from "../tag-labels";
import { t, useI18n } from "../i18n";
import { audioLanguageLabel, sameAudioLanguage } from "../languages";
import { OperatorButton } from "./OperatorButton";
import { tagIsDisplayed } from "../tag-display";
import { ChevronDown } from "lucide-preact";
import { useEffect, useRef, useState, useContext } from "preact/hooks";

import {
  TagLabels,
  SDListGrouping,
  CustomTagNames,
  HiddenTags,
  compoundFields,
  FilterOperator,
  FilterUpdate,
  labels,
} from "../ui";
export function MultiFilter({
  name,
  values,
  selected,
  operator,
  operatorChange,
  change,
  counts,
  includeOnly = false,
  heading = false,
}: {
  heading?: boolean;
  counts?: Record<string, number>;
  includeOnly?: boolean;
  name: string;
  values: string[];
  selected: string[];
  operator: FilterOperator;
  operatorChange: (operator: FilterOperator) => void;
  change: (v: FilterUpdate) => void;
}) {
  const { locale } = useI18n();
  const names = useContext(CustomTagNames);
  const tagLabels = useContext(TagLabels);
  const groupSD = useContext(SDListGrouping);
  const hidden = useContext(HiddenTags);
  const labelForValue = (value: string) =>
    value === "__unknown__" || value === ""
      ? t(name === "custom" ? "No custom tags" : "Unknown")
      : name === "language"
        ? t(audioLanguageLabel(value, locale))
        : name === "custom"
          ? names[value] || value
          : presentedTagLabel(name, value, tagLabels);
  values = values.filter((value) => tagIsDisplayed(hidden, name, value));
  if (name === "resolution")
    values = resolutionFilterValues(
      values,
      selected.filter((value) => tagIsDisplayed(hidden, name, value)),
      groupSD,
    );
  values = sortFilterValues(
    values.filter((value) => tagIsDisplayed(hidden, name, value)),
    labelForValue,
    locale,
  );
  const equivalent = (left: string, right: string) =>
    name === "language" ? sameAudioLanguage(left, right) : left === right;
  const negative = operator === "not" || operator === "notAll";
  const compound = compoundFields.includes(name);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dismiss = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, [open]);
  return (
    <div
      class="multi-filter"
      ref={ref}
      onKeyDown={(e) => {
        if (open && e.key === "Escape") {
          e.stopPropagation();
          dismiss();
        }
      }}
      onFocusOut={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <div class="field-label-row">
        {heading ? (
          <h3 id={"label-" + name}>{labels[name]}</h3>
        ) : (
          <span class="field-label" id={"label-" + name}>
            {labels[name]}
          </span>
        )}
      </div>
      <div class="multi-filter-control">
        {!includeOnly && (
          <OperatorButton
            field={labels[name]}
            value={operator}
            compound={compound}
            change={operatorChange}
          />
        )}
        <button
          type="button"
          ref={trigger}
          class={
            "select-button" +
            (selected.length
              ? negative
                ? " selected excluded"
                : " selected"
              : "")
          }
          aria-labelledby={"label-" + name}
          aria-expanded={open}
          aria-controls={"options-" + name}
          onClick={() => setOpen(!open)}
        >
          <span class="select-values">
            {selected.length
              ? (operator === "notAll"
                  ? t("Not all: ")
                  : operator === "all"
                    ? t("All: ")
                    : negative
                      ? t("Not: ")
                      : "") + selected.map(labelForValue).join(", ")
              : negative
                ? t("No exclusions")
                : t("All")}
          </span>
          <ChevronDown size={ICON.label} />
        </button>
      </div>
      {open && (
        <div
          class="select-popover floating-surface"
          id={"options-" + name}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              dismiss();
            }
          }}
        >
          <button class="text-button" onClick={() => change([])}>
            {t("Reset selection")}
          </button>
          {values.length ? (
            values.map((v) => (
              <label>
                <input
                  type="checkbox"
                  checked={selected.some((value) => equivalent(value, v))}
                  onChange={(e) => {
                    const checked = e.currentTarget.checked;
                    change((current) =>
                      checked
                        ? [...current.filter((x) => !equivalent(x, v)), v]
                        : current.filter((x) => !equivalent(x, v)),
                    );
                  }}
                />
                {labelForValue(v)}
                {counts?.[v] !== undefined && (
                  <span class="filter-count">
                    {counts[v].toLocaleString(locale)}
                  </span>
                )}
              </label>
            ))
          ) : (
            <span class="quiet">{t("No values in cache yet")}</span>
          )}
        </div>
      )}
    </div>
  );
}
