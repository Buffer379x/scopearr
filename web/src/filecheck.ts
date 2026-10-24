import type {
  FileCheckItem,
  FileCheckKind,
  FileCheckSettings,
  Settings,
  Status,
} from "./types";
export const fileCheckKinds: FileCheckKind[] = [
  "permissions",
  "owner",
  "hidden",
  "junk",
  "orphan",
  "untracked_media",
  "other",
  "empty_dir",
];
export const defaultFileCheckAllowed = [
  "movie.nfo",
  "tvshow.nfo",
  "season.nfo",
  "poster.*",
  "folder.*",
  "cover.*",
  "default.*",
  "movie.*",
  "show.*",
  "fanart.*",
  "backdrop*.*",
  "background.*",
  "art.*",
  "banner.*",
  "logo.*",
  "clearlogo.*",
  "clearart.*",
  "landscape.*",
  "thumb.*",
  "disc.*",
  "discart.*",
  "keyart.*",
  "season*-poster.*",
  "season*-banner.*",
  "season*-fanart.*",
  "season*-landscape.*",
  "season-all-*",
  "season-specials-*",
  "theme.*",
  "extrafanart/",
  "extrathumbs/",
  ".actors/",
];
export const defaultFileCheckSettings: FileCheckSettings = {
  libraries: [],
  kinds: [...fileCheckKinds],
  ownerUid: 99,
  ownerGid: 100,
  fileMode: "0666",
  dirMode: "0777",
  strict: false,
  takeOwnership: true,
  includeVideo: false,
  allowed: [...defaultFileCheckAllowed],
  ignore: [],
};
export const fileCheckModePresets = [
  {
    key: "unraid",
    label: "Unraid default (666 / 777)",
    file: "0666",
    dir: "0777",
  },
  { key: "group", label: "Group only (664 / 775)", file: "0664", dir: "0775" },
] as const;
export const fileCheckKindLabels: Record<FileCheckKind, string> = {
  permissions: "Permissions",
  owner: "Owner",
  hidden: "Hidden",
  junk: "Junk",
  orphan: "Orphaned",
  untracked_media: "Untracked video",
  other: "Other file",
  empty_dir: "Empty folder",
};
export const fileCheckKindHelp: Record<FileCheckKind, string> = {
  permissions:
    "Scopearr cannot read and write this item, or its mode differs from the target.",
  owner: "The owner differs from the configured user and group.",
  hidden: "Hidden file or folder (name starts with a dot).",
  junk: "System leftovers such as .DS_Store, Thumbs.db or @eaDir.",
  orphan: "Companion file whose name matches no video in this folder.",
  untracked_media: "Video file that Radarr/Sonarr does not manage.",
  other: "File that is neither a video nor a known companion file.",
  empty_dir: "Folder without any content.",
};
export const fileCheckColumns = [
  "select",
  "actions",
  "title",
  "path",
  "kind",
  "current",
  "fix",
  "status",
  "progress",
  "remove",
];
export const fileCheckColumnLabels: Record<string, string> = {
  select: "Selection",
  actions: "Actions",
  title: "Title",
  path: "Path",
  kind: "Kind",
  current: "Current",
  fix: "Fix",
  status: "Status",
  progress: "Progress",
  remove: "Remove",
};
// Header label → server sort field.
export const fileCheckSortFields: Record<string, string> = {
  progress: "progress",
  title: "title",
  path: "path",
  kind: "kind",
  current: "size",
  fix: "fix",
  status: "status",
};
export function filesTabVisible(status: Pick<Status, "files">) {
  return !!status.files?.available;
}
export function fileCheckStatus(
  item: Pick<FileCheckItem, "jobStatus" | "fix">,
) {
  return item.jobStatus || (item.fix === "manual" ? "manual" : "open");
}
export const fileCheckStatusLabels: Record<string, string> = {
  open: "Open",
  manual: "Manual",
  queued: "Queued",
  running: "Fixing",
  succeeded: "Fixed",
  failed: "Failed",
  cancelled: "Cancelled",
  needs_review: "Review",
};
export const fileCheckStatusTone: Record<string, string> = {
  open: "ok",
  manual: "warn",
  queued: "wait",
  running: "running",
  succeeded: "ok",
  failed: "error",
  cancelled: "neutral",
  needs_review: "warn",
};
export function fileCheckFixable(
  item: Pick<FileCheckItem, "fix" | "jobStatus">,
) {
  return item.fix !== "manual" && ["", "failed"].includes(item.jobStatus);
}
export function fileCheckFixLabel(
  item: Pick<FileCheckItem, "fix" | "dir">,
  settings: FileCheckSettings,
) {
  if (item.fix === "chmod")
    return (
      "chmod " + (item.dir ? settings.dirMode : settings.fileMode).slice(1)
    );
  return {
    take_ownership: "Take ownership",
    delete: "Delete",
    manual: "Manual",
  }[item.fix];
}
// "drwxr-xr-x" style rendering of a Go FileMode (directory bit is 1 << 31).
export function fileCheckModeText(mode: number, dir: boolean) {
  const bits = "rwxrwxrwx";
  let text = dir ? "d" : "-";
  for (let n = 0; n < 9; n++) text += mode & (1 << (8 - n)) ? bits[n] : "-";
  return text;
}
export function fileCheckOrderedColumns(settings: Settings | null) {
  const order = settings?.filecheckColumnOrder || fileCheckColumns;
  const visible = settings?.filecheckVisibleColumns || fileCheckColumns;
  return [
    "select",
    ...order.filter(
      (key) =>
        key !== "select" &&
        fileCheckColumns.includes(key) &&
        visible.includes(key),
    ),
  ];
}
