import type { BandStyle, Theme } from "./appearance";
import type { TableSort } from "./table-sort";
import {
  eventLevels,
  eventSources,
  type EventPage,
  type LogFilter,
} from "./event-log";
import type { SyncState } from "./frame-status";
import type { ListPrefs } from "./list-prefs";
import type { SettingsSectionId } from "./router";
import { interfaceThemes, themePalettes, type InterfaceTheme } from "./themes";
import type { ToolGroup } from "./tool-list";
import type { ToolStatusView } from "./tool-status";
import type {
  Connection,
  MuxToolStatus,
  RecognitionRule,
  ServiceType,
  Settings,
  Status,
  UnraidState,
  UnraidStatus,
} from "./types";

// The settings pages as data (docs/STYLEGUIDE.md, Part 1, 10.11 and 11.4):
// the section heads, the unsaved changes per tab, the service status rows
// and heads, the rule order, the band choice, the palette preview, the
// column preview and the log filter model. Pure functions; texts are
// catalog keys or pass through the given translate. Runtime imports are
// themes.ts and event-log.ts only (the latter has none of its own).

export type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

// A section's head on the band (E4): its title (the sidebar label), its
// 1.7.0 description, what "Save settings" saves (the settings form, the
// rules, the custom tag colors or nothing) and its band segment.
export type SectionMeta = {
  title: string;
  description: string;
  save: "form" | "rules" | "custom" | null;
  segment: "display" | "system" | null;
};

const meta = (
  title: string,
  description: string,
  save: SectionMeta["save"],
  segment: SectionMeta["segment"],
): SectionMeta => Object.freeze({ title, description, save, segment });

export const SECTION_META: Readonly<Record<SettingsSectionId, SectionMeta>> =
  Object.freeze({
    connections: meta(
      "Services",
      "Configure connections, synchronization intervals and optional outbound tags.",
      "form",
      null,
    ),
    appearance: meta(
      "Display",
      "Choose your interface language, library layout and default columns.",
      "form",
      "display",
    ),
    widgets: meta(
      "Widgets",
      "Choose dashboard storage paths, shared groups and chart colors.",
      "form",
      null,
    ),
    custom: meta(
      "Custom tags",
      "Create tags here, assign them in your library or use them in filename rules.",
      "custom",
      null,
    ),
    recognition: meta(
      "Tag rules",
      "Rules only read filenames. API metadata fills remaining gaps; Media server audio tracks stay separate. No media scans are triggered.",
      "rules",
      null,
    ),
    system: meta(
      "System",
      "Check synchronization, manage backups and secure your account. The log shows events from the last 24 hours.",
      null,
      "system",
    ),
  });

export type DisplayTab = "general" | "lists" | "colors";
export type ColumnsTab =
  "icons" | "radarr" | "sonarr" | "filecheck" | "placement";

const changed = (a: unknown, b: unknown) =>
  JSON.stringify(a) !== JSON.stringify(b);
const anyChanged = (
  cfg: Settings,
  saved: Settings,
  keys: readonly (keyof Settings)[],
) => keys.some((key) => changed(cfg[key], saved[key]));

const GENERAL_KEYS: readonly (keyof Settings)[] = [
  "interfaceTheme",
  "seasonMode",
  "pageSize",
  "groupSD",
  "groupSDLists",
];
const LISTS_KEYS: readonly (keyof Settings)[] = [
  "listInfoOrder",
  "listInfoVisible",
  "columnOrder",
  "visibleColumns",
  "filecheckColumnOrder",
  "filecheckVisibleColumns",
  "placementColumnOrder",
  "placementVisibleColumns",
];
const COLORS_KEYS: readonly (keyof Settings)[] = [
  "tagColors",
  "tagTextColors",
  "hiddenTags",
  "warningColors",
];

// The dirty marks of the Display tabs, as SettingsPage computed them in
// 1.7.0, plus the mode and band drafts on General (ruling P1).
export function displayDirty(
  cfg: Settings,
  saved: Settings,
  drafts: {
    locale: string;
    savedLocale: string;
    prefs: ListPrefs;
    savedPrefs: ListPrefs;
    mode: Theme;
    savedMode: Theme;
    band: BandStyle | null;
    savedBand: BandStyle | null;
  },
): Record<DisplayTab, boolean> {
  return {
    general:
      drafts.locale !== drafts.savedLocale ||
      drafts.prefs.density !== drafts.savedPrefs.density ||
      drafts.mode !== drafts.savedMode ||
      drafts.band !== drafts.savedBand ||
      anyChanged(cfg, saved, GENERAL_KEYS),
    lists:
      drafts.prefs.stacked !== drafts.savedPrefs.stacked ||
      anyChanged(cfg, saved, LISTS_KEYS),
    colors: anyChanged(cfg, saved, COLORS_KEYS),
  };
}

const COLUMNS_KEYS: Readonly<Record<ColumnsTab, readonly (keyof Settings)[]>> =
  {
    icons: ["listInfoOrder", "listInfoVisible"],
    radarr: ["columnOrder", "visibleColumns"],
    sonarr: ["columnOrder", "visibleColumns"],
    filecheck: ["filecheckColumnOrder", "filecheckVisibleColumns"],
    placement: ["placementColumnOrder", "placementVisibleColumns"],
  };

// The dirty marks of the Lists & columns tabs, as AppearanceSettings
// computed them in 1.7.0: the libraries compare their own service's lists.
export function columnsDirty(
  cfg: Settings,
  saved: Settings,
): Record<ColumnsTab, boolean> {
  const of = (settings: Settings, tab: ColumnsTab, key: keyof Settings) =>
    tab === "radarr" || tab === "sonarr"
      ? (settings[key] as Record<string, unknown> | undefined)?.[tab]
      : settings[key];
  const dirty = (tab: ColumnsTab) =>
    COLUMNS_KEYS[tab].some((key) =>
      changed(of(cfg, tab, key), of(saved, tab, key)),
    );
  return {
    icons: dirty("icons"),
    radarr: dirty("radarr"),
    sonarr: dirty("sonarr"),
    filecheck: dirty("filecheck"),
    placement: dirty("placement"),
  };
}

// Pure (the annotation lets a chunk without the rules leave it out).
const collator = /* @__PURE__ */ new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

// Digits compare as numbers, case and accents tie ("6.1" before "7.1",
// "576p" before "1080p").
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

// The rule table's order (D19): the main key as 1.7.0 (priority ascending
// by default, the tag color as a boolean, a custom value by its tag name),
// a tie by the natural order of the names, then by ID. desc reverses only
// the main key. The execution order (priority, then ID) is unchanged.
export function sortRules(
  rules: readonly RecognitionRule[],
  sort: TableSort,
  names: Readonly<Record<string, string>>,
): RecognitionRule[] {
  const field = (sort?.field || "priority") as keyof RecognitionRule;
  const key = (rule: RecognitionRule) =>
    field === "tag"
      ? rule.tag !== false
      : field === "value" && rule.field === "custom"
        ? names[rule.value] || rule.value
        : rule[field];
  return [...rules].sort((a, b) => {
    const x = key(a),
      y = key(b);
    const cmp =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y));
    return (
      (sort?.direction === "desc" ? -cmp : cmp) ||
      naturalCompare(a.name, b.name) ||
      a.id.localeCompare(b.id)
    );
  });
}

// The service card's status (E9, ruling R-I): a fixed row set per kind,
// always rendered.
export type ServiceKind = "arr" | "media" | "mux" | "mediainfo" | "unraid";
export type StatusKey =
  | "status"
  | "files"
  | "next"
  | "webhook"
  | "external"
  | "tags"
  | "installed"
  | "available"
  | "upstream"
  | "checked"
  | "size"
  | "mover"
  | "disks";

export function serviceKind(
  type: ServiceType | "mux" | "mediainfo" | "unraid",
): ServiceKind {
  return type === "radarr" || type === "sonarr"
    ? "arr"
    : type === "emby" || type === "jellyfin"
      ? "media"
      : type;
}

const TOOL_ROWS: readonly StatusKey[] = Object.freeze([
  "status",
  "installed",
  "available",
  "upstream",
  "checked",
  "size",
]);
const STATUS_ROWS: Readonly<Record<ServiceKind, readonly StatusKey[]>> =
  Object.freeze({
    arr: Object.freeze([
      "status",
      "files",
      "next",
      "webhook",
      "external",
      "tags",
    ] as const),
    media: Object.freeze(["status", "files", "next", "tags"] as const),
    mux: TOOL_ROWS,
    mediainfo: TOOL_ROWS,
    unraid: Object.freeze(["status", "mover", "disks"] as const),
  });

export function statusRows(kind: ServiceKind): readonly StatusKey[] {
  return STATUS_ROWS[kind];
}

const STATUS_LABELS: Readonly<Record<StatusKey, string>> = {
  status: "Status",
  files: "Files",
  next: "Next sync",
  webhook: "Realtime updates",
  external: "External tags",
  tags: "Tag synchronization",
  installed: "Installed version",
  available: "Available version",
  upstream: "Upstream version",
  checked: "Last check",
  size: "Size",
  mover: "Mover / parity state",
  disks: "Disks",
};

// The row's label as a catalog key.
export function statusLabel(key: StatusKey): string {
  return STATUS_LABELS[key];
}

// The reserved value until an answer arrives (E22).
const PENDING: ToolStatusView = { tone: "neutral", text: "—", long: "—" };
const view = (
  tone: ToolStatusView["tone"],
  text: string,
  long = text,
): ToolStatusView => ({ tone, text, long });

// The head tag of a library or media server card from its syncSummary row:
// disabled, not synced yet, running, error or ready; the status line is
// the title.
export function serviceHead(
  row: { enabled: boolean; state: SyncState; text: string } | undefined,
  t: Translate,
): ToolStatusView {
  if (!row) return { ...PENDING };
  if (!row.enabled) return view("neutral", t("Disabled"), row.text);
  switch (row.state) {
    case "running":
      return view("running", t("Running"), row.text);
    case "error":
      return view("error", t("Error"), row.text);
    case "ok":
      return view("ok", t("Ready"), row.text);
    default:
      return view("neutral", t("Not synced yet"), row.text);
  }
}

// The status texts of a library or media server (E9, Task 9 B12), one
// source for its Services card and its System → Info block: the tail of
// the Status title after a failed sync (the last success, else ""), Files,
// Next sync, Realtime updates (null: Disabled), whether External tags is
// on, Tag synchronization (null: Disabled), whether a tag removal waits
// for review, and whether the Realtime updates or Tag synchronization text
// is an error (shown in the error tone). A missing value stays missing
// ("—").
export type ServiceTexts = {
  last: string;
  files?: string;
  next?: string | null;
  webhook: string | null;
  external: boolean;
  tags: string | null;
  review: boolean;
  webhookError: boolean;
  tagsError: boolean;
};
export function serviceValues(
  instance: Pick<
    Connection,
    "type" | "webhookEnabled" | "tagImport" | "tagSync"
  > & { id: string },
  status: Status,
  t: Translate,
  format: {
    date(value: string | null | undefined): string;
    count(n: number): string;
  },
): ServiceTexts {
  const { id } = instance;
  const media = instance.type === "emby" || instance.type === "jellyfin";
  const sync = status.sync?.[id],
    tags = status.tagSync?.[id],
    hook = status.webhook?.[id];
  const tagsOn =
    Object.values(instance.tagSync || {}).some(Boolean) ||
    tags?.running ||
    tags?.pending ||
    tags?.error ||
    tags?.approvalRequired ||
    !!tags?.retainedDefinitions;
  return {
    last:
      sync?.error && sync.lastSuccess
        ? " · " +
          t("Last successful sync") +
          ": " +
          format.date(sync.lastSuccess)
        : "",
    files:
      sync &&
      (media
        ? t("{count} files matched", { count: sync.count || 0 })
        : format.count(sync.count || 0) + " " + t("files in cache")),
    next: status.nextSync?.[id] && format.date(status.nextSync[id]),
    webhook: instance.webhookEnabled
      ? (hook?.error
          ? t(hook.error)
          : t("Last webhook update: {date}", {
              date: format.date(hook?.lastSuccess),
            })) +
        " · " +
        t("{count} pending", { count: hook?.pending || 0 })
      : null,
    external: !!instance.tagImport,
    tags: tagsOn
      ? (tags?.error
          ? t(tags.error)
          : tags?.running
            ? t("Tag synchronization in progress …")
            : tags?.pending
              ? t("Tag synchronization pending …")
              : t("Last sync: {date}", {
                  date: format.date(tags?.lastSuccess),
                })) +
        (tags?.retainedDefinitions
          ? " · " +
            t(
              "{count} tag definitions retained because the service still uses them.",
              { count: tags.retainedDefinitions },
            )
          : "")
      : null,
    review: !!tags?.approvalRequired,
    webhookError: !!(instance.webhookEnabled && hook?.error),
    tagsError: !!(tagsOn && tags?.error),
  };
}

// The head tag of MKVToolNix and MediaInfo, with the texts of the 1.7.0
// package card; the error is the title.
export function toolHead(
  tool: MuxToolStatus | undefined,
  t: Translate,
): ToolStatusView {
  if (!tool) return { ...PENDING };
  if (tool.busy) return view("running", t("Working…"));
  if (tool.error) return view("error", t("Error"), t(tool.error));
  return tool.installed
    ? view("ok", t("Installed"))
    : view("neutral", t("Not installed"));
}

// The head tag of Unraid: disabled, then error, then ready (ruling M10);
// the status shows the saved settings, so the enabled switch is checked
// first.
export function unraidHead(
  status: UnraidStatus | null,
  enabled: boolean,
  t: Translate,
): ToolStatusView {
  if (!enabled) return view("neutral", t("Disabled"));
  if (status?.error) return view("error", t("Error"), t(status.error));
  if (status?.ready) return view("ok", t("Ready"));
  return { ...PENDING };
}

// The mover / parity line, in the order of the 1.7.0 path check.
export function moverKey(
  state: UnraidState | undefined,
):
  | "Mover is running"
  | "Parity operation in progress"
  | "Idle"
  | "Mover/parity state unknown" {
  return state?.mover
    ? "Mover is running"
    : state?.parity
      ? "Parity operation in progress"
      : state?.known
        ? "Idle"
        : "Mover/parity state unknown";
}

// The accent band a toggle shows: the stored (or drafted) choice, else the
// default of the mode (D16, as appearance.ts resolveBand: muted in dark,
// strong in light), and whether a choice is stored ("Use default").
export function bandChoice(
  theme: Theme,
  stored: BandStyle | null,
): { value: BandStyle; stored: boolean } {
  return {
    value: stored ?? (theme === "light" ? "strong" : "muted"),
    stored: stored !== null,
  };
}

// The default palette and the status tokens per mode, as base.css holds
// them (a test compares both). Inline data for the scoped preview (E25);
// pure, so a chunk without the preview leaves them out.
export const DEFAULT_PALETTE: Readonly<Record<Theme, Record<string, string>>> =
  /* @__PURE__ */ Object.freeze({
    dark: /* @__PURE__ */ Object.freeze({
      bg: "#101719",
      panel: "#151e21",
      panel2: "#1a2529",
      line: "#29363b",
      text: "#e5edef",
      muted: "#819399",
      accent: "#7ee4c5",
      "accent-bg": "#1c3931",
      "accent-text": "#123429",
    }),
    light: /* @__PURE__ */ Object.freeze({
      bg: "#f5f8f8",
      panel: "#fff",
      panel2: "#edf3f3",
      line: "#dbe5e7",
      text: "#1d3238",
      muted: "#536b72",
      accent: "#14755c",
      "accent-bg": "#e0f4eb",
      "accent-text": "#ffffff",
    }),
  });
export const STATUS_TOKENS: Readonly<Record<Theme, Record<string, string>>> =
  /* @__PURE__ */ Object.freeze({
    dark: /* @__PURE__ */ Object.freeze({
      "status-ok": "#7ee4c5",
      "status-warn": "#f0bf66",
      "status-wait": "#f29b5c",
      "status-error": "#ffb4bd",
      "status-info": "#86c5f4",
    }),
    light: /* @__PURE__ */ Object.freeze({
      "status-ok": "#126347",
      "status-warn": "#795109",
      "status-wait": "#9a4a0b",
      "status-error": "#a33743",
      "status-info": "#205f94",
    }),
  });

// A palette's colors in one mode; an unknown palette is the default, as
// applyInterfaceTheme treats it.
function palette(theme: string, mode: Theme): Record<string, string> {
  const known =
    theme !== "default" && interfaceThemes.includes(theme as InterfaceTheme);
  return known
    ? themePalettes[theme as Exclude<InterfaceTheme, "default">][mode]
    : DEFAULT_PALETTE[mode];
}

// The inline style of a scoped palette preview (Design 2.2): the nine
// palette keys, then the five status tokens.
export function previewStyle(
  theme: string,
  mode: Theme,
): Record<string, string> {
  const style: Record<string, string> = {};
  for (const [key, color] of Object.entries(palette(theme, mode)))
    style["--" + key] = color;
  for (const [key, color] of Object.entries(STATUS_TOKENS[mode]))
    style["--" + key] = color;
  return style;
}

// A palette tile's four dots: background, raised panel, accent, text.
export function paletteDots(
  theme: string,
  mode: Theme,
): [string, string, string, string] {
  const colors = palette(theme, mode);
  return [colors.bg, colors.panel2, colors.accent, colors.text];
}

// The numbered column preview: the visible entries in their order.
export function columnPreview(
  order: readonly string[],
  visible: readonly string[],
  labels: Readonly<Record<string, string>>,
): { key: string; label: string; n: number }[] {
  return order
    .filter((key) => visible.includes(key))
    .map((key, index) => ({ key, label: labels[key] ?? key, n: index + 1 }));
}

// The storage paths of an instance (Widgets, E22): what was shown keeps
// its place, a path that is gone leaves and a new one follows, so the
// chosen paths of the first paint stay put when the reported ones arrive
// and a choice moves no row.
export function keepOrder(
  shown: readonly string[],
  now: readonly string[],
): string[] {
  const next = new Set(now);
  return [...new Set([...shown.filter((path) => next.has(path)), ...next])];
}

// The log drawer (E20): level, source and service apply with Apply; the
// search applies at once and stays.
export type LogDraft = {
  level: string[];
  source: string[];
  instance: string[];
};
export type LogGroup = Omit<ToolGroup, "key"> & { key: keyof LogDraft };
type LogLabels = {
  level(value: string): string;
  source(value: string): string;
  instance(value: string): string;
};
const LOG_KEYS = ["level", "source", "instance"] as const;

export function logDraft(filter: LogFilter): LogDraft {
  return {
    level: [...(filter.level || [])],
    source: [...(filter.source || [])],
    instance: [...(filter.instance || [])],
  };
}

// The filter after Apply: the search, and only the non-empty draft lists.
export function logApply(filter: LogFilter, draft: LogDraft): LogFilter {
  const next: LogFilter = filter.q ? { q: filter.q } : {};
  for (const key of LOG_KEYS)
    if (draft[key].length) next[key] = [...draft[key]];
  return next;
}

// The drawer's live count: one entry of the draft's results, with the
// names of eventQuery.
export function logCountPath(filter: LogFilter, draft: LogDraft): string {
  const query = new URLSearchParams();
  const q = filter.q?.trim();
  if (q) query.set("q", q);
  for (const key of LOG_KEYS)
    for (const value of draft[key]) if (value) query.append(key, value);
  query.set("limit", "1");
  return "events?" + query.toString();
}

// The drawer's sections: every level, the sources with entries or chosen
// (1.7.0 EventLogViewer), the services only with entries or a choice.
export function logGroups(
  counts: EventPage["counts"],
  filter: LogFilter,
  labels: LogLabels,
  t: Translate,
): LogGroup[] {
  const options = (key: keyof LogDraft, values: readonly string[]) =>
    values.map((value) => ({
      value,
      label: labels[key](value),
      count: counts[key][value] ?? 0,
    }));
  const chosen = (key: keyof LogDraft) => filter[key] || [];
  const groups: LogGroup[] = [
    { key: "level", label: t("Level"), options: options("level", eventLevels) },
    {
      key: "source",
      label: t("Source"),
      options: options(
        "source",
        Object.keys(eventSources).filter(
          (value) => counts.source[value] || chosen("source").includes(value),
        ),
      ),
    },
  ];
  const services = [
    ...new Set([...Object.keys(counts.instance), ...chosen("instance")]),
  ];
  if (services.length)
    groups.push({
      key: "instance",
      label: t("Service"),
      options: options("instance", services),
    });
  return groups;
}

// The chips of the applied filter with the 1.7.0 labels: the search, then
// each level, source and service.
export function logChips(
  filter: LogFilter,
  labels: LogLabels,
  t: Translate,
): {
  key: string;
  label: string;
  field: "q" | "level" | "source" | "instance";
  value: string;
}[] {
  return [
    ...(filter.q
      ? [
          {
            key: "q",
            label: t("Search: {value}", { value: filter.q }),
            field: "q" as const,
            value: filter.q,
          },
        ]
      : []),
    ...LOG_KEYS.flatMap((field) =>
      (filter[field] || []).map((value) => ({
        key: field + ":" + value,
        label: labels[field](value),
        field,
        value,
      })),
    ),
  ];
}
