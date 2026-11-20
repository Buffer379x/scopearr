import {
  fileCheckStatus,
  fileCheckStatusLabels,
  fileCheckStatusTone,
} from "./filecheck";
import {
  effectiveMuxStatus,
  muxStatusLabels,
  muxStatusShort,
} from "./mux-spec";
import {
  placementCheckBlocker,
  placementItemStatus,
  placementStatusDescriptions,
  placementStatusLabels,
  placementStatusShort,
  placementStatusTone,
} from "./placement";
import { placementMessage } from "./placement-messages";
import { PLACEMENT_WAITS } from "./tool-columns";
import type { FileCheckItem, MuxJob, PlacementItem } from "./types";

// What a status tag of a tool shows (docs/STYLEGUIDE.md, Part 1, 10.7):
// its tone, its short text and its long text (the title), with the 1.7.0
// texts of each tool; one source for the v2 StatusTag and, until Phase 5d,
// the 1.7.0 dialog tags.

type Translate = (
  key: string,
  parameters?: Record<string, string | number>,
) => string;

export type ToolTone =
  "ok" | "warn" | "wait" | "error" | "info" | "running" | "neutral";
export type ToolStatusView = {
  tone: ToolTone;
  text: string;
  long: string;
  blocker?: string;
};

// The tone of each effective mux status's tag; any other status is
// neutral. It lives with the views, in the tool chunks, not with mux-spec,
// which the library chunk holds.
export const muxStatusTone: Readonly<Record<string, string>> = {
  ready: "ok",
  succeeded: "ok",
  warning: "warn",
  needs_review: "warn",
  failed: "error",
  needs_attention: "error",
  queued: "wait",
  running: "running",
};

const tone = (value: string | undefined) => (value || "neutral") as ToolTone;

// The effective status (a draft, ready, failed or cancelled job with a
// failed check is a warning), its short text and its label as the title.
export function muxStatusView(
  job: Pick<MuxJob, "status" | "check">,
  t: Translate,
): ToolStatusView {
  const status = effectiveMuxStatus(job);
  return {
    tone: tone(muxStatusTone[status]),
    text: t(muxStatusShort[status] || status),
    long: t(muxStatusLabels[status] || status),
  };
}

// The job's status, else the scan's; a queued move held by the mover or a
// parity operation shows that message as its text (Design 11.2). The title
// is its description or label with the job's message, and the blocker of
// a stored check.
export function placementStatusView(
  item: Pick<PlacementItem, "scanStatus" | "jobStatus" | "message" | "check">,
  t: Translate,
): ToolStatusView {
  const status = placementItemStatus(item);
  const long = t(
    placementStatusDescriptions[status] ||
      placementStatusLabels[status] ||
      status,
  );
  const blocker = placementCheckBlocker(item.check);
  const waits = status === "queued" && PLACEMENT_WAITS.includes(item.message);
  return {
    tone: tone(placementStatusTone[status]),
    text: waits ? t(item.message) : t(placementStatusShort[status] || status),
    long: item.message
      ? long + " · " + placementMessage(item.message, t)
      : long,
    ...(blocker ? { blocker: t(blocker) } : {}),
  };
}

// Open, Manual or the job's status; the title is the job's message.
export function fileCheckStatusView(
  item: Pick<FileCheckItem, "jobStatus" | "fix" | "message">,
  t: Translate,
): ToolStatusView {
  const status = fileCheckStatus(item);
  const text = t(fileCheckStatusLabels[status] || status);
  return {
    tone: tone(fileCheckStatusTone[status]),
    text,
    long: item.message ? t(item.message) : text,
  };
}

// Every text a status tag of the tool can show (the measuring list): it
// lives with the column widths, so measuring them pulls in no message
// formatting (placement-messages stays its own chunk).
export { toolStatusTexts } from "./tool-columns";
