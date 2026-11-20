import { decimalBytes } from "./units";
import { getLocale, t } from "./i18n";
import { createContext } from "preact";
import type { Results } from "./types";
const translatedLabels = <T extends Record<string, string>>(values: T): T =>
  new Proxy(values, {
    get: (target, key: string) => (key in target ? t(target[key]) : undefined),
  });
export const labels: Record<string, string> = translatedLabels({
  share: "Shares",
  resolution: "Resolution",
  codec: "Codec / encoder",
  family: "Codec family",
  source: "Source",
  processing: "Processing",
  hdr: "HDR",
  bitDepth: "Bit depth",
  audio: "Audio codec",
  channels: "Channels",
  language: "Language",
  custom: "Custom",
});
export const tableColumns = [
  ["info", "Info"],
  ["title", "Title / episode"],
  ["year", "Year"],
  ["resolution", "Resolution"],
  ["codec", "Codec"],
  ["source", "Source"],
  ["processing", "Processing"],
  ["size", "Size"],
  ["hdr", "HDR"],
  ["bitDepth", "Bit depth"],
  ["audio", "Audio tracks"],
  ["channels", "Channels"],
  ["custom", "Custom"],
];
export type ConnectionService = string;
export const embyMatchLabels: Record<string, string> = translatedLabels({
  conflicting: "Conflicting media server metadata",
  pending: "Awaiting media server matching",
  unmatched: "All unsuccessful matches",
  matched: "Matched with audio tracks",
  unconfigured: "Without media server enrichment",
  missing: "Not found in media server",
  missing_size: "File size missing for matching",
  ambiguous: "Ambiguous file or stream match",
  no_tracks: "Matched, audio tracks missing",
});
export type FilterOperator = "eq" | "not" | "all" | "notAll";
export const operatorLabels: Record<FilterOperator, string> = translatedLabels({
  eq: "is",
  not: "is not",
  all: "contains all",
  notAll: "does not contain all",
});
export const compoundFields = [
  "hdr",
  "audio",
  "language",
  "channels",
  "custom",
];
export type FilterUpdate = string[] | ((current: string[]) => string[]);
export const defaultColumnOrder = tableColumns.map(([field]) => field);
export const columnLabels = translatedLabels(Object.fromEntries(tableColumns));
export const defaultColumns = [
  "info",
  "title",
  "year",
  "resolution",
  "codec",
  "source",
  "processing",
  "custom",
];
export const emptyResults: Results = {
  files: [],
  total: 0,
  displayTotal: 0,
  page: 1,
  pageSize: 100,
};
export const count = (n: number) =>
  new Intl.NumberFormat(getLocale()).format(n);
export const bytes = (n: number) =>
  Number.isFinite(n) && n >= 0 ? decimalBytes(n, getLocale()) : "—";
export const compactBytes = (n: number) => decimalBytes(n, getLocale());
export const date = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleString(getLocale(), {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : t("Not synced yet");
// The time of day of a timestamp (the frame's sync summary); "" without one.
export const clock = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleTimeString(getLocale(), {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
export const TagVisibility = createContext<Record<string, string[]> | null>(
  null,
);
export const TagLabels = createContext<Record<string, string>>({});
export const SDListGrouping = createContext(false);
export const TagInformation = createContext<Record<string, string[]>>({});
export const TagColors = createContext<Record<string, string>>({});
export const TagTextColors = createContext<Record<string, string>>({});
export const HiddenTags = createContext<Record<string, boolean>>({});
export const CustomTagNames = createContext<Record<string, string>>({});
export const colorFields = [
  "resolution",
  "codec",
  "source",
  "processing",
  "hdr",
  "bitDepth",
  "channels",
  "audio",
  "custom",
];
export const defaultColor = (field: string, value: string) =>
  field === "resolution"
    ? value === "2160p" || value === "4320p"
      ? "#b7a0e8"
      : value === "720p"
        ? "#a6c582"
        : "#85bce5"
    : (
        {
          codec: "#72c9a4",
          source: "#e4c16d",
          processing: "#d894b0",
          hdr: "#b7a0e8",
          audio: "#87bad3",
        } as Record<string, string>
      )[field] || "#b0bbc5";
export const defaultWarningColors: Record<string, string> = {
  metadata: "#d9a870",
  recognition: "#b994f0",
};

export const ICON = {
  arrow: 11,
  chip: 12,
  sort: 13,
  label: 15,
  row: 15,
  button: 16,
  large: 18,
  close: 20,
  empty: 28,
} as const;

export const percent = (n: number) =>
  new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(n) +
  "\u202f%";
