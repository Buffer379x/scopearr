import type { ToolFilters } from "./browser-storage";
import { t } from "./i18n";
import { muxFilterJobs } from "./mux-spec";
import { toolFilterQuery } from "./tool-filters";
import type {
  FileCheckActivity,
  MuxJob,
  PlacementItem,
  UnraidDisk,
} from "./types";

// The tool pages as data (docs/STYLEGUIDE.md, Part 1, 10.2, 10.5 and 11.1):
// the KPI cards, the disk cards, the drawer's draft and live count and the
// preset select.

export type ToolKind = "mux" | "placement" | "files";

// The drawer's draft: what applies with Apply. The target is no field of
// the drawer; it comes as a chip from the scan report and stays.
export type ToolDraft = {
  statuses: string[];
  kinds: string[];
  targets: string[];
  shares: string[];
};
export type ToolOption = { value: string; label: string; count?: number };
export type ToolGroup = {
  key: "statuses" | "kinds" | "shares";
  label: string;
  options: ToolOption[];
};

// A compact KPI card: its value (null before the data) and the statuses it
// filters by (null: a hero without a filter, which is no button).
export type ToolKpi = {
  key: string;
  label: string;
  value: number | null;
  hero: boolean;
  statuses: readonly string[] | null;
};

// The effective statuses (effectiveMuxStatus) of an open mux job.
export const MUX_OPEN_STATUSES: readonly string[] = [
  "warning",
  "draft",
  "ready",
  "queued",
  "running",
  "failed",
  "needs_review",
  "needs_attention",
];

const MUX_KPIS = [
  ["open", "Open", MUX_OPEN_STATUSES, true],
  ["running", "Running", ["running"], false],
  ["failed", "Failed", ["failed"], false],
  ["succeeded", "Successful", ["succeeded"], false],
] as const;

// Open (the hero), Running, Failed and Successful: each counts the rows its
// own filter shows (muxFilterJobs, so effective statuses).
export function muxKpis(jobs: readonly MuxJob[] | null): ToolKpi[] {
  return MUX_KPIS.map(([key, label, statuses, hero]) => ({
    key,
    label: t(label),
    value: jobs
      ? muxFilterJobs([...jobs], { statuses: [...statuses], q: "" }).length
      : null,
    hero,
    statuses: Object.freeze([...statuses]),
  }));
}

// Items checked (the hero, from the last report, no filter), then Open,
// Fixed and Manual from the activity's counts (ruling R-G).
export function fileCheckKpis(activity: FileCheckActivity | null): ToolKpi[] {
  const counts = activity?.counts;
  const count = (key: string) => (activity ? counts?.[key] || 0 : null);
  return [
    {
      key: "checked",
      label: t("Items checked"),
      value:
        typeof activity?.report?.checked === "number"
          ? activity.report.checked
          : null,
      hero: true,
      statuses: null,
    },
    ...(
      [
        ["open", "Open"],
        ["fixed", "Fixed"],
        ["manual", "Manual"],
      ] as const
    ).map(([key, label]) => ({
      key,
      label: t(label),
      value: count(key),
      hero: false,
      statuses: Object.freeze([key]),
    })),
  ];
}

// Pressed while the status filter is exactly the card's set.
export function kpiPressed(statuses: readonly string[], kpi: ToolKpi): boolean {
  const own = kpi.statuses;
  if (!own) return false;
  const chosen = new Set(statuses);
  return (
    chosen.size === new Set(own).size &&
    own.every((status) => chosen.has(status))
  );
}

// A press shows only the card's statuses; a press on the pressed card
// clears the status filter.
export function kpiChoice(statuses: readonly string[], kpi: ToolKpi): string[] {
  if (!kpi.statuses) return [...statuses];
  return kpiPressed(statuses, kpi) ? [] : [...kpi.statuses];
}

// A disk card: used and free in bytes, share the used percent, target
// while a running or queued job of the shown page moves to it, standby null
// when the status does not say.
export type DiskCardModel = {
  name: string;
  pool: boolean;
  used: number;
  free: number;
  total: number;
  share: number;
  target: boolean;
  standby: boolean | null;
};
// Placeholder cards until the first answer and without disks.
export const DISK_PLACEHOLDERS = 3;

// The disks in the order of discoverDisks (unraid_disks.go): the array
// first, by disk number, then the pools by name.
export function diskCardModels(
  disks: readonly UnraidDisk[],
  items: readonly Pick<PlacementItem, "target" | "jobStatus">[],
): DiskCardModel[] {
  const number = (name: string) => Number(name.replace(/^disk/, "")) || 0;
  const targets = new Set(
    items
      .filter((item) => ["running", "queued"].includes(item.jobStatus))
      .map((item) => item.target),
  );
  return [...disks]
    .sort((a, b) =>
      a.kind !== b.kind
        ? a.kind === "array"
          ? -1
          : 1
        : (a.kind === "array" ? number(a.name) - number(b.name) : 0) ||
          (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    )
    .map((disk) => {
      const used = Math.max(0, disk.total - disk.free);
      return {
        name: disk.name,
        pool: disk.kind === "pool",
        used,
        free: disk.free,
        total: disk.total,
        share: disk.total > 0 ? (used * 100) / disk.total : 0,
        target: targets.has(disk.name),
        standby: disk.standby ?? null,
      };
    });
}

// The drawer's live count: one item of the draft's results, as the list
// asks for them (toolFilterQuery), without sort, dir and offset. Disk
// placement asks placement/items with q, status, target, kind and share;
// Files & permissions asks filecheck/items with q, status, kind and share.
export function toolCountPath(
  tool: "placement" | "files",
  q: string,
  draft: ToolDraft,
): string {
  const params =
    tool === "placement"
      ? toolFilterQuery(q, {
          status: draft.statuses,
          target: draft.targets,
          kind: draft.kinds,
          share: draft.shares,
        })
      : toolFilterQuery(q, {
          status: draft.statuses,
          kind: draft.kinds,
          share: draft.shares,
        });
  params.set("limit", "1");
  return (
    (tool === "placement" ? "placement/items?" : "filecheck/items?") + params
  );
}

// Mux counts its draft in the browser, as its list filters.
export function muxDraftCount(
  jobs: readonly MuxJob[],
  q: string,
  draft: Pick<ToolDraft, "statuses">,
): number {
  return muxFilterJobs([...jobs], { statuses: [...draft.statuses], q }).length;
}

// The draft a drawer opens with: the applied filters and shares.
export function draftOf(
  filters: ToolFilters,
  shares: readonly string[],
): ToolDraft {
  return {
    statuses: [...filters.statuses],
    kinds: [...filters.kinds],
    targets: [...filters.targets],
    shares: [...shares],
  };
}

// The preset select of a tool card (FilterBar): the tool's "All …" entry,
// then its presets; Custom selection while filters are active that match
// no preset.
export function toolPresetChoice(
  allLabel: string,
  presets: readonly { id: number; name: string; query: string }[],
  selected: { id: number } | undefined,
  active: boolean,
): {
  value: string;
  options: { value: string; label: string }[];
  custom: boolean;
} {
  return {
    value: selected ? String(selected.id) : "all",
    options: [
      { value: "all", label: allLabel },
      ...presets.map((preset) => ({
        value: String(preset.id),
        label: preset.name,
      })),
    ],
    custom: !selected && active,
  };
}
