# Media servers and season outliers

## Independent Emby and Jellyfin connections

Settings → Services supports multiple named Emby and Jellyfin connections. Add a media player through the service-management dialog, choose its provider and configure its independent URL, encrypted key, path mappings and source Arr instances. Active instances have their own tabs. Disabled instances remain available for reactivation and are omitted from file details. See [named service instances](SERVICES.md).

Metadata enrichment reads `System/Info` and paginated `Items` with an `X-Emby-Token` header. Optional outbound tag synchronization adds narrowly scoped writes described in the [service guide](SERVICES.md); it is disabled by default. Jellyfin preserves the configured base URL, including subpaths. Emby adds `/emby` when that prefix is not already present. API keys never appear in browser responses or logs. No scan, probe, playback, media mount or refresh command is used. Jellyfin explicitly reported VideoRangeType profiles are normalized to HDR10, HDR10+, HLG and Dolby Vision; SDR and unspecified profiles do not imply HDR.

A full Radarr/Sonarr instance snapshot reads its selected enabled media servers in sequence. The provider buttons in System request a fresh library snapshot, including all enabled providers; they do not scan or refresh the media servers. An enabled provider failure rejects the new snapshot and keeps the last complete cache. Webhooks keep supplemental data only for an unchanged file identity, otherwise matching stays pending until the next full sync.

Matching uses a unique basename and positive identical byte size. Optional path mappings add a full-path requirement; alternate versions are matched to their own MediaSources. External audio and subtitles do not become audio tracks. Existing audio language codes are resolved through the bundled ISO registry.

Provider results are retained separately by immutable media-player instance ID in `mediaServers`. The combined result is matched if at least one provider supplies a unique track inventory and other uniquely matched providers agree. Different reported language/codec/channel inventories or incompatible known video resolution/codec-family/bit-depth values produce Conflicting media server metadata and fall back to filename/Arr traits, instead of creating nonexistent combinations. Differing stream order, indices, titles and default flags alone do not conflict. A provider with no audio inventory does not contradict a provider that reports tracks. Matching providers can contribute explicit HDR profiles. Details list only active providers. Legacy `embyMatch` and evidence fields remain available internally and in the API for cache/preset compatibility; their combined meaning is media-server matching, not Emby-only matching.

## Matching filters

Media server matching uses checkboxes with the same is/is-not operator as other status filters. Included states use OR with each other; excluded states are omitted, and other filter groups use AND. Available states: Matched, Not found (including missing byte size), Ambiguous, Conflicting media server metadata, Audio tracks missing, Pending and Without enrichment. Choose Matched → is not for the complement; a redundant All unsuccessful matches option is unnecessary. The former Unknown year control is removed; older saved queries remain valid.

## Season outliers

TV series has two checkbox/operator filters with hover, focus and tap-accessible question-mark explanations:

- **Technical outliers** compare resolution, codec family (H.264/H.265 rather than encoder labels), the set of audio codecs and the existing Channels value.
- **Language outliers** compare the complete set of known audio languages, including missing or additional languages relative to the season majority.

Each comparison uses the entire cached series/season within one Sonarr instance, never the currently filtered results or another instance with the same numeric series ID. At least three episodes are required. A baseline must have at least two agreeing episodes and represent strictly more than half of all cached episodes in that season. Unknown values do not support a baseline and are not flagged; partial unknown audio/language sets are skipped. Ties and evenly mixed seasons have no inferred baseline. A multi-episode file counts by its distinct associated episode IDs and is shown once. Specials use their separate season-0 group.

Nine 1080p HEVC E-AC-3 5.1 episodes and one 720p H.264 AAC 2.0 episode flag the latter as a technical outlier. Nine German/English episodes and one English-only episode flag the latter as a language outlier. Uniform seasons, or two 1080p episodes and two 720p episodes, are not flagged. Is not means not flagged, and includes unknowns; it does not prove that every physical episode is identical. Only files known to Sonarr are compared, not unavailable future/missing episodes.

Affected file rows and visible season headings are highlighted; file details show the differing attributes and majority values. Indexed `season_analysis` rows are refreshed atomically with full syncs, scoped webhook updates and recognition-rule reprocessing. Match-only lists, full-season context, CSV, presets and custom-tag bulk selections use the same predicates. CSV excludes context-only rows and adds both outlier flags. Schema 14 migrates cached seasons with a consistent pre-upgrade backup.

The first-party implementation references are [Jellyfin ItemsController](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Controllers/ItemsController.cs) and [Jellyfin MediaStream](https://typescript-sdk.jellyfin.org/interfaces/generated-client.MediaStream.html).

## Video metadata and matching summary (0.9.2)

The existing Items request already includes MediaSources and MediaStreams; no new endpoints, playback requests, probing or media-server scans are needed. Scopearr now retains the selected internal video stream's Width, Height, Codec, CodecTag, BitDepth and IsInterlaced values. A unique default video stream can disambiguate multiple internal video streams; otherwise enrichment is marked ambiguous. HDR comes from that same selected stream.

Filename recognition retains first priority. Since 1.5.1, verified media-server video values take priority over Radarr/Sonarr when the filename has no resolution, codec or bit depth. Evidence retains every source separately. Only filename versus measured media-server differences create metadata warnings; Radarr/Sonarr differences appear as muted information in file details. Codec comparison uses families, so AVC does not contradict x264. XVID/DivX/DX50 FourCC values distinguish MPEG-4 Part 2 variants; plain MPEG-4 remains generic. Pixel dimensions classify standard/cropped HD and UHD raster tiers; smaller nonstandard SD frames retain their actual line count (for example 576×244 → 244p), rather than inventing a DVD/480p source. Exact dimensions remain visible per provider. Cropped SD dimensions do not contradict an explicit 480/576-line label of the same scan mode, since the original raster cannot be reconstructed from the crop. Missing dimensions do not imply a resolution.

Aggregate channels use filename → media server → Radarr/Sonarr priority. Media-server values contain the distinct known layouts across every verified internal audio track, regardless of default-track flags. A known filename layout absent from that inventory creates a metadata disagreement warning; Arr-only differences remain informational. Stereo/mono/quad normalize to 2.0/1.0/4.0. Layout qualifiers in parentheses are retained in the cached track but omitted from the displayed layout: 5.1(side) → 5.1, 7.1(wide) → 7.1, 6.1(back) → 6.1 and 5.0(side) → 5.0. A count without a recognized layout is shown as, for example, 6 ch and never guessed as 5.1. The Channels column shows one row per verified audio track, in the same order as the Audio column, retaining duplicates and each track’s own missing values. Without verified tracks it displays the aggregate filename/Arr values. Aggregate channels retain the same compound filter, facet, count and outbound tag-sync logic. Each audio row retains its own language and codec. Source, processing and missing audio languages are not inferred from video streams.

The Dashboard summarizes each cached file exactly once:

- **Matched**: matched plus no_tracks. A unique file identity exists, regardless of metadata completeness.
- **Not found**: missing plus missing_size.
- **Needs review**: ambiguous plus conflicting.
- **Not checked**: pending plus unconfigured.

Each group has an accessible explanation; detailed states remain in filters and per-provider file details. Matching and metadata completeness answer different questions and are not expected to have the same totals. The summary counts files, not movie titles or individual episodes in multi-episode files. Existing mediaMatched presets still select the original matched state (with audio tracks), clearly named in the filter UI.

## Cropped resolution tiers and cache refresh (1.5.0)

Cropped widescreen and scope encodes keep their resolution tier. Scopearr checks the following table from top to bottom; the first matching width or height wins. Dimensions must both be positive. Interlaced streams use the same tier with an `i` suffix.

| Resolution tier | Minimum width or height |
| --- | --- |
| 4320p | Width ≥ 7600 or height ≥ 4200 |
| 2160p | Width ≥ 3800 or height ≥ 2000 |
| 1440p | Width ≥ 2500 or height ≥ 1400 |
| 1080p | Width ≥ 1900 or height ≥ 1000 |
| 720p | Width ≥ 1260 or height ≥ 700 |
| Below these thresholds | Actual line count, for example 576p, 544p or 244p |

For example, 1912 × 796 is 1080p, 3832 × 1600 is 2160p and 1272 × 532 is 720p. Exact dimensions remain visible in provider details. Emby and Jellyfin use the same classification, including when their cached results are compared.

On the first 1.5.0 start, Scopearr creates an Appdata backup for a populated cache and refreshes derived resolution, channel layouts and source disagreement flags. Empty caches need no refresh backup. No library sync, upstream request or media scan is required. Enabled tag synchronization is queued for reconciliation. The refresh commits atomically and runs once; if it fails, the old cache remains intact and startup continues, with another attempt on the next start. No schema or recognition-rule format changes are made, and rollback to 1.4.6 remains supported. A later full sync is still needed for older entries that never stored video dimensions.

Saved filters and presets retain their exact values: a `6 ch` filter may need changing to `5.1`, and a `720p` filter may match fewer files after cropped 1080p entries are corrected. Scopearr does not rewrite those presets.

Upgrades from versions that discarded video fields require a regular full library sync to acquire those fields. Existing caches remain readable. Saved media-server video values survive recognition reprocessing and unchanged-file webhook updates.

References: [Jellyfin MediaStream](https://typescript-sdk.jellyfin.org/interfaces/generated-client.MediaStream.html), [Emby VideoStream](https://dev.emby.media/reference/pluginapi/Emby.Media.Model.Streams.VideoStream.html).

## Metadata disagreements and cache refresh (1.5.1)

A metadata disagreement now means a filename value contradicts measured media-server metadata. Differences between media servers remain the separate **Conflicting media server metadata** matching state. Radarr/Sonarr differences alone never create a metadata warning, even when no media server is configured or no file is found. File details retain those differences as information. Existing metadata-disagreement filters, widgets and exported flags can therefore select fewer files.

When filename resolution, codec, bit depth or aggregate channels are missing, verified media-server values replace Arr fallbacks. Source and processing retain filename → Arr priority. Verified audio and language inventories retain their existing behavior. Outbound tags continue to follow the displayed values, so the existing reconciliation and removal-approval logic applies after refresh.

The first 1.5.1 start refreshes cached derived values once, without upstream reads or media scans. A populated cache receives an Appdata backup; empty caches need no backup. The refresh writes both the 1.5.0 and 1.5.1 markers together, so a direct upgrade from 1.4.6 runs one refresh and creates one refresh backup. Enabled tag synchronization is queued. Failures preserve the previous cache and allow startup to continue; the next start retries.

The JSON-only `apiDiffers` evidence flag introduces no schema or recognition-rule format change. Rollback to 1.5.0 remains supported: it ignores this optional flag, and the reduced conflict flags remain until that version next resolves the file metadata.

## Tag display preferences (0.9.3)

Settings → Display → Tag colors includes a Display checkbox between Count and Color. All values are visible by default. Save settings to persist changes. Turning a value off hides it from movie/episode table cells and the corresponding filter choices, independently for each category. It does not delete metadata, change stored presets or active predicates, modify CSV exports or outbound tag synchronization, or change statistics and assignment counts. Previously selected hidden filters remain removable through the active-filter chips. Settings previews, file details and Dashboard statistics stay available.

Codec frames require enabled tag-color recognition rules, including API-only codecs such as vp9. Metadata remains readable as plain text without a corresponding rule.

## Media-server entry links

The Info column includes a media-server link after the Radarr/Sonarr link by default. Settings → Display → List display icons controls its visibility and order. One enabled provider opens directly; multiple enabled providers use a keyboard-accessible picker, with unavailable matches disabled. Disabled providers are omitted.

A successful library sync retains the provider's `Id`, `SeriesId` and `ServerId` from the existing paginated Items response. Movies open the matched movie; episodes open their parent series. Emby uses `/web/index.html#!/item?id=…&serverId=…`, Jellyfin `/web/#/details?id=…&serverId=…`, under the configured server base URL. Links contain no API keys and use no-referrer/new-tab protection. Old cache entries need a full sync to acquire IDs. Missing or conflicting identities never produce guessed links. Stream metadata ambiguity does not invalidate an otherwise unique file identity.

References: [Emby BaseItemDto](https://dev.emby.media/reference/pluginapi/MediaBrowser.Model.Dto.BaseItemDto.html), [Jellyfin DTO service](https://github.com/jellyfin/jellyfin/blob/master/Emby.Server.Implementations/Dto/DtoService.cs).

## Optional SD presentation

Settings → Display → Additional settings groups known numeric progressive/interlaced resolutions below 720 lines as SD in dashboard statistics by default. Unknown, malformed and HD/UHD values remain separate. A dependent, initially disabled checkbox applies the same grouping to library cells and resolution choices. Disabling dashboard grouping also disables list/filter grouping.

SD is a virtual presentation/filter group (`__sd__`), not a replacement for stored metadata. Clicking its dashboard bucket opens the regular resolution filter even when list grouping is off. Existing exact low-resolution presets remain exact and removable; CSV selects the same matching files and exports their original resolution. Details, recognition evidence, technical season comparisons and outbound tags remain unchanged. No media-server queries or cache rewrites are needed when toggling these preferences.
