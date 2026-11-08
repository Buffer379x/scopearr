import { ChevronDown, Plus, X } from "lucide-preact";
import { Fragment, type JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { t, useI18n } from "../../i18n";
import { sameAudioLanguage } from "../../languages";
import {
  TRACK_COMBO_MAX,
  type AttributeField,
  type FilterOption,
  type RangeKind,
  type StateChoice,
  type StateFieldSpec,
  type TrackCombo,
} from "../../library-filters";
import { ICON, type FilterOperator } from "../../ui";
import { Popover } from "../frame/Popover";
import { HelpTip } from "../list/HelpTip";

// The fields of the library's filter drawer (docs/STYLEGUIDE.md, Part 1,
// 10.4 and 10.5) with the 1.7.0 texts and parameters (FilterPanel,
// MultiFilter, StateFilter, OperatorButton); the drawer holds the draft.

const OPERATORS: FilterOperator[] = ["eq", "not", "all", "notAll"];
const SYMBOLS: Record<FilterOperator, string> = {
  eq: "=",
  not: "≠",
  all: "∧",
  notAll: "¬∧",
};
const SIMPLE: Record<FilterOperator, string> = {
  eq: "is",
  not: "is not",
  all: "contains all",
  notAll: "does not contain all",
};
const COMPOUND: Record<FilterOperator, string> = {
  eq: "contains at least one",
  not: "contains none",
  all: "contains all",
  notAll: "does not contain all",
};
const negative = (op: FilterOperator) => op === "not" || op === "notAll";

// The operator of a field, named "{field}: {operator}" as the 1.7.0 button:
// a simple field toggles between is (=) and is not (≠); a compound one
// opens a Popover menu "{field}: operator" of the four operators, whose
// choice returns focus to the button.
export function OperatorToggle({
  field,
  value,
  compound,
  change,
}: {
  field: string;
  value: FilterOperator;
  compound: boolean;
  change(op: FilterOperator): void;
}): JSX.Element {
  useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const name = t((compound ? COMPOUND : SIMPLE)[value]);
  return (
    <>
      <button
        type="button"
        class={"v2-ff-op" + (negative(value) ? " v2-ff-op--not" : "")}
        aria-label={field + ": " + name}
        title={name}
        aria-haspopup={compound ? "menu" : undefined}
        aria-expanded={compound ? !!anchor : undefined}
        onClick={(event) =>
          compound
            ? setAnchor(anchor ? null : event.currentTarget)
            : change(value === "not" ? "eq" : "not")
        }
      >
        {SYMBOLS[value]}
      </button>
      {anchor && (
        <Popover
          anchor={anchor}
          placement="bottom-end"
          role="menu"
          label={t("{field}: operator", { field })}
          close={() => setAnchor(null)}
        >
          {OPERATORS.map((op) => (
            <button
              key={op}
              type="button"
              role="menuitemradio"
              aria-checked={op === value}
              class="v2-menu-item"
              onClick={() => {
                anchor.focus();
                setAnchor(null);
                change(op);
              }}
            >
              <span class="v2-ff-sym" aria-hidden="true">
                {SYMBOLS[op]}
              </span>
              <span class="v2-menu-text">{t(COMPOUND[op])}</span>
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}

// A media attribute: its label, its operator and a button with the 1.7.0
// summary, which opens and closes the field's values in place (a fieldset
// of v2-check boxes after "Reset selection"). One language's names count
// as one value, as in 1.7.0. While the facets load, placeholders stand in
// for the values.
export function FilterField({
  field,
  label,
  options,
  selected,
  operator,
  compound,
  labelOf,
  loading = false,
  change,
  operatorChange,
}: {
  field: AttributeField;
  label: string;
  options: FilterOption[];
  selected: string[];
  operator: FilterOperator;
  compound: boolean;
  labelOf(value: string): string;
  loading?: boolean;
  change(values: string[]): void;
  operatorChange(op: FilterOperator): void;
}): JSX.Element {
  useI18n();
  const [open, setOpen] = useState(false);
  const id = "v2-ff-" + field;
  const same = (left: string, right: string) =>
    field === "language" ? sameAudioLanguage(left, right) : left === right;
  const excluding = negative(operator);
  const summary = selected.length
    ? (operator === "notAll"
        ? t("Not all: ")
        : operator === "all"
          ? t("All: ")
          : excluding
            ? t("Not: ")
            : "") + selected.map(labelOf).join(", ")
    : t(excluding ? "No exclusions" : "All");
  return (
    <div class="v2-ff">
      <span class="v2-ff-label" id={id}>
        {label}
      </span>
      <OperatorToggle
        field={label}
        value={operator}
        compound={compound}
        change={operatorChange}
      />
      <button
        type="button"
        class={
          "v2-ff-value" +
          (selected.length
            ? " v2-ff-value--on" + (excluding ? " v2-ff-value--not" : "")
            : "")
        }
        aria-labelledby={id}
        aria-describedby={id + "-sum"}
        aria-expanded={open}
        aria-controls={id + "-list"}
        onClick={() => setOpen(!open)}
      >
        <span class="v2-ff-sum" id={id + "-sum"}>
          {summary}
        </span>
        <ChevronDown size={ICON.label} />
      </button>
      {open && (
        <fieldset
          class="v2-ff-list"
          id={id + "-list"}
          aria-labelledby={id}
          aria-busy={loading ? "true" : undefined}
        >
          <button type="button" class="v2-text-btn" onClick={() => change([])}>
            {t("Reset selection")}
          </button>
          {loading ? (
            [0, 1, 2].map((n) => (
              <span key={n} class="v2-ff-ph" aria-hidden="true" />
            ))
          ) : options.length ? (
            options.map((option) => (
              <label key={option.value} class="v2-ff-opt">
                <input
                  type="checkbox"
                  class="v2-check"
                  checked={selected.some((value) => same(value, option.value))}
                  onChange={(event) => {
                    const others = selected.filter(
                      (value) => !same(value, option.value),
                    );
                    change(
                      event.currentTarget.checked
                        ? [...others, option.value]
                        : others,
                    );
                  }}
                />
                {option.label}
              </label>
            ))
          ) : (
            <span class="v2-ff-empty">{t("No values in cache yet")}</span>
          )}
        </fieldset>
      )}
    </div>
  );
}

// Year (1800–3000) and file size in gigabytes, from and to, with the 1.7.0
// names and placeholders; the drawer converts gigabytes to bytes.
const RANGES = {
  year: { from: "Year from", to: "Year to", min: "1800", max: "3000" },
  size: { from: "File size from (GB)", to: "File size to (GB)", min: "0" },
} as const;
export function RangeField({
  kind,
  label,
  min,
  max,
  change,
}: {
  kind: RangeKind;
  label: string;
  min: string;
  max: string;
  change(end: "min" | "max", input: string): void;
}): JSX.Element {
  useI18n();
  const range = RANGES[kind];
  const input = (end: "min" | "max") => (
    <input
      class="v2-input"
      type="number"
      min={range.min}
      max={kind === "year" ? RANGES.year.max : undefined}
      step={kind === "size" ? "0.1" : undefined}
      placeholder={t(end === "min" ? "From" : "To")}
      aria-label={t(end === "min" ? range.from : range.to)}
      value={end === "min" ? min : max}
      onInput={(event) => change(end, event.currentTarget.value)}
    />
  );
  return (
    <div class="v2-ff">
      <span class="v2-ff-label">{label}</span>
      <div class="v2-ff-range">
        {input("min")}
        <span aria-hidden="true">–</span>
        {input("max")}
      </div>
    </div>
  );
}

// A state or data quality filter: its box with its label, its help and its
// operator (is / is not). The operator of an unchecked filter is prepared
// and kept, and applies once it is checked (1.7.0 StateFilter).
export function StateField({
  spec,
  choice,
  change,
}: {
  spec: StateFieldSpec;
  choice: StateChoice;
  change(choice: StateChoice): void;
}): JSX.Element {
  useI18n();
  const [exclude, setExclude] = useState(choice.exclude);
  useEffect(() => {
    if (choice.active) setExclude(choice.exclude);
  }, [choice.active, choice.exclude]);
  return (
    <div class="v2-ff v2-ff--state">
      <label class="v2-ff-check">
        <input
          type="checkbox"
          class="v2-check"
          checked={choice.active}
          onChange={(event) =>
            change({ active: event.currentTarget.checked, exclude })
          }
        />
        {t(spec.label)}
      </label>
      <HelpTip label={spec.label} text={spec.help} />
      <OperatorToggle
        field={t(spec.label)}
        value={exclude ? "not" : "eq"}
        compound={false}
        change={(op) => {
          setExclude(op === "not");
          if (choice.active) change({ active: true, exclude: op === "not" });
        }}
      />
    </div>
  );
}

// Audio track combinations (F2b): per row a language, a codec and channels
// of the same track, each "Any" or a value, and Remove; Add up to 16; the
// operator of a compound field over all rows; the hint below. Removing the
// last row leaves a row of Any. Add focuses the new row, Remove the Remove
// now in its place (else the one before it), so focus stays in the rows.
const EMPTY: TrackCombo = { language: "", codec: "", channels: "" };
const PARTS = [
  ["language", "Language", "language"],
  ["codec", "Audio codec", "codec"],
  ["channels", "Channels", "channels"],
] as const;
export function TrackComboField({
  combos,
  operator,
  options,
  change,
  operatorChange,
}: {
  combos: TrackCombo[];
  operator: FilterOperator;
  options: Record<"language" | "codec" | "channels", FilterOption[]>;
  change(combos: TrackCombo[]): void;
  operatorChange(op: FilterOperator): void;
}): JSX.Element {
  useI18n();
  const grid = useRef<HTMLDivElement>(null);
  // The focus to move once the rows changed: a select or a Remove button.
  const moved = useRef<["select" | ".v2-icon-btn", number] | null>(null);
  useEffect(() => {
    const target = moved.current,
      box = grid.current;
    if (!target || !box) return;
    moved.current = null;
    const list = box.querySelectorAll<HTMLElement>(target[0]);
    list[Math.min(target[1], list.length - 1)]?.focus();
  });
  return (
    <div ref={grid} class="v2-ff-combo">
      {PARTS.map(([, name]) => (
        <span key={name} class="v2-ff-label" aria-hidden="true">
          {t(name)}
        </span>
      ))}
      <OperatorToggle
        field={t("Audio track combination")}
        value={operator}
        compound
        change={operatorChange}
      />
      {combos.map((combo, row) => (
        <Fragment key={row}>
          {PARTS.map(([part, name, list]) => (
            <select
              key={part}
              class="v2-select"
              aria-label={t(name)}
              value={combo[part]}
              onChange={(event) =>
                change(
                  combos.map((other, at) =>
                    at === row
                      ? { ...other, [part]: event.currentTarget.value }
                      : other,
                  ),
                )
              }
            >
              <option value="">{t("Any")}</option>
              {options[list].map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ))}
          <button
            type="button"
            class="v2-icon-btn v2-icon-btn--sm"
            aria-label={t("Remove combination")}
            title={t("Remove combination")}
            onClick={() => {
              const rest = combos.filter((_, at) => at !== row);
              moved.current = [".v2-icon-btn", row];
              change(rest.length ? rest : [EMPTY]);
            }}
          >
            <X size={ICON.label} />
          </button>
        </Fragment>
      ))}
      <button
        type="button"
        class="v2-btn v2-btn--sm"
        disabled={combos.length >= TRACK_COMBO_MAX}
        onClick={() => {
          moved.current = ["select", combos.length * PARTS.length];
          change([...combos, EMPTY]);
        }}
      >
        <Plus size={ICON.label} />
        {t("Add combination")}
      </button>
      <p class="v2-ff-hint" id="v2-ff-track-hint">
        {t(
          "Language, codec and channels must match within the same track. Files without measured tracks never match.",
        )}
      </p>
    </div>
  );
}
