export type Service = "radarr" | "sonarr";
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
  service: Service;
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
    Service,
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
  services: Record<Service, StorageSnapshot>;
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
  cacheRevision?: string;
  webhooksEnabled?: boolean;
  webhook?: Record<
    Service,
    {
      lastSuccess?: string;
      lastReceived?: string;
      pending: number;
      error: string;
    }
  >;
  nextSync?: Record<Service, string | null>;
  releaseCheck?: {
    latest?: string;
    checkedAt?: string;
    successAt?: string;
    error: string;
    updateAvailable: boolean;
  };
  tagSync?: Record<
    Service,
    {
      lastTagCheck?: string;
      importPending?: number;
      importConflicts?: {
        service: Service;
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
  sync?: Record<Service, SyncStatus>;
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
