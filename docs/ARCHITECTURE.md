# Architecture and HTTP API

Go serves embedded Preact/TypeScript assets and JSON endpoints from one origin. SQLite via `modernc.org/sqlite` requires no CGO. `/data` is the only required persistent mount. No external fonts, telemetry, CDN assets, media mounts or separate database server are required.

## Storage and metadata

`files` stores immutable service-instance/file IDs, media ID, series/season associations, indexed normalized fields and the full file record as JSON. `years` supports multiple episode years. FTS5 `search` indexes title, series and filename. `file_languages` indexes normalized language membership, including partially unknown tracks. `kv` holds settings, filename-recognition rules, account and sync status; `presets` and `sessions` are separate tables. `PRAGMA user_version` tracks schema changes; backups precede existing-database migrations and unknown future schemas are rejected.

Each attribute’s `evidence` retains normalized filename, Arr API and optional Emby values, selected origin (`filename`, `rule`, `api`, `emby`, `combined`, `unknown`) and conflict. Original filenames are preserved; not every raw upstream response is archived. Titles/years come from Radarr; episode names, seasons and first-air years from Sonarr. Existing quality and MediaInfo attributes supplement filename tokens; Scopearr never invokes media analysis unless the optional MKVToolNix service is enabled. Pixel dimensions alone do not establish a quality class.

Audio, language and HDR attributes are component sets. Codec aliases share a family without collapsing explicit encoder distinctions. Additional explicitly reported languages enrich filename languages without inventing a per-track codec. Unknown track attributes set `unknownTraits`; `metadataIncomplete` considers resolution, codec, source, audio, language and failed configured Emby matching. Missing HDR alone may mean SDR or unknown and does not make metadata incomplete. Negative filters describe missing **reported** attributes, not proven absence.

## Named instances (1.1)

Canonical settings expose an ordered `instances` array. Each connection carries an immutable provider-prefixed `id`, its `type`, optional `name` and `sourceIds` (comma-separated Arr IDs; empty means all enabled sources). Legacy fixed-provider settings remain compatible. Secret retention, cached file IDs, custom overrides, schedules, webhooks, storage, previews and tag ownership are scoped by instance, not by display name or array position. Aggregate query `service=radarr|sonarr` includes that provider type; optional `instance=<id>` narrows it. CSV appends instance identity and display name. Existing legacy instance IDs retain their webhook URLs.

Media matches retain real movie/episode item IDs separately from series navigation links, along with media-source identity. Outbound desired values are combined per player instance and destination item before a write, with source-instance selection and fresh destructive approvals. See [service instances](SERVICES.md).

## Sync

Radarr loads the movie catalog, then movie files in batches of 100 movie IDs. Sonarr loads the series catalog, then episodes/files per series with at most two concurrent GET requests; series are processed sequentially. One global queue builds one service snapshot at a time. Each HTTP request has a 20-second timeout and up to three attempts for network/5xx errors. Redirects are rejected to prevent key forwarding.

Data is gathered in memory, validated and committed only after a complete successful fetch. A transaction replaces the service files, search index and year mappings atomically. WAL readers observe a complete state; pagination counts and rows share one read transaction. Settings/dispatch are locked together; changed configuration cancels old generations and prevents stale commits. A multi-request upstream catalog is not a transactional snapshot, so detected identity inconsistencies fail and retain the previous cache.

Facet and dashboard caches are defensively copied immutable snapshots, invalidated after successful commits. Queries carry cancellation contexts to SQLite. Frontend request generations and abort controllers reject stale results. Polling pauses in hidden tabs; intervals are 3 seconds during sync, 30 seconds when idle/authenticated and 60 seconds on login.

The catalog is also a defensively copied cache. Its GET path uses a read-only snapshot; data/rule writes retain historical display values inside their own transaction. Aggregate fills have separate locks and publish only if their invalidation generation still matches. Library counts/rows and dashboard widgets use explicit read-only transactions, allowing WAL readers alongside a writer.

`Server.mu` protects only the in-memory configuration. `settingsMu` serializes settings and presentation changes; operations needing the sync gate acquire it first. Store writes never hold `Server.mu`. Recognition changes acquire `recognitionMu` before opening a write transaction; reconciliation takes a protected immutable rules snapshot before opening its transaction. Sync status locks cover only short state updates and the generation-checked commit, so cancellation and status reads remain available during snapshot construction.

Routing/authentication remain in `server.go`, with named endpoint handlers in `server_*.go` and CSV handling in `export.go`. Store opening and historical migrations live in `store_open.go`; query filters, ordering, results, facets and statistics have focused files. Existing 0.5.x rule migrations remain explicitly separated from current display logic. Frontend settings sections, table rendering and the rule editor retain their existing markup in separate components. The authenticated application, settings and recognition page load on demand; the full language registry remains available after login.

## Endpoints

Cold Dashboard queries use a compact expression index for episode associations and metadata completeness, avoiding full evidence/audio JSON scans. SQLite maintains the expressions automatically on file writes; the index is additive and contains no new canonical state.

Optional outbound tag reconciliation shares the file-sync gate. Schema 9 records managed resources by URL fingerprint, group retention/deletion states, observed labels, custom ownership and independent cleanup intent. Settings and policy transitions commit together. Both append and overwrite use targeted add/remove editor operations; overwrite removes the reviewed existing set while preserving new concurrent additions. Kept groups survive future syncs until a newly confirmed overwrite releases them. Cleanup verifies fresh usage details and relies on the upstream in-use deletion guard; blocked definitions remain queued for a later file sync. See [tag synchronization](TAG-SYNC.md).

| Method/path                      | Purpose                                              |
| -------------------------------- | ---------------------------------------------------- |
| GET `/healthz`                   | Public process health and version                    |
| GET `/api/status`                | Setup/auth state; authenticated CSRF and sync status |
| POST `/api/setup`                | One-time admin setup with token                      |
| POST `/api/login`, `/api/logout` | Create/revoke session                                |
| GET/PUT `/api/settings`          | Masked settings / encrypted persistence              |
| POST `/api/test`                 | Read-only upstream system-status test                |
| POST `/api/sync`                 | Queue asynchronous service sync                      |
| GET `/api/files`                 | Paginated matches/season context                     |
| GET `/api/statistics`            | Counts/distributions from one cached snapshot        |
| GET `/api/facets`                | Available values in the entire service cache         |
| GET/POST/DELETE `/api/presets`   | Read/create/delete named presets                     |
| GET `/api/export`                | Complete CSV of actual matches                       |
| PUT `/api/password`              | Change password and revoke sessions                  |
| POST `/api/backup`               | Consistent local database snapshot                   |

Except public status, health, setup and login, endpoints require a session. Mutations require `X-CSRF-Token`; foreign Origin headers are rejected. Cookies are HttpOnly, SameSite Strict, valid for 24 hours, and Secure when TLS/HTTPS is configured. API-key response fields stay empty; only `hasKey` indicates presence. Upstream bodies and keys are never exposed in errors. Password writes and session invalidation are transactional; session creation verifies the authenticated password hash again to prevent delayed old-password sessions after a concurrent reset.

## Queries and CSV

Files/export share parameterized filtering: `service=radarr|sonarr`, `q`, `yearMin`, `yearMax`, `resolution`, `codec`, `family`, `source`, `processing`, `hdr`, `bitDepth`, `audio`, `channels`, `language`, `sizeMin`, `sizeMax`, `unknownYear=true`, `unknownSize=true`, `conflict=true|false`, `metadata=complete|incomplete`.

Multiple values of an ordinary field use OR; different fields use AND. `<field>Op=eq|not` includes or negates the entire selected set. Audio/HDR/language also allow `all|notAll`, combining component conditions with AND or negating that complete combination. Invalid, repeated or inappropriate operators are rejected; an operator without values has no effect. `__unknown__` selects empty or partially unknown audio/language attributes. Sizes are bytes, displayed in decimal GB. FTS search uses sanitized AND-prefix terms, not arbitrary substrings or user FTS syntax.

Files use `page>=1`, 100 rows per page and optional `mode=matches|season`. `total` counts actual matches, `displayTotal` includes context and `matched` identifies real matches. Series sort by title, season and episode. Movie sort allowlist: title/year/resolution/codec/source/size/hdr/bitDepth/audio/channels/language, with `dir=asc|desc`. Default: title ascending. Numeric attributes sort numerically; unknowns stay last.

CSV applies the same filters/sort, UTF-8 BOM, semicolon separator and spreadsheet-formula safeguards. A protected temporary Appdata file completes before download; SQL/JSON/write errors fail rather than deliver a partial success. Cancellation/success removes temporary files. Context-only rows are excluded. Headers use `Accept-Language` or `lang`; media values stay canonical.

## Emby

Emby config has enable/URL/encrypted key and `interval=0`; it joins each Arr service sync. The client permits only GET `System/Info` and paginated `Items` using `X-Emby-Token`, 250 items per page. Subpaths are supported. Totals, page completeness and duplicate IDs are validated; only relevant candidates stay in memory.

Identity requires a unique exact basename and positive byte size on both sides. Multiple versions use the matching MediaSource. Item-level streams belong only to the exact matching source path. Optional absolute prefix mappings require the full mapped path too; longest Arr prefix wins. Unmatched/ambiguous identities remain explicit. Metadata paths are never opened unless optional MKVToolNix editing is enabled; Arr source file paths are not returned to browsers. The authenticated mux root-folder import/check endpoints are an explicit exception for configured **root folders**, which are needed to configure mounts; sample results contain counts only.

Only internal audio streams count: index, explicitly reported language, codec/profile, channels/layout, title and default flag. Languages are never inferred from track titles. Unique Emby tracks provide audio/language sets; if all values of an attribute are unknown, existing filename/Arr data remains without assigning it to tracks. The main Channels column retains filename/Arr data; details show each track. Explicit Emby video HDR supplements reported tags; profile numbers never imply an invented HDR10 fallback. Emby failures abort the enriched service snapshot.

## Presentation, translations and versioning

Settings store visible columns and the complete eleven-column order independently per service. Title/episode remains visible. Unknown/duplicate/missing columns and invalid services are rejected. Header/cells share one ordered list; temporary “All columns” does not change defaults. Tag backgrounds are validated hex values with automatic text contrast. Optional text overrides accept only black or white; both maps persist in the existing settings JSON without a schema migration. Filter presets remain canonical SQLite data independent of display language.

The dashboard opens after login. Distribution-tag buttons replace the target library’s current in-memory query and select the corresponding value in the existing controls. The panel expands, with no separate drilldown banner. The other library’s filters remain independent. The combined statistics scope uses the currently selected library; movie/TV scopes choose explicitly. Reload clears unsaved filters. Presets change only when explicitly saved or selected.

JSON catalogs are discovered at build time, including future contributed languages. English keys are stable message identifiers with named placeholders and plain-text values. Go embeds the same catalogs for API errors/CSV. `Accept-Language` negotiation supports regional fallback and quality weights. UI preferences use browser storage; canonical media/filter values are never translated in storage. See [translation guide](TRANSLATING.md).

Root `VERSION` is embedded by Go, checked against package/Docker defaults and validated by CI against released tags. Release inputs must match source. Checked-in English notes feed GitHub releases before stable promotion. See [releasing](RELEASING.md).

## Recognition rules (0.3.0)

Schema 5 stores original API traits, a recognition revision, rule conflicts, indexed Emby matching states and indexed language membership. Built-in parser defaults seed a persisted ruleset only when none exists. Go RE2 rules are bounded to 256 entries, compiled once and grouped by attribute and mode. Direct, fallback and override phases are deterministic; scalar conflicts are independent of metadata disagreements. Compound audio/HDR/language results are additive.

Authenticated GET `/api/recognition` and `/api/recognition/defaults` expose rule configuration. CSRF-protected POST `/api/recognition/preview` compiles a draft and recognizes one filename without saving. PUT `/api/recognition` requires `{rules, revision}`. A stale revision returns 409. A serialized writer commits rule configuration, normalized file JSON, indexed fields and language membership together, then invalidates aggregate caches. Reprocessing uses batches of 250 rows and a consistent backup, without upstream requests. This atomic bulk operation has a bounded five-minute budget; an expired budget rolls back the rewrite and returns HTTP 503. Ordinary query budgets remain unchanged. Sync commits acquire the same writer lock and reparse with the current rules, preserving cached Emby tracks and HDR. Files with cached media-server matches are enriched once through the media resolver rather than recognizing the filename twice.

Files/CSV/presets share `conflict=true|false`, `ruleConflict=true|false` and `embyMatch=unmatched|matched|missing|ambiguous|missing_size|no_tracks|unconfigured`. `unmatched` includes attempted matching failures and excludes unconfigured enrichment. The unified Audio column does not alter the separate `audio` and `language` filter parameters. Legacy language aliases and column layouts remain compatible.

Dashboard language distributions count distinct movies or episodes per language, independently of file and track multiplicity. Statistics include `languageTotals` by scope; overlapping multilingual groups must not be interpreted as a partition.

Paged lists materialize sorted row IDs and fetch full evidence/track JSON only for the selected page. Matching is reevaluated only for Sonarr season-context rows. A deterministic outer sort preserves all allowed column orders and tie-breakers while keeping large JSON out of the full-catalog temporary sort. CSV still streams all actual matches with the same sort semantics.

The sync writer owns its completed upstream snapshot and drops each input record while inserting it into the atomic SQLite transaction. Remaining input is cleared on failure; transaction rollback preserves the last complete cache. Ordinary `Store.Replace` callers retain their inputs. This avoids keeping the full live snapshot alongside growing database buffers during large syncs.

Emby matching stores only normalized tracks/HDR for candidate files plus a SHA-256 fingerprint of the decoded raw stream records. Conflicting duplicates remain ambiguous even when their normalized traits agree. Raw page data is discarded rather than retained across the whole Emby catalog.

### Settings drafts and notifications

`PUT /api/custom-tags/batch` accepts `{ original, tags }`. Positive IDs reference existing tags; negative IDs denote unsaved additions. The original snapshot must match stored identities/names. A single transaction applies the validated list and dependent cleanup; the recognition mutex coordinates sync/reprocessing. This prevents partial saves and stale-editor overwrite. CSRF and authenticated mutation checks apply to the new endpoint.

Settings language changes remain browser-local drafts until the Display section is saved. Notifications are emitted through a local UI event bus and rendered as accessible, timed toasts. Toasts pause while hovered or focused and render in a manual native popover above the topmost modal and its backdrop. The portal follows the dialog stack to retain interactivity, viewport positioning and timer remaining time when dialogs open or close. System sync activity is indeterminate because upstream fetching does not expose a stable total.

Schema 9 adds definition provenance/control, per-resource assignment ownership and one-job removal grants. A read-only planner is shared by previews and execution; authenticated CSRF-protected confirmation checks a fresh plan signature under the sync gate. Outbound overwrite uses bounded add/remove operations rather than replacing an entire remotely mutable tag array. File records optionally retain per-value informational presentation, and manual custom assignments are identified independently of filename rules.

Schema 10 broadens only the untouched UHD BluRay default while preserving user rule options, makes a backup and reprocesses cached evidence atomically. Recognition writes share the file/tag sync gate. SQLite transactions use immediate write-lock acquisition, preventing a deferred read transaction from failing during a read-to-write snapshot upgrade. Frontend checkbox drafts commit once; confirmed CRUD commits against the saved snapshot and reapplies unrelated pending flags locally. Language color affects only a known flag's existing thin edge, never a separate badge.

The supported container default is 512 MB without swap in automated validation; repeated 100k/two-player synchronization can OOM at 256 MB. The Go soft target remains `GOMEMLIMIT=64MiB`. SQLite has an advisory soft heap target of about 17 MB in addition to the per-connection page-cache target. Large recognition rewrites temporarily lower a larger Go memory target to about 25 MB and restore it afterward, reserving room for native allocations and healthchecks without changing normal query/sync budgets or container limits.

## Media servers and season analysis (0.8)

Independent encrypted Emby/Jellyfin configurations share an allowlisted read-only transport and matching engine; provider snapshots remain separate. Compact per-provider pointers and identical track reuse constrain sync memory. Evidence with `mediaServer` origin retains selected supplemental values; legacy Emby fields remain compatible. `season_analysis` has indexed technical/language flags and compact majority reasons, computed atomically on complete seasons after cache writes. List, context, CSV, presets and bulk-tag operations share those predicates. See [media servers and outliers](MEDIA-SERVERS.md).

## Optional mux service (schema 16)

`Settings.Mux` is a singleton separate from network service instances. `files.source_path` is internal cache data excluded from JSON. `mux_jobs` stores unique service/file identities, editable specs, source identification, revisions and execution state. Schema 15→16 is backed up before migration. An independent worker leaves the library sync gate free; only completion enqueues an internal delta job, including when incoming webhooks are disabled. Executables come from signed Alpine packages in Appdata and run through their own musl loader with an explicit environment. See [MUX.md](MUX.md).

| Endpoint | Methods | Purpose |
| --- | --- | --- |
| `/api/files/rename/preview` | POST | Validate movie/episode rename and list companion basenames/conflicts without moving files |
| `/api/files/rename` | POST | Rename media and confirmed companions, then rescan and synchronize |
| `/api/mux/tool` | GET, POST | Status and asynchronous install/update/check/remove |
| `/api/mux/root-folders` | POST | Import configured Arr roots against draft `{mappings}` |
| `/api/mux/check-paths` | POST | Check draft `{mappings, workDir}`, roots and cached-file counts |
| `/api/mux/jobs/log` | GET | Redacted log chunk with offset, progress and running state |
| `/api/mux/jobs` | GET, POST, PUT, DELETE | Identify, mark, edit with revision, remove |
| `/api/mux/jobs/identify` | POST | Refresh changed source tracks |
| `/api/mux/run`, `/api/mux/cancel` | POST | Queue selected/all runnable jobs, cancel |
| `/api/mux/jobs/rescan`, `/api/mux/jobs/backup` | POST | Retry completion, delete preserved backup |

All routes require authentication and mutations require CSRF; mux job routes return 404 when disabled. Job responses expose basenames and checks; root-folder diagnostics also return configured root paths as described below. Verification precedes destructive Arr operations. Recovery preserves verified output after interrupted replacement.


## Mux settings and diagnostics (1.2.3)

`mux.mappings` stores the global Arr → Scopearr prefix mapping. Startup and settings normalization merge legacy `mux.pathMappings` deterministically and mirror the result to every current Arr instance for rollback. `muxColumnOrder` and `muxVisibleColumns` hold the eight table columns; selection is fixed first and filename stays visible. These additive fields retain schema 16.

Authenticated, CSRF-protected `POST /api/mux/root-folders` takes `{mappings}` and reads configured roots via the Arr GET-only allowlist. `POST /api/mux/check-paths` takes `{mappings, workDir}` and checks the draft without changing settings; valid lines are checked even after a syntax error. Root errors are isolated per instance and the overall request context is limited to 15 seconds. No sample file paths enter the response.

Saving a job spec makes it `ready`; only `ready`, `failed`, and `cancelled` can be queued. `GET /api/mux/jobs?id=…&fresh=1` refreshes an individual file check and its cache. `GET /api/mux/jobs/log?id=…&offset=…` returns at most about 65 kB plus the next offset, running flag and progress. The worker redacts source/temp/destination/work/mapping-root paths before appending each non-progress tool line to an approximately 260 kB ring and its local log. Legacy unredacted local logs are represented by safe DB summaries. Job deletion/retention removes the log too.

## File renaming (1.2.6)

File operations (muxing and renaming) require the enabled MKVToolNix service, a mounted writable media directory and a path mapping. Renaming uses filesystem operations and does not require mkvmerge installation. Both rename endpoints require authentication and CSRF, reject demo mode, serialize under a global rename lock and block any existing mux job for the file. Mux job creation shares this lock so a job cannot appear during a rename.

Fresh Arr path/size checks protect cached identities. Sonarr's GET-only parse endpoint additionally verifies the exact series and episode IDs. Source resolution confines canonical paths to the mapped root; source files and companions must be regular files. Same-directory hard-link/unlink moves fall back to Linux `RENAME_NOREPLACE`, then an immediately rechecked rename on unsupported filesystems. Confirmed companion names must match a fresh scan; failed companion moves roll back in reverse order before any rescan. Responses expose basenames only.

Mux completion and renaming share `refreshAfterFileChange`: bounded Arr command polling, an internal delta queue and optional media notifications. Rename refresh uses a detached six-minute context; a five-minute Arr timeout returns `renamed: true, refresh: "pending"` with a warning and a durable delayed cache update that waits for the outstanding Arr command before reading files. Other post-rename failures return `refresh: "failed"` without pretending the filesystem operation failed. Schema 16 is unchanged.


## Unraid placement (schema 17)

`Settings.Unraid` is a local singleton; it does not connect to Docker or Unraid APIs. Discovery selects direct physical mountpoints below DiskRoot, excludes merged/user and external roots, and classifies numbered array disks and named pools. Optional read-only `var.ini` state uses observed `shareMoverActive`, `mdResync` and `mdResyncPos`; stale `mdResyncAction` is never an activity flag.

`placement_items` stores compact plans, per-disk totals, relative file metadata, queue positions and job state; `placement_scan` stores scan options, counts, target summaries and an identifier high-water mark. Scans fetch fresh Arr folder lists, cache one directory parent per device, stream non-OK items into a disk-backed SQLite temporary table and atomically replace the previous result only on success. Planning is greedy in descending item size; at most 500,000 file/directory entries are retained. A synthetic 20,000-item / 150,000-file / eight-disk test enforces a Go heap peak below 64 MiB.

Authenticated `/api/unraid/status` and CSRF-protected `/api/unraid/check` provide discovery/state and draft path checks. `/api/placement/scan` supports status/start/cancel; `/items` supports filtered paginated projections without full file lists, item details, recheck and offset logs; `/start`, `/cancel`, `/items?moved=1` and `/export.csv` manage queue actions and export. Mutations use the existing CSRF boundary. CSV deliberately includes host paths and protects spreadsheet formulas.

Placement and mux own a shared file-operation claim across copying, replacement and recovery; short mutexes guard queue transitions without blocking status endpoints across I/O. Placement uses rooted physical item directories, exclusive partials, 1 MB buffers, fsync at most about every 17 MB, size/optional hash verification and no-overwrite hardlink publishing. Source entries are checked again before unlinking. Recovery preserves divergent or sole partial copies for manual review. Placement never triggers Arr/player synchronization. Mux persists its physical source location internally and resolves it again before replacement.

Schema 16 → 17 creates a consistent pre-migration backup. Rollback to 1.2.6 requires the schema-16 snapshot.

`GET /api/placement/items` accepts `sort=title|service|size|disks|target|move|kind|status|progress` with `dir=asc|desc`; without it, rows use the processing order. `POST /api/placement/start` always queues in the processing order, whatever order the IDs arrive in. Selected IDs may include `waiting_for_mover` items with a target; `{all:true}` never does. `DELETE /api/placement/items/{id}` removes one moved row from the list.

## Navigation (1.3.1)

The header shows Dashboard and three menus: Movies and TV series list each enabled Radarr/Sonarr instance by its label (plus "All …" with several instances) and set the library's `instance` filter; Tools lists Muxing, Disk placement and Files & permissions when each is available. Menus open on click, close on Escape, selection or outside clicks, and support arrow keys.

## Files & permissions (schema 18)

`Settings.FileCheck` holds libraries, checks, target owner and modes, strict mode, ownership options and allowed/ignored name patterns. Availability follows the rename prerequisite (MKVToolNix service with path mappings). Scans reuse the Arr folder lookup of disk placement, walk mapped item folders with `lstat` metadata only and stream findings through a connection-local staging table; publication replaces `filecheck_items` and `filecheck_scan` atomically. A scan stops at 500,000 findings.

Each row is one `(path, kind)` with the fix `chmod`, `take_ownership`, `delete` or `manual`. `/api/filecheck/scan` supports status/start/cancel, `/items` filtered, sortable pages (`sort=title|path|kind|size|fix|status`), `/fix` selected IDs or `{all:true}` with the current filters (never untracked videos), `/cancel`, `/commands` reviewable shell text, and `DELETE /items/{id}` or `/items?fixed=1` for fixed rows. Fixes run sequentially in title/path/kind order under the shared file-operation claim with mux and placement. Every fix re-reads type, mode, owner, size and mtime, confines the path to the item folder and refuses deletions of files Radarr/Sonarr manages. Ownership copies use exclusive hidden partials on the resolved physical disk and an atomic rename; restart recovery removes them.

Schema 17 → 18 creates a consistent pre-migration backup. Schema 19 and newer are rejected. Rollback to 1.3.0 requires the schema-17 snapshot.
