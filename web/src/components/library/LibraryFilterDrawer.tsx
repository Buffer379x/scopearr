import type { JSX } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { useMatchCount } from "../../hooks/useMatchCount";
import { t, useI18n } from "../../i18n";
import {
  ATTRIBUTE_FIELDS,
  fieldOperator,
  fieldValues,
  filterLabel,
  filterOptions,
  rangeInput,
  stateChoice,
  stateFieldsFor,
  trackCombos,
  withFieldOperator,
  withFieldValues,
  withRangeInput,
  withStateChoice,
  withTrackCombos,
  type FilterOption,
  type OptionContext,
  type StateFieldSpec,
  type TrackCombo,
} from "../../library-filters";
import type { Service } from "../../types";
import {
  compoundFields,
  CustomTagNames,
  HiddenTags,
  labels,
  SDListGrouping,
  TagLabels,
} from "../../ui";
import { FilterDrawer } from "../list/FilterDrawer";
import { HelpTip } from "../list/HelpTip";
import {
  FilterField,
  RangeField,
  StateField,
  TrackComboField,
} from "./FilterFields";

const EMPTY: TrackCombo = { language: "", codec: "", channels: "" };
// The rows on screen: one row of Any without a combination.
const shownRows = (combos: TrackCombo[]) => (combos.length ? combos : [EMPTY]);
// The search and the instance apply at once outside the drawer (the
// filter bar, the instance segment), so Reset keeps them.
const OUTSIDE = ["q", "instance"];
const outside = (query: string) =>
  new URLSearchParams(
    [...new URLSearchParams(query)].filter(([key]) => OUTSIDE.includes(key)),
  ).toString();
// The facets of a track's parts: languages, audio codecs, channels.
const COMBO_FACETS = {
  language: "language",
  codec: "audio",
  channels: "channels",
} as const;

// The library's filter drawer (E6; docs/STYLEGUIDE.md, Part 1, 10.5), a
// chunk of its own (drawer-chunk.ts). It edits a draft of the service's
// filters: Apply hands the draft over once (the page replaces its filters
// in one step, on page 1) and closes; closing discards it; Reset clears
// the draft. The live count follows the draft. Facets (null while they
// load, ruling P11/M15) give the values and the track parts.
export default function LibraryFilterDrawer({
  service,
  title,
  query,
  facets,
  mediaInfoEnabled,
  apply,
  close,
}: {
  service: Service;
  title: string;
  query: string;
  facets: Record<string, string[]> | null;
  mediaInfoEnabled: boolean;
  apply(query: string): void;
  close(): void;
}): JSX.Element {
  const { locale } = useI18n();
  const ctx: OptionContext = {
    locale,
    translate: t,
    customNames: useContext(CustomTagNames),
    tagLabels: useContext(TagLabels),
    groupSD: useContext(SDListGrouping),
    hidden: useContext(HiddenTags),
  };
  const [draft, setDraft] = useState(query);
  const [rows, setRows] = useState(() => shownRows(trackCombos(query)));
  // Back or Forward inside the library while the drawer is open brings
  // other filters: the drawer stays open, as dialogs do on a history step,
  // and its draft starts again from them, as the 1.7.0 panel showed them,
  // so Apply never writes back the filters the step left.
  const seeded = useRef(query);
  useEffect(() => {
    if (seeded.current === query) return;
    seeded.current = query;
    setDraft(query);
    setRows(shownRows(trackCombos(query)));
  }, [query]);
  const match = useMatchCount(service, draft);
  const edit = (change: (draft: string) => string) => setDraft(change);
  const setCombos = (combos: TrackCombo[]) => {
    setRows(shownRows(combos));
    edit((current) => withTrackCombos(current, combos));
  };
  // A part's options: the facet's values, then a value of the rows that
  // is not among them (a deep link, a hidden value), so its select shows it.
  const comboOptions = (part: keyof typeof COMBO_FACETS): FilterOption[] => {
    const field = COMBO_FACETS[part];
    const listed = facets
      ? filterOptions(field, facets[field] ?? [], [], ctx)
      : [];
    const own = rows
      .map((row) => row[part])
      .filter(
        (value, at, all) =>
          value &&
          all.indexOf(value) === at &&
          !listed.some((option) => option.value === value),
      );
    return [
      ...listed,
      ...own.map((value) => ({ value, label: filterLabel(field, value, ctx) })),
    ];
  };
  // The fields shown follow the applied filters, so none comes or goes
  // while the draft changes (MediaInfo read: enabled or set).
  const states = stateFieldsFor(service, query, mediaInfoEnabled);
  const state = (spec: StateFieldSpec) => (
    <StateField
      key={spec.name}
      spec={spec}
      choice={stateChoice(draft, spec)}
      change={(choice) =>
        edit((current) => withStateChoice(current, spec, choice))
      }
    />
  );
  const range = (kind: "year" | "size", label: string) => (
    <RangeField
      kind={kind}
      label={t(label)}
      min={rangeInput(draft, kind, "min")}
      max={rangeInput(draft, kind, "max")}
      change={(end, input) =>
        edit((current) => withRangeInput(current, kind, end, input))
      }
    />
  );
  return (
    <FilterDrawer
      title={t("Filters")}
      subtitle={title}
      count={match.count}
      stale={match.stale}
      apply={() => {
        apply(draft);
        close();
      }}
      reset={() => {
        setDraft(outside(draft));
        setRows([EMPTY]);
      }}
      close={close}
    >
      <section class="v2-drawer-sec" aria-labelledby="v2-drawer-media">
        <div class="v2-drawer-h">
          <h3 id="v2-drawer-media">{t("Media attributes")}</h3>
          <HelpTip
            label="Filter logic"
            text="Different fields use AND. For audio, HDR and language, the operator decides whether some or all selected values are required. “Does not contain all” means at least one is missing from the known metadata, which does not prove its absence in the file. “Unknown” also finds partially unknown audio tracks."
          />
        </div>
        {ATTRIBUTE_FIELDS.map((field) => {
          const selected = fieldValues(draft, field);
          return (
            <FilterField
              key={field}
              field={field}
              label={labels[field]}
              options={
                facets
                  ? filterOptions(field, facets[field] ?? [], selected, ctx)
                  : []
              }
              loading={!facets}
              selected={selected}
              operator={fieldOperator(draft, field)}
              compound={compoundFields.includes(field)}
              labelOf={(value) => filterLabel(field, value, ctx)}
              change={(values) =>
                edit((current) => withFieldValues(current, field, values))
              }
              operatorChange={(op) =>
                edit((current) => withFieldOperator(current, field, op))
              }
            />
          );
        })}
        {range("year", "Year")}
        {range("size", "File size (GB)")}
      </section>
      <section
        class="v2-drawer-sec"
        aria-labelledby="v2-drawer-tracks"
        aria-describedby="v2-ff-track-hint"
      >
        <div class="v2-drawer-h">
          <h3 id="v2-drawer-tracks">{t("Audio track combination")}</h3>
        </div>
        <TrackComboField
          combos={rows}
          operator={fieldOperator(draft, "track")}
          options={{
            language: comboOptions("language"),
            codec: comboOptions("codec"),
            channels: comboOptions("channels"),
          }}
          change={setCombos}
          operatorChange={(op) =>
            edit((current) => withFieldOperator(current, "track", op))
          }
        />
      </section>
      <section class="v2-drawer-sec" aria-labelledby="v2-drawer-state">
        <div class="v2-drawer-h">
          <h3 id="v2-drawer-state">{t("Status and metadata quality")}</h3>
        </div>
        {states.filter((spec) => spec.group === "quality").map(state)}
        <div class="v2-drawer-h">
          <h4 id="v2-drawer-match">{t("Media server matching")}</h4>
        </div>
        {states.filter((spec) => spec.group === "matching").map(state)}
      </section>
    </FilterDrawer>
  );
}
