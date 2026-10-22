export type Service = "radarr" | "sonarr";
export type ServiceType = Service | "emby" | "jellyfin";
export type ServiceInstance = Connection & {
  id: string;
  type: ServiceType;
  name: string;
};
export type TagGroups = Record<
  | "resolution"
  | "codec"
  | "source"
  | "hdr"
  | "bitDepth"
  | "audio"
  | "channels"
  | "language"
  | "custom",
  boolean
>;
export type Connection = {
  id?: string;
  type?: ServiceType;
  name?: string;
  sourceIds?: string;
  tagImport?: boolean;
  tagImportInterval?: number;
  syncStart?: string;
  webhookEnabled?: boolean;
  tagSyncMode?: "add" | "replace";
  tagSyncDisable?: "keep" | "delete";
  tagSync?: TagGroups;
  enabled: boolean;
  url: string;
  apiKey?: string;
  hasKey: boolean;
  clearKey?: boolean;
  pathMappings?: string;
  interval: number;
};
export type Settings = {
  unraid?: UnraidSettings;
  fileCheck?: FileCheckSettings;
  filecheckColumnOrder?: string[];
  filecheckVisibleColumns?: string[];
  placementColumnOrder?: string[];
  placementVisibleColumns?: string[];
  mux?: MuxSettings;
  instances?: ServiceInstance[];
  groupSD?: boolean;
  groupSDLists?: boolean;
  pageSize: number;
  syncTimezone: string;
  widgets: WidgetSettings;
  listInfoOrder: string[];
  listInfoVisible: string[];
  interfaceTheme: string;
  columnOrder: Record<Service, string[]>;
  visibleColumns: Record<Service, string[]>;
  warningColors: Record<string, string>;
  tagColors: Record<string, string>;
  tagTextColors: Record<string, string>;
  hiddenTags?: Record<string, boolean>;
  radarr: Connection;
  sonarr: Connection;
  emby: Connection;
  jellyfin: Connection;
  seasonMode: "matches" | "season";
};
export type Evidence = {
  filename: string;
  api: string;
  emby?: string;
  origin: string;
  conflict: boolean;
  rules?: string[];
};
export type CustomTag = {
  displayName?: string;
  count?: number;
  id: number;
  name: string;
  manual?: boolean;
  protected?: boolean;
  rules?: string[];
  sources?: string[];
  localRule?: boolean;
};
export type CustomSelection = {
  total: number;
  counts: Record<string, number>;
  tags: CustomTag[];
};
export type MediaFile = {
  informationOnly?: Record<string, string[]>;
  custom: CustomTag[];
  id: number;
  service: string;
  type?: Service;
  instanceName?: string;
  mediaId: number;
  titleSlug?: string;
  title: string;
  series: string;
  season: number;
  episodes: { id: number; number: number; title: string; year: number }[];
  years: number[];
  filename: string;
  resolution: string;
  codec: string;
  family: string;
  source: string;
  processing: string;
  hdr: string;
  bitDepth: string;
  audio: string;
  audioStreamCount: number;
  audioTracks?: {
    index: number;
    language: string;
    codec: string;
    channels: number;
    channelLayout: string;
    title: string;
    default: boolean;
  }[];
  embyMatch?: string;
  mediaServers?: Record<
    string,
    {
      status: string;
      itemId?: string;
      sourceId?: string;
      itemType?: string;
      link?: { itemId: string; serverId: string };
      hdr?: string;
      video?: {
        width?: number;
        height?: number;
        resolution?: string;
        codec?: string;
        bitDepth?: string;
      };
      tracks?: MediaFile["audioTracks"];
    }
  >;
  mediaOrigin?: string;
  seasonOutlier?: boolean;
  languageOutlier?: boolean;
  seasonReasons?: Record<string, string>;
  channels: string;
  language: string;
  size: number;
  conflict: boolean;
  ruleConflict: boolean;
  recognitionConflicts?: RecognitionConflict[];
  evidence: Record<string, Evidence>;
  matched: boolean;
  unknownTraits?: string[];
  metadataIncomplete: boolean;
};
export type Results = {
  files: MediaFile[];
  total: number;
  displayTotal: number;
  page: number;
  pageSize: number;
};
export type SyncStatus = {
  running: boolean;
  queued: boolean;
  lastAttempt: string | null;
  lastSuccess: string | null;
  error: string;
  count: number;
};
export type WidgetSettings = {
  order: string[];
  visible: string[];
  storage: Record<
    string,
    { path: string; sharedGroup: string; name?: string }[]
  >;
  colors: Record<string, string>;
};
export type StorageSnapshot = {
  disks: {
    path: string;
    label: string;
    totalSpace: number;
    freeSpace: number;
  }[];
  checkedAt?: string;
  error: string;
};
export type StorageData = {
  services: Record<string, StorageSnapshot>;
  areas: Record<
    string,
    {
      key: string;
      label: string;
      paths: string[];
      total: number;
      free: number;
      used: number;
      error: string;
    }[]
  >;
};
export type Status = {
  unraid?: { enabled: boolean };
  files?: { available: boolean; pending: number; running: number };
  mux?: {
    enabled: boolean;
    installed: boolean;
    pending: number;
    running: number;
    failed: number;
  };
  serviceNames?: Record<string, string>;
  cacheRevision?: string;
  webhooksEnabled?: boolean;
  webhook?: Record<
    string,
    {
      lastSuccess?: string;
      lastReceived?: string;
      pending: number;
      error: string;
    }
  >;
  nextSync?: Record<string, string | null>;
  releaseCheck?: {
    latest?: string;
    checkedAt?: string;
    successAt?: string;
    error: string;
    updateAvailable: boolean;
  };
  tagSync?: Record<
    string,
    {
      lastTagCheck?: string;
      importPending?: number;
      importConflicts?: {
        service: string;
        mediaId: number;
        remoteId: number;
        label: string;
        desired: boolean;
      }[];
      running: boolean;
      pending: boolean;
      error: string;
      lastSuccess?: string;
      changed: number;
      retainedDefinitions?: number;
      approvalRequired?: boolean;
    }
  >;
  initialized: boolean;
  authenticated: boolean;
  version: string;
  demo: boolean;
  recognitionRevision?: string;
  csrf?: string;
  sync?: Record<string, SyncStatus>;
};
export type Preset = {
  id: number;
  name: string;
  service: Service;
  query: string;
};

export type Statistics = {
  fileTotals: Record<string, number>;
  languageTotals: Record<string, number>;
  movies: number;
  series: number;
  episodes: number;
  files: number;
  emby: Record<string, number>;
  incomplete: number;
  distributions: Record<
    string,
    Record<string, { value: string; count: number }[]>
  >;
};
export type FilmSort = { field: string; direction: "asc" | "desc" };

export type RecognitionRule = {
  tag?: boolean;
  id: string;
  name: string;
  field: string;
  match: "token" | "regex";
  pattern: string;
  value: string;
  mode: "direct" | "fallback" | "override";
  priority: number;
  enabled: boolean;
  consume: boolean;
  unless?: string;
  comparisonPattern?: string;
};
export type RecognitionConfig = { rules: RecognitionRule[]; revision: string };
export type RecognitionConflict = {
  field: string;
  values: string[];
  rules: string[];
  ruleNames: string[];
};
export type RecognitionResult = {
  values: Record<string, string>;
  matches: Record<string, string[]>;
  origins: Record<string, string>;
  conflicts: RecognitionConflict[];
};

export type MuxSettings = {
  workDir: string;
  enabled: boolean;
  channel: "stable" | "edge";
  mappings: string;
  pathMappings?: Record<string, string>;
  deleteOriginal: boolean;
  notifyMedia: boolean;
  keepFinished: number;
};
export type MuxToolStatus = {
  installed: boolean;
  version: string;
  package: string;
  channel: string;
  branch: string;
  arch: string;
  available: string;
  updateAvailable: boolean;
  upstream: string;
  checkedAt?: string;
  busy: string;
  error: string;
  sizeBytes: number;
};
export type MuxTrack = {
  id: number;
  type: string;
  codec: string;
  language: string;
  name: string;
  default: boolean;
  forced: boolean;
  channels?: number;
  dimensions?: string;
  enabled: boolean;
};
export type MuxTrackSpec = {
  keep: boolean;
  language: string;
  name: string;
  default: boolean;
  forced: boolean;
};
export type MuxSpec = {
  outputName: string;
  deleteOriginal: boolean;
  tracks: Record<number, MuxTrackSpec>;
  chapters: boolean;
  attachments: boolean;
};
export type MuxCheck = {
  outputDisk?: string;
  diskConflict?: boolean;
  workWritable: boolean;
  workFreeSpace: boolean;
  exists: boolean;
  readable: boolean;
  writable: boolean;
  freeSpace: boolean;
  sizeMatches: boolean;
  unchanged: boolean;
};
export type MuxJob = {
  id: number;
  service: string;
  fileId: number;
  mediaId: number;
  title: string;
  sourceName: string;
  status: string;
  revision: number;
  spec: MuxSpec;
  source: {
    outputDisk?: string;
    container: string;
    durationNs: number;
    tracks: MuxTrack[];
    chapters: number;
    attachments: number;
    size: number;
    modTime: string;
  };
  check: MuxCheck;
  progress: number;
  message: string;
  log: string;
  backupName: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
};

export type MuxRootFolder = {
  arrPath: string;
  instances: string[];
  mapped: boolean;
  localPath: string;
  localExists: boolean;
  suggestion: string;
};
export type MuxRootFolders = {
  rootFolders: MuxRootFolder[];
  errors: { instance: string; error: string }[];
};
export type MuxPathChecks = MuxRootFolders & {
  syntax: { ok: boolean; line?: number; error?: string };
  mappings: {
    arrPath: string;
    localPath: string;
    exists: boolean;
    isDir: boolean;
    readable: boolean;
    writable: boolean;
    freeBytes: number;
    error?: string;
  }[];
  samples: {
    instance: string;
    checked: number;
    reachable: number;
    sizeMatches: number;
  }[];
  workDir: {
    configured: boolean;
    exists: boolean;
    writable: boolean;
    freeBytes: number;
  };
  timedOut?: boolean;
};

export type UnraidSettings = {
  enabled: boolean;
  diskRoot: string;
  shareRoot: string;
  stateDir: string;
  muxSameDisk: boolean;
  libraries: string[];
  seriesGrouping: "series" | "season";
  excludedDisks: string[];
  reserveGB: number;
  reserveGiB?: number;
  verifyChecksum: boolean;
};
export type UnraidDisk = {
  name: string;
  kind: "array" | "pool";
  total: number;
  free: number;
  writable: boolean;
  excluded: boolean;
};
export type UnraidState = {
  known: boolean;
  mover: boolean;
  parity: boolean;
  warning?: string;
};
export type UnraidStatus = {
  enabled: boolean;
  ready: boolean;
  error?: string;
  disks: UnraidDisk[];
  state: UnraidState;
  fileWork: string;
};
export type UnraidPathChecks = {
  root: boolean;
  share: boolean;
  checked: number;
  found: number;
  disks: UnraidDisk[];
  state: UnraidState;
  warnings: string[];
  error?: string;
};
export type PlacementFile = {
  disk: string;
  rel: string;
  size: number;
  mtime: number;
  atime: number;
  mode: number;
  uid: number;
  gid: number;
  dir?: boolean;
};
export type PlacementCheck = {
  reachable: boolean;
  writable: boolean;
  freeSpace: boolean;
  unchanged: boolean;
  noConflict: boolean;
  owner: boolean;
  state: UnraidState;
};
export type PlacementItem = {
  id: number;
  itemKey: string;
  service: string;
  instance: string;
  mediaId: number;
  season?: number;
  title: string;
  rel: string;
  scanStatus: string;
  kind: string;
  target: string;
  totalBytes: number;
  moveBytes: number;
  moveFiles: number;
  disks: Record<string, { bytes: number; files: number; dirs: number }>;
  files?: PlacementFile[];
  warnings: string[];
  jobStatus: string;
  queuePos?: number;
  progress: number;
  bytesDone: number;
  message: string;
  updatedAt: string;
  finishedAt?: string;
  check?: PlacementCheck;
};
export type PlacementTarget = {
  target: string;
  items: number;
  smallFiles: number;
  mediaFiles: number;
  moveBytes: number;
  sources: Record<string, number>;
};
export type PlacementScan = {
  running: boolean;
  startedAt: string;
  finishedAt: string;
  duration: number;
  checked: number;
  total: number;
  ok: number;
  several: number;
  smallFiles: number;
  moveBytes: number;
  unstartable: number;
  disk: string;
  error: string;
  counts: Record<string, number>;
  targets: PlacementTarget[];
  options: UnraidSettings;
};
export type PlacementActivity = {
  scan: PlacementScan;
  queued: number;
  running: number;
  moved: number;
  bytesDone: number;
  totalBytes: number;
  fileWork: string;
  counts?: Record<string, number>;
};
export type PlacementResults = {
  items: PlacementItem[];
  total: number;
  selectableIds: number[];
};
export type FileCheckKind =
  | "permissions"
  | "owner"
  | "hidden"
  | "junk"
  | "orphan"
  | "untracked_media"
  | "other"
  | "empty_dir";
export type FileCheckSettings = {
  libraries: string[];
  kinds: FileCheckKind[];
  ownerUid: number;
  ownerGid: number;
  fileMode: string;
  dirMode: string;
  strict: boolean;
  takeOwnership: boolean;
  includeVideo: boolean;
  allowed: string[];
  ignore: string[];
};
export type FileCheckItem = {
  id: number;
  service: string;
  instance: string;
  mediaId: number;
  title: string;
  rel: string;
  dir: boolean;
  kind: FileCheckKind;
  fix: "chmod" | "take_ownership" | "delete" | "manual";
  size: number;
  mode: number;
  uid: number;
  gid: number;
  mtime: number;
  note: string;
  jobStatus: string;
  queuePos: number | null;
  progress: number;
  message: string;
  updatedAt: string;
  finishedAt: string | null;
};
export type FileCheckScan = {
  running: boolean;
  startedAt: string;
  finishedAt: string;
  duration: number;
  checked: number;
  total: number;
  files: number;
  findings: number;
  bytes: number;
  kinds: Record<string, number>;
  fixes: Record<string, number>;
  items: number;
  error: string;
};
export type FileCheckActivity = {
  ready: boolean;
  error: string;
  physical: boolean;
  scan: FileCheckScan;
  counts: Record<string, number>;
  queued: number;
  running: number;
  fixed: number;
  fileWork: string;
};
export type FileCheckResults = {
  items: FileCheckItem[];
  total: number;
  selectableIds: number[];
};
