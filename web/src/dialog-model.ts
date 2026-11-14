import type { Confirmation } from "./confirmation";
import type { NotificationKind } from "./notifications";

// The dialogs as data (Phase 5d): each dialog's width class and whether its
// height is fixed (it loads content or has tabs, so the head and foot stay
// put and the body scrolls) or grows downward with its content. Type-only
// imports: this module sits in the start set. The paging code of the file
// dialog is in file-paging.ts, which only the library page imports.
export type DialogId =
  | "confirm"
  | "savePreset"
  | "autoTag"
  | "customTags"
  | "file"
  | "renameCompanions"
  | "muxOptions"
  | "muxStatus"
  | "muxLog"
  | "pathCheck"
  | "placementScan"
  | "targetDisks"
  | "placementReport"
  | "placementDetails"
  | "placementStatus"
  | "placementLog"
  | "fileCheckScan"
  | "fileCheckDetails"
  | "fileCheckCommands"
  | "fileCheckReport"
  | "fileCheckNames"
  | "addService"
  | "unraidPathCheck"
  | "password"
  | "ruleEditor"
  | "tagPolicy"
  | "tagReview"
  | "logEntry";
export type ModalSize = "sm" | "md" | "lg" | "file";

const sm = { size: "sm", height: "auto" } as const,
  md = { size: "md", height: "auto" } as const,
  lg = { size: "lg", height: "auto" } as const,
  mdFixed = { size: "md", height: "fixed" } as const,
  lgFixed = { size: "lg", height: "fixed" } as const;

export const DIALOGS: Readonly<
  Record<DialogId, { size: ModalSize; height: "auto" | "fixed" }>
> = {
  confirm: sm,
  savePreset: sm,
  autoTag: sm,
  password: sm,
  renameCompanions: md,
  fileCheckDetails: md,
  targetDisks: md,
  addService: md,
  unraidPathCheck: md,
  tagPolicy: md,
  logEntry: md,
  customTags: mdFixed,
  muxStatus: mdFixed,
  muxOptions: lg,
  pathCheck: lg,
  placementScan: lg,
  fileCheckScan: lg,
  placementReport: lg,
  fileCheckReport: lg,
  fileCheckCommands: lg,
  fileCheckNames: lg,
  ruleEditor: lg,
  muxLog: lgFixed,
  placementLog: lgFixed,
  placementDetails: lgFixed,
  placementStatus: lgFixed,
  tagReview: lgFixed,
  file: { size: "file", height: "fixed" },
};

// What ConfirmationDialog shows for a pending confirmation (catalog keys,
// as 1.7.0): the title, the action's label, its tone and its icon.
export type ConfirmationView = {
  title: string;
  action: string;
  tone: "primary" | "secondary" | "danger";
  icon: "trash" | "reset" | null;
};
export function confirmationView(
  p: Pick<Confirmation, "actionLabel" | "danger" | "reset" | "discard">,
): ConfirmationView {
  const plainAction = !!p.actionLabel && !p.danger;
  return {
    title: plainAction
      ? "Confirm action"
      : p.discard
        ? "Really cancel?"
        : p.reset
          ? "Restore defaults"
          : "Confirm deletion",
    action:
      p.actionLabel ||
      (p.discard ? "Discard changes" : p.reset ? "Restore defaults" : "Delete"),
    tone: plainAction
      ? "primary"
      : p.reset || p.discard
        ? "secondary"
        : "danger",
    icon: p.danger
      ? "trash"
      : p.actionLabel || p.discard
        ? null
        : p.reset
          ? "reset"
          : "trash",
  };
}

// A toast's tone, icon, role and time on screen: successes 5 s, warnings
// and errors 8 s, and a toast with a link 8 s too, so the link is reachable
// by keyboard (F3).
export type ToastView = {
  tone: "ok" | "warn" | "error";
  icon: "check" | "alert";
  role: "status" | "alert";
  duration: number;
};
export function toastView(kind: NotificationKind, linked: boolean): ToastView {
  return {
    tone: kind === "success" ? "ok" : kind === "warning" ? "warn" : "error",
    icon: kind === "success" ? "check" : "alert",
    role: kind === "error" ? "alert" : "status",
    duration: kind === "success" && !linked ? 5000 : 8000,
  };
}
