import { fileCheckStatusLabels } from "./filecheck";
import { muxStatusShort } from "./mux-spec";
import { placementStatusShort } from "./placement";
import type { ToolKind } from "./tool-list";
import { ICON } from "./ui";

// The column widths of the v2 tool tables (docs/STYLEGUIDE.md, Part 1,
// 10.10, ToolTable). They never depend on the rows on screen: a running job
// changes its status and its progress, so every width comes from the
// labels, the status texts the tool can show and fixed minima. This module
// stays out of the library chunk (frame-status does not import it, ruling
// I2); use-tool-table.ts measures with it.

type Translate = (
  key: string,
  parameters?: Record<string, string | number>,
) => string;

// The messages that hold a queued move: its status tag shows them as its
// text (Design 11.2, placementStatusView).
export const PLACEMENT_WAITS: readonly string[] = [
  "Waiting: mover is running",
  "Waiting: parity operation in progress",
];

// Every text a status tag of the tool can show, translated (tool-status.ts
// exports it too): the status column covers all of them, never only the
// rows on screen.
export function toolStatusTexts(kind: ToolKind, t: Translate): string[] {
  const keys =
    kind === "mux"
      ? Object.values(muxStatusShort)
      : kind === "placement"
        ? [...Object.values(placementStatusShort), ...PLACEMENT_WAITS]
        : Object.values(fileCheckStatusLabels);
  return [...new Set(keys.map((key) => t(key)))];
}

// The minimum content width in px of each data column (ruling R-D, measured
// with Inter and the v2 metrics in Phase 5b, Task 2; the cell padding comes
// on top, so a column keeps its content whether it stands first, in the
// middle or last). progress is the progress cell, --tool-progress-w
// (a stylesheet guard keeps the two equal).
export const TOOL_COLUMN_MIN: Readonly<Record<string, number>> = {
  service: 64,
  origin: 64,
  size: 60,
  disks: 144,
  target: 56,
  move: 60,
  kind: 76,
  progress: 130,
  path: 224,
  current: 100,
  fix: 96,
};

// What toolColumnStyle measures with: header(label) is the width of a
// header label, tag(text) the width of a status tag with that text; button
// is a row button (--row-btn), gap the space between two (--sp-1), pad the
// horizontal cell padding (--sp-2), edge the padding of the first and the
// last cell (--sp-5), select the selection column (--select-col), title the
// title column's minimum (--title-col-min), sort what a sort button adds to
// its label and status the status column's minimum content
// (--tool-status-min).
export type ToolMetrics = {
  header(label: string): number;
  tag(text: string): number;
  button: number;
  gap: number;
  pad: number;
  edge: number;
  select: number;
  title: number;
  sort: number;
  status: number;
};

export type ToolButtons = {
  info: number;
  actions: number;
  infoPhone: number;
  actionsPhone: number;
};

// The part a column plays: Mux names its columns differently (filename,
// buttons for Info, actions for Actions); Disk placement and Files &
// permissions use actions for Info and remove for Actions.
function role(kind: ToolKind, column: string) {
  const roles: Record<string, string> =
    kind === "mux"
      ? { filename: "title", buttons: "info", actions: "actions" }
      : { actions: "info", remove: "actions" };
  return roles[column] || column;
}

// One width per column: --tt-<column> (the title takes the rest and has
// none), the table's minimum width --tt-min and its minimum at ≤ 739,
// --tt-min-phone, where Info and Actions show fewer buttons. Each data
// column takes the larger of its minimum and its sortable header, the
// status column also the widest status text of the tool; Info and Actions
// n buttons with their gaps (and at least their header); all plus the cell
// padding, the first and the last cell with --sp-5.
export function toolColumnStyle(
  columns: readonly string[],
  kind: ToolKind,
  labels: Record<string, string>,
  statusTexts: readonly string[],
  buttons: ToolButtons,
  metrics: ToolMetrics,
): Record<string, string> {
  const vars: Record<string, string> = {};
  const last = columns.length - 1;
  const tag = Math.max(0, ...statusTexts.map((text) => metrics.tag(text)));
  let desk = 0,
    phone = 0;
  columns.forEach((column, index) => {
    const part = role(kind, column);
    const padding =
      (index === 0 ? metrics.edge : metrics.pad) +
      (index === last ? metrics.edge : metrics.pad);
    const label = labels[column] || "";
    const row = (n: number) =>
      Math.max(
        n * metrics.button + Math.max(0, n - 1) * metrics.gap,
        label ? metrics.header(label) : 0,
      ) + padding;
    if (part === "title") {
      desk += metrics.title;
      phone += metrics.title;
      return;
    }
    let width: number, narrow: number;
    if (part === "select") width = narrow = metrics.select;
    else if (part === "info") {
      width = row(buttons.info);
      narrow = row(buttons.infoPhone);
    } else if (part === "actions") {
      width = row(buttons.actions);
      narrow = row(buttons.actionsPhone);
    } else
      width = narrow =
        Math.max(
          TOOL_COLUMN_MIN[column] || 0,
          label ? metrics.header(label) + metrics.sort : 0,
          part === "status" ? Math.max(metrics.status, tag) : 0,
        ) + padding;
    vars["--tt-" + column] = Math.ceil(width) + "px";
    desk += Math.ceil(width);
    phone += Math.ceil(narrow);
  });
  vars["--tt-min"] = desk + "px";
  vars["--tt-min-phone"] = phone + "px";
  return vars;
}

// The metrics of the v2 table from the tokens on :root and the v2 font
// (--font): headers in --fs-thead at --w-bold, upper case, with --ls-thead;
// status tags in --fs-xs at --w-semi with the dot and its gap (--dot-sm
// each) and --sp-2 on both sides. The sort button adds its padding
// (--sp-1 on both sides), the half gap and the arrow (ICON.arrow).
// Measured widths round up by 1px, so a fractional width never wraps.
export function domToolMetrics(): ToolMetrics {
  const root = getComputedStyle(document.documentElement);
  const px = (name: string) =>
    Number.parseFloat(root.getPropertyValue(name)) || 0;
  const family = root.getPropertyValue("--font").trim() || "sans-serif";
  const lang = document.documentElement.lang || undefined;
  const ctx = document.createElement("canvas").getContext("2d");
  const measure = (font: string, text: string) => {
    if (!ctx) return 0;
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  const head = px("--fs-thead");
  const spacing =
    (Number.parseFloat(root.getPropertyValue("--ls-thead")) || 0) * head;
  const bold = root.getPropertyValue("--w-bold").trim() || "700";
  const semi = root.getPropertyValue("--w-semi").trim() || "600";
  const small = px("--fs-xs");
  const dot = px("--dot-sm");
  const sp1 = px("--sp-1");
  return {
    header(label) {
      const text = label.toLocaleUpperCase(lang);
      return (
        Math.ceil(
          measure(bold + " " + head + "px " + family, text) +
            text.length * spacing,
        ) + 1
      );
    },
    tag(text) {
      return (
        Math.ceil(
          measure(semi + " " + small + "px " + family, text) +
            2 * dot +
            2 * px("--sp-2"),
        ) + 1
      );
    },
    button: px("--row-btn"),
    gap: sp1,
    pad: px("--sp-2"),
    edge: px("--sp-5"),
    select: px("--select-col"),
    title: px("--title-col-min"),
    sort: 2 * sp1 + sp1 / 2 + ICON.arrow,
    status: px("--tool-status-min"),
  };
}
