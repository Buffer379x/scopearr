// The library's filters as pure functions over a query string (Route.filters,
// docs/STYLEGUIDE.md, Part 1, 10.5). They write and name the parameters as
// the 1.7.0 filter panel did (FilterPanel, MultiFilter, StateFilter); the
// drawer, the chips row and the track menu build on them.
import { audioLanguageLabel } from "./languages.ts";
import {
  mediaStateFilters,
  mediaStateHelp,
  seasonLanguageHelp,
  seasonTechnicalHelp,
} from "./media-filters.ts";
import { resolutionFilterValues } from "./resolution-groups.ts";
import { sortFilterValues } from "./filter-values.ts";
import { presentedTagLabel } from "./tag-labels.ts";
import { tagIsDisplayed } from "./tag-display.ts";
import type { Service } from "./types";
import type { FilterOperator } from "./ui";

const OPERATORS: readonly string[] = ["eq", "not", "all", "notAll"];

// The 11 media attributes in the order of the 1.7.0 panel.
export const ATTRIBUTE_FIELDS = [
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
] as const;
export type AttributeField = (typeof ATTRIBUTE_FIELDS)[number];

const edit = (query: string, change: (params: URLSearchParams) => void) => {
  const params = new URLSearchParams(query);
  change(params);
  return params.toString();
};

export function fieldValues(query: string, field: string): string[] {
  return new URLSearchParams(query).getAll(field);
}
// Replaces the values of a field; they move to the end, as 1.7.0's change()
// wrote them. The operator stays, even for no values.
export function withFieldValues(
  query: string,
  field: string,
  values: readonly string[],
): string {
  return edit(query, (params) => {
    params.delete(field);
    for (const value of values) params.append(field, value);
  });
}
export function fieldOperator(query: string, field: string): FilterOperator {
  const op = new URLSearchParams(query).get(field + "Op") || "";
  return OPERATORS.includes(op) ? (op as FilterOperator) : "eq";
}
// eq is the default and removes <field>Op.
export function withFieldOperator(
  query: string,
  field: string,
  op: FilterOperator,
): string {
  return edit(query, (params) => {
    params.delete(field + "Op");
    if (op !== "eq") params.append(field + "Op", op);
  });
}

// State and data quality filters: one parameter with a positive and a
// negative value; an inactive filter has no parameter.
export type StateFieldSpec = {
  name: string;
  label: string;
  help: string;
  positive: string;
  negative: string;
  group: "quality" | "matching";
  series?: true;
  mediaInfo?: true;
};
const quality = (
  name: string,
  label: string,
  help: string,
  extra: Partial<StateFieldSpec> = {},
): StateFieldSpec => ({
  name,
  label,
  help,
  positive: "true",
  negative: "false",
  group: "quality",
  ...extra,
});
export const STATE_FIELDS: readonly StateFieldSpec[] = [
  quality(
    "conflict",
    "Metadata disagreement",
    "The filename and the media server's measured metadata disagree on a known value. Radarr/Sonarr differences are shown in file details only. Excluding this finds files without that disagreement.",
  ),
  quality(
    "ruleConflict",
    "Conflicting recognition rules",
    "Multiple matching recognition rules assign incompatible values to the same attribute. Excluding this finds files without a rule conflict.",
  ),
  quality(
    "confirmed",
    "Manually confirmed",
    "At least one attribute uses a source you confirmed in file details (column Used). The warning for that attribute is hidden. Excluding this finds files without manual confirmations.",
  ),
  quality(
    "mediaInfo",
    "MediaInfo read",
    "The file was read with MediaInfo in file details and the stored result still matches the file. Results disappear when the file changes or is removed. Excluding this finds files without a current MediaInfo result.",
    { mediaInfo: true },
  ),
  quality(
    "metadata",
    "Incomplete metadata",
    "At least one required media attribute is unknown: resolution, codec, source, audio or language. Excluding this selects complete metadata; HDR may be SDR or unknown.",
    { positive: "incomplete", negative: "complete" },
  ),
  quality("seasonOutlier", "Technical outliers", seasonTechnicalHelp, {
    series: true,
  }),
  quality("languageOutlier", "Language outliers", seasonLanguageHelp, {
    series: true,
  }),
  ...Object.entries(mediaStateFilters).map(([name, label]) =>
    quality(name, label, mediaStateHelp[name], { group: "matching" }),
  ),
];
// Season outliers only for TV series; MediaInfo when it is enabled or its
// filter is set (a deep link or preset).
export function stateFieldsFor(
  service: Service,
  query: string,
  mediaInfoEnabled: boolean,
): StateFieldSpec[] {
  const params = new URLSearchParams(query);
  return STATE_FIELDS.filter(
    (spec) =>
      (!spec.series || service === "sonarr") &&
      (!spec.mediaInfo || mediaInfoEnabled || params.has(spec.name)),
  );
}
export type StateChoice = { active: boolean; exclude: boolean };
export function stateChoice(query: string, spec: StateFieldSpec): StateChoice {
  const value = new URLSearchParams(query).get(spec.name);
  return {
    active: value === spec.positive || value === spec.negative,
    exclude: value === spec.negative,
  };
}
// An inactive choice removes the key, so preparing the operator of an
// unchecked filter activates nothing (StateFilter.tsx).
export function withStateChoice(
  query: string,
  spec: StateFieldSpec,
  choice: StateChoice,
): string {
  return withFieldValues(
    query,
    spec.name,
    choice.active ? [choice.exclude ? spec.negative : spec.positive] : [],
  );
}

// Year and file size; the size fields read and write gigabytes (10^9 bytes).
export type RangeKind = "year" | "size";
const rangeKey = (kind: RangeKind, end: "min" | "max") =>
  kind + (end === "min" ? "Min" : "Max");
export function rangeInput(
  query: string,
  kind: RangeKind,
  end: "min" | "max",
): string {
  const value = new URLSearchParams(query).get(rangeKey(kind, end));
  if (value === null) return "";
  return kind === "size" ? String(Number(value) / 1e9) : value;
}
export function withRangeInput(
  query: string,
  kind: RangeKind,
  end: "min" | "max",
  input: string,
): string {
  const bytes = Math.round(Number(input) * 1e9);
  return withFieldValues(
    query,
    rangeKey(kind, end),
    !input
      ? []
      : kind === "year"
        ? [input]
        : Number.isFinite(bytes)
          ? [String(bytes)]
          : [],
  );
}

// The values of a field's checklist, as MultiFilter offered them: hidden tags
// left out, SD grouped, labeled and sorted in the interface language, the
// unknown value last.
export type OptionContext = {
  locale: string;
  translate(key: string): string;
  customNames: Record<string, string>;
  tagLabels: Record<string, string>;
  groupSD: boolean;
  hidden: Record<string, boolean>;
};
export type FilterOption = { value: string; label: string };
export function filterOptions(
  field: string,
  values: readonly string[],
  selected: readonly string[],
  ctx: OptionContext,
): FilterOption[] {
  const label = (value: string) =>
    value === "__unknown__" || value === ""
      ? ctx.translate(field === "custom" ? "No custom tags" : "Unknown")
      : field === "language"
        ? ctx.translate(audioLanguageLabel(value, ctx.locale))
        : field === "custom"
          ? ctx.customNames[value] || value
          : presentedTagLabel(field, value, ctx.tagLabels);
  const shown = (list: readonly string[]) =>
    list.filter((value) => tagIsDisplayed(ctx.hidden, field, value));
  let list = shown(values);
  if (field === "resolution")
    list = resolutionFilterValues(list, shown(selected), ctx.groupSD);
  return sortFilterValues(shown(list), label, ctx.locale).map((value) => ({
    value,
    label: label(value),
  }));
}

// Audio track combinations (track=language|codec|channels, Go:
// parseTrackCombination): an empty part means any value, __unknown__ an
// unknown one; at least one part is set and none is longer than 80.
export type TrackCombo = { language: string; codec: string; channels: string };
export const TRACK_COMBO_MAX = 16;
const PART_MAX = 80;
const comboParts = (parts: string[]): TrackCombo | null => {
  if (
    parts.length !== 3 ||
    !parts.some(Boolean) ||
    parts.some((part) => [...part].length > PART_MAX)
  )
    return null;
  const [language, codec, channels] = parts;
  return { language, codec, channels };
};
export function parseTrackCombo(value: string): TrackCombo | null {
  return comboParts(value.split("|").map((part) => part.trim()));
}
// All parts empty, a part with "|" or one too long give null.
export function formatTrackCombo(combo: TrackCombo): string | null {
  const parts = [combo.language, combo.codec, combo.channels].map((part) =>
    part.trim(),
  );
  return parts.some((part) => part.includes("|")) || !comboParts(parts)
    ? null
    : parts.join("|");
}
export function trackCombos(query: string): TrackCombo[] {
  return fieldValues(query, "track")
    .map(parseTrackCombo)
    .filter((combo): combo is TrackCombo => !!combo)
    .slice(0, TRACK_COMBO_MAX);
}
// Writes the valid combinations, each once, at most 16; trackOp stays.
export function withTrackCombos(
  query: string,
  combos: readonly TrackCombo[],
): string {
  const values = combos
    .map(formatTrackCombo)
    .filter((value): value is string => !!value);
  return withFieldValues(
    query,
    "track",
    [...new Set(values)].slice(0, TRACK_COMBO_MAX),
  );
}

// Chips: one per value, or one per field with all/not all, in the order of
// the query, named as the 1.7.0 panel named them. `field` gives the label of
// an attribute field (ui.tsx labels); `value` the shown form of a value of
// an attribute field (presentedTagLabel, a language by its name), of
// embyMatch (embyMatchLabels) and of every other key; `instance` an
// instance's name; `translate` is t.
export type ChipWords = {
  field(key: string): string;
  value(key: string, value: string): string;
  instance(id: string): string;
  translate(key: string, params?: Record<string, string | number>): string;
};
export type FilterChip = {
  key: string;
  label: string;
  excluded: boolean;
  without: string;
};
const CHIP_LABELS: Record<string, string> = {
  q: "Search",
  instance: "Service",
  yearMin: "From",
  yearMax: "To",
  conflict: "Metadata disagreement",
  confirmed: "Manually confirmed",
  mediaInfo: "MediaInfo read",
  ruleConflict: "Conflicting recognition rules",
  embyMatch: "Media server matching",
  seasonOutlier: "Technical outliers",
  languageOutlier: "Language outliers",
  ...mediaStateFilters,
  metadata: "Metadata status",
  sizeMin: "Bytes from",
  sizeMax: "Bytes to",
  unknownYear: "Unknown year",
  unknownSize: "Unknown size",
  track: "Audio track combination",
};
const STATE_KEYS = [
  "conflict",
  "confirmed",
  "mediaInfo",
  "ruleConflict",
  "seasonOutlier",
  "languageOutlier",
  ...Object.keys(mediaStateFilters),
];
const grouped = (params: URLSearchParams, key: string) =>
  ["all", "notAll"].includes(params.get(key + "Op") || "");
// The entries that are chips: no sort, no operator, and a field with
// all/not all once.
function chipEntries(params: URLSearchParams): [string, string][] {
  const entries = [...params.entries()].filter(
    ([key]) => key !== "sort" && key !== "dir" && !key.endsWith("Op"),
  );
  return entries.filter(
    ([key], index) =>
      !grouped(params, key) ||
      entries.findIndex(([other]) => other === key) === index,
  );
}
export function filterChips(query: string, words: ChipWords): FilterChip[] {
  const params = new URLSearchParams(query),
    keys = new Set<string>();
  const shown = (key: string, value: string): string => {
    if (key === "instance") return words.instance(value);
    if (key === "embyMatch") return words.value(key, value);
    if (STATE_KEYS.includes(key))
      return words.translate(value === "true" ? "is" : "is not");
    if (value === "__unknown__") return words.translate("Unknown");
    if (key === "metadata")
      return words.translate(
        value === "incomplete" ? "incomplete" : "complete",
      );
    if (key === "track") {
      const combo = parseTrackCombo(value);
      if (!combo) return value;
      return (
        [
          ["language", combo.language],
          ["audio", combo.codec],
          ["channels", combo.channels],
        ] as const
      )
        .filter(([, part]) => part)
        .map(([field, part]) => shown(field, part))
        .join(" · ");
    }
    return words.value(key, value);
  };
  return chipEntries(params).map(([key, value]) => {
    const op = params.get(key + "Op") || "",
      whole = grouped(params, key);
    let id = whole ? key : key + "=" + value;
    for (let n = 2; keys.has(id); n++) id = key + "=" + value + "#" + n;
    keys.add(id);
    return {
      key: id,
      label:
        (words.field(key) ||
          (CHIP_LABELS[key] ? words.translate(CHIP_LABELS[key]) : key)) +
        (whole
          ? " " +
            words.translate(
              op === "all" ? "contains all" : "does not contain all",
            ) +
            ": "
          : op === "not"
            ? " ≠ "
            : ": ") +
        (whole ? params.getAll(key) : [value])
          .map((part) => shown(key, part))
          .join(" + "),
      excluded:
        op === "not" ||
        op === "notAll" ||
        (["confirmed", "mediaInfo"].includes(key) && value === "false"),
      without: withFieldValues(
        query,
        key,
        whole ? [] : params.getAll(key).filter((other) => other !== value),
      ),
    };
  });
}
// The count on the Filters button: the chips without the search.
export function activeFilterCount(query: string): number {
  return chipEntries(new URLSearchParams(query)).filter(([key]) => key !== "q")
    .length;
}

// A choice in a track chip's menu (TrackMenu): one field with the operator
// reset, or one combination of language and codec on the same track.
export type TrackFilterAction =
  | { kind: "language" | "codec" | "channels"; value: string }
  | { kind: "combo"; language: string; codec: string };
export function withTrackAction(
  query: string,
  action: TrackFilterAction,
): string {
  if (action.kind === "combo") {
    const value = formatTrackCombo({
      language: action.language,
      codec: action.codec,
      channels: "",
    });
    return value
      ? withFieldOperator(
          withFieldValues(query, "track", [value]),
          "track",
          "eq",
        )
      : query;
  }
  // A track's codec is the audio codec field.
  const field = action.kind === "codec" ? "audio" : action.kind;
  return withFieldOperator(
    withFieldValues(query, field, [action.value]),
    field,
    "eq",
  );
}

// The drawer's live match count: one file of the draft's results; total is
// the count (server_library.go, limit). Page and sort do not change it.
export function matchCountPath(service: Service, query: string): string {
  return (
    "files?" +
    edit(query, (params) => {
      for (const key of ["page", "sort", "dir", "limit", "service"])
        params.delete(key);
      params.set("service", service);
      params.set("limit", "1");
    })
  );
}
// Placeholder rows until a service's first results: the page or the files
// in the cache, whichever is fewer.
export function placeholderRows(
  loaded: boolean,
  pageSize: number,
  cached: number,
): number {
  return loaded ? 0 : Math.max(0, Math.min(pageSize, cached));
}
