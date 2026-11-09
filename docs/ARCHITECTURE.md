# Architecture and HTTP API

Go serves embedded Preact/TypeScript assets and JSON endpoints from one origin. SQLite via `modernc.org/sqlite` requires no CGO. `/data` is the only required persistent mount. No external fonts, telemetry, CDN assets, media mounts or separate database server are required.

## Static assets and browser lifecycle

At startup, the server indexes embedded static files with SHA-256 ETags and smaller gzip variants (level 6). Hashed `/assets/` chunks are immutable for one year; the HTML entry revalidates on every visit and other static files cache for one day. Each representation has its own ETag, gzip negotiates positive quality values, and `Vary: Accept-Encoding` keeps proxy caches correct. API responses remain `no-store`; HEAD, conditional responses, security headers and unknown-path handling retain their existing semantics. A stale lazy chunk triggers at most one session-scoped page reload.

English is the eager translation fallback; only locale names are eager for the other languages. Bootstrap awaits the selected catalog before rendering, and language changes switch after loading succeeds. `usePolling` owns one abort controller and recursive timer per consumer, stops while hidden, reloads immediately on visibility and replaces its lifecycle when dependencies change. Existing page-specific intervals remain. `useStatus` retains its specialized visibility/abort lifecycle because it also handles session recovery and authentication retries.

Status totals use grouped indexed queries rather than loading jobs and logs or scanning all completed findings. Webhook keys use indexed prefix ranges. The worker skips idle ticks only when neither configuration nor a persisted/enqueued job requires work.

## Storage and metadata

`files` stores immutable service-instance/file IDs, media ID, series/season associations, indexed normalized fields and the full file record as JSON. `years` supports multiple episode years. FTS5 `search` indexes title, series and filename. `file_languages` indexes normalized language membership, including partially unknown tracks. `file_audio_tracks` indexes each stored audio track (position, normalized language and codec, channel label as shown for tracks; empty means unknown) for track-combination filters. It holds measured track values, so field confirmations do not change it (the CSV audio summary switches to the confirmed file values instead). It is maintained by SQLite triggers, so older versions keep it current; no schema version change. The update trigger runs only when the stored `audioTracks` change, so reparses that rewrite derived fields leave it untouched. Invalid or trackless JSON yields no rows and never blocks a write; a start that finds the triggers missing (new store, older version, restored backup) recreates them and refills the index once from the cached JSON in one transaction. `kv` holds settings, filename-recognition rules, account and sync status; `presets` and `sessions` are separate tables. `PRAGMA user_version` tracks schema changes; backups precede existing-database migrations and unknown future schemas are rejected.

Each attribute’s `evidence` retains normalized filename, Arr API and optional Emby values, selected origin (`filename`, `rule`, `api`, `emby`, `combined`, `unknown`) and conflict. Original filenames are preserved; not every raw upstream response is archived. Titles/years come from Radarr; episode names, seasons and first-air years from Sonarr. Existing quality and MediaInfo attributes supplement filename tokens; Scopearr never invokes media analysis unless the optional MKVToolNix service is enabled. Pixel dimensions alone do not establish a quality class.

Audio, language and HDR attributes are component sets. Codec aliases share a family without collapsing explicit encoder distinctions. Additional explicitly reported languages enrich filename languages without inventing a per-track codec. Unknown track attributes set `unknownTraits`; `metadataIncomplete` considers resolution, codec, source, audio, language and failed configured Emby matching. SDR is an HDR value that never coexists with a profile: merging drops it as soon as another profile is present, and SDR from one source against a profile from another is a disagreement. It is recorded only when stated explicitly by a filename rule, a media-server VideoRangeType or a MediaInfo measurement; Arr dynamic ranges never yield SDR. Missing HDR alone may mean SDR or unknown and does not make metadata incomplete. Negative filters describe missing **reported** attributes, not proven absence.

## Named instances (1.1)

Canonical settings expose an ordered `instances` array. Each connection carries an immutable provider-prefixed `id`, its `type`, optional `name` and `sourceIds` (comma-separated Arr IDs; empty means all enabled sources). Legacy fixed-provider settings remain compatible. Secret retention, cached file IDs, custom overrides, schedules, webhooks, storage, previews and tag ownership are scoped by instance, not by display name or array position. Aggregate query `service=radarr|sonarr` includes that provider type; optional `instance=<id>` narrows it. CSV appends instance identity and display name. Existing legacy instance IDs retain their webhook URLs.

Media matches retain real movie/episode item IDs separately from series navigation links, along with media-source identity. Outbound desired values are combined per player instance and destination item before a write, with source-instance selection and fresh destructive approvals. See [service instances](SERVICES.md).

## Sync

Radarr loads the movie catalog, then movie files in batches of 100 movie IDs. Sonarr loads the series catalog, then episodes/files per series with at most two concurrent GET requests; series are processed sequentially. One global queue builds one service snapshot at a time. Each HTTP request has a 20-second timeout and up to three attempts for network/5xx errors. Redirects are rejected to prevent key forwarding.

Data is gathered in memory, validated and committed only after a complete successful fetch. A transaction replaces the service files, search index and year mappings atomically. WAL readers observe a complete state; pagination counts and rows share one read transaction. Settings/dispatch are locked together; changed configuration cancels old generations and prevents stale commits. A multi-request upstream catalog is not a transactional snapshot, so detected identity inconsistencies fail and retain the previous cache.

Facet and dashboard caches are defensively copied immutable snapshots, invalidated after successful commits. Queries carry cancellation contexts to SQLite. Frontend request generations and abort controllers reject stale results. Polling pauses in hidden tabs; intervals are 3 seconds during sync, 30 seconds when idle/authenticated and 60 seconds on login.

The catalog is also a defensively copied cache. Its GET path uses a read-only snapshot; data/rule writes retain historical display values inside their own transaction. Aggregate fills have separate locks and publish only if their invalidation generation still matches. Library counts/rows and dashboard widgets use explicit read-only transactions, allowing WAL readers alongside a writer.

`Server.mu` protects only the in-memory configuration. `settingsMu` serializes settings and presentation changes; operations needing the sync gate acquire it first. Store writes never hold `Server.mu`. Recognition changes acquire `recognitionMu` before opening a write transaction; reconciliation takes a protected immutable rules snapshot before opening its transaction. Sync status locks cover only short state updates and the generation-checked commit, so cancellation and status reads remain available during snapshot construction.

Routing/authentication remain in `server.go`, with named endpoint handlers in `server_*.go` and CSV handling in `export.go`. Store opening and historical migrations live in `store_open.go`; query filters, ordering, results, facets and statistics have focused files. Existing 0.5.x rule migrations remain explicitly separated from current display logic. Frontend settings sections, table rendering and the rule editor retain their existing markup in separate components. The authenticated application, settings and recognition page load on demand. Language lookups start from a bundled core (`web/src/language-core.json`: every registry language with an ISO 639-1 code plus `mis`, `mul`, `und` and `zxx`); the full registry is a chunk of its own (`language-data`) that loads on demand, when a value is not in the core or a language list offers every entry.

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

Files/export share parameterized filtering: `service=radarr|sonarr`, `q`, `yearMin`, `yearMax`, `resolution`, `codec`, `family`, `source`, `processing`, `hdr`, `bitDepth`, `audio`, `channels`, `language`, `track`, `sizeMin`, `sizeMax`, `unknownYear=true`, `unknownSize=true`, `conflict=true|false`, `metadata=complete|incomplete`.

Multiple values of an ordinary field use OR; different fields use AND. `<field>Op=eq|not` includes or negates the entire selected set. Audio/HDR/language also allow `all|notAll`, combining component conditions with AND or negating that complete combination. Invalid, repeated or inappropriate operators are rejected; an operator without values has no effect. `__unknown__` selects empty or partially unknown audio/language attributes. `track=<language>|<codec>|<channels>` (repeatable, at most 16) selects files with one stored audio track that matches every given part: exactly three parts, an empty part means any value, `__unknown__` an unknown one, and at least one part is required. The language is normalized like the `language` filter and must name one language; codec and channel label (as shown for tracks, e.g. `7.1` or `6 ch`) match exactly after trimming, at most 80 characters. `trackOp=eq|not|all|notAll` combines several combinations like the compound fields. Files without stored tracks never match positively, so `not`/`notAll` include them. Sizes are bytes, displayed in decimal GB. FTS search uses sanitized AND-prefix terms, not arbitrary substrings or user FTS syntax.

Files use `page>=1`, the configured page size (100 by default) and optional `mode=matches|season`. An optional `limit` sets the page size of that one request (quick search asks for 6): it is checked like the page size, 1 to 1000, with the same message, and an empty or non-numeric value is rejected with 400; without it the configured page size applies as before. It reads only and stores nothing. Library routes never pass it: the library's request drops a `limit` from its filters, so a hand-edited `#/movies?limit=…` keeps the configured page size, as in 1.7.0. `total` counts actual matches, `displayTotal` includes context and `matched` identifies real matches. Series sort by title, season and episode. Movie sort allowlist: title/year/resolution/codec/source/size/hdr/bitDepth/audio/channels/language, with `dir=asc|desc`. Default: title ascending. Numeric attributes sort numerically; unknowns stay last.

CSV applies the same filters/sort, UTF-8 BOM, semicolon separator and spreadsheet-formula safeguards. A protected temporary Appdata file completes before download; SQL/JSON/write errors fail rather than deliver a partial success. Cancellation/success removes temporary files. Context-only rows are excluded. Headers use `Accept-Language` or `lang`; media values stay canonical.

## Emby

Emby config has enable/URL/encrypted key and `interval=0`; it joins each Arr service sync. The client permits only GET `System/Info` and paginated `Items` using `X-Emby-Token`, 250 items per page. Subpaths are supported. Totals, page completeness and duplicate IDs are validated; only relevant candidates stay in memory.

Identity requires a unique exact basename and positive byte size on both sides. Multiple versions use the matching MediaSource. Item-level streams belong only to the exact matching source path. Optional absolute prefix mappings require the full mapped path too; longest Arr prefix wins. Unmatched/ambiguous identities remain explicit. Metadata paths are never opened unless optional MKVToolNix editing is enabled; Arr source file paths are not returned to browsers. The authenticated mux root-folder import/check endpoints are an explicit exception for configured **root folders**, which are needed to configure mounts; sample results contain counts only.

Only internal audio streams count: index, explicitly reported language, codec/profile, channels/layout, title and default flag. Languages are never inferred from track titles. Unique Emby tracks provide audio/language sets; if all values of an attribute are unknown, existing filename/Arr data remains without assigning it to tracks. The main Channels column retains filename/Arr data; details show each track. Explicit Emby video HDR supplements reported tags; profile numbers never imply an invented HDR10 fallback. VideoRangeType SDR counts only when the same stream reports no profile. Emby failures abort the enriched service snapshot.

## Presentation, translations and versioning

Settings store visible columns and the complete column order independently per service. Title/episode remains visible. Unknown/duplicate/missing columns and invalid services are rejected. Saving rejects unknown values; at startup, values unknown to this version are reset in memory with a warning. Header/cells share one ordered list; temporary “All columns” does not change defaults. Tag backgrounds are validated hex values with automatic text contrast. Optional text overrides accept only black or white; both maps persist in the existing settings JSON without a schema migration. Filter presets remain canonical SQLite data independent of display language.

The dashboard opens after login. Distribution-tag buttons replace the target library’s current in-memory query; the library shows the value as a chip, with no separate drilldown banner. The KPI cards open their library with an empty query (`query: ""`), which clears that library's in-memory filters; Show on Incomplete metadata opens `metadata=incomplete` in the library of the scope's service. The other library’s filters remain independent. The combined statistics scope uses the currently selected library; movie/TV scopes choose explicitly. Reload clears unsaved filters. Presets change only when explicitly saved or selected.

The libraries filter through their filter bar and a filter drawer (2.0.0). The search, a preset, removing a chip, Reset filters and the instance apply at once, as a route replace. The drawer edits a draft of the service's filters and applies it only with Apply: one route replace on page 1, which keeps the search and the instance as they are now, so a search typed meanwhile is not undone; closing it discards the draft. Its live match count asks `files?<draft>&service=…&limit=1` 180 ms after the last change (the previous request aborted) and shows `total`; it reads only. Its facets load only while it is open, and the last ones stay until new ones arrive. Every request and view of a library reads at most 16 track combinations, so a longer deep link never asks with more. The drawer is a chunk of its own, preloaded at idle; a failed load shows “Scopearr is not reachable” and never reloads the page. Row density and stacked audio tracks are browser preferences only (localStorage `scopearr-density` = `compact`, `scopearr-tracks-stacked` = `true`; no key means comfortable rows and compact tracks), never a server setting, so 1.7.0 ignores them.

JSON catalogs are discovered at build time, including future contributed languages. English keys are stable message identifiers with named placeholders and plain-text values. Go embeds the same catalogs for API errors/CSV. `Accept-Language` negotiation supports regional fallback and quality weights. UI preferences use browser storage; canonical media/filter values are never translated in storage. See [translation guide](TRANSLATING.md).

Root `VERSION` is embedded by Go, checked against package/Docker defaults and validated by CI against released tags. Release inputs must match source. Checked-in English notes feed GitHub releases before stable promotion. See [releasing](RELEASING.md).

## Recognition rules (0.3.0)

Schema 5 stores original API traits, a recognition revision, rule conflicts, indexed Emby matching states and indexed language membership. Built-in parser defaults seed a persisted ruleset only when none exists. Go RE2 rules are bounded to 256 entries, compiled once and grouped by attribute and mode. Direct, fallback and override phases are deterministic; scalar conflicts are independent of metadata disagreements. Compound audio/HDR/language results are additive.

Authenticated GET `/api/recognition` and `/api/recognition/defaults` expose rule configuration. CSRF-protected POST `/api/recognition/preview` compiles a draft and recognizes one filename without saving. PUT `/api/recognition` requires `{rules, revision}`. A stale revision returns 409. A serialized writer commits rule configuration, normalized file JSON, indexed fields and language membership together, then invalidates aggregate caches. Reprocessing uses batches of 250 rows and a consistent backup, without upstream requests. This atomic bulk operation has a bounded five-minute budget; an expired budget rolls back the rewrite and returns HTTP 503. Ordinary query budgets remain unchanged. Sync commits acquire the same writer lock and reparse with the current rules, preserving cached Emby tracks and HDR. Files with cached media-server matches are enriched once through the media resolver rather than recognizing the filename twice.

Track combinations filter on the measured track values in `file_audio_tracks`, while `language`, `audio` and `channels` filter on the file values (filename, API, measurements and confirmations); a field confirmation therefore changes the latter, not the former. Files, CSV, custom-tag selection and presets apply `track` through the same filter; presets store the normalized combinations.

Files/CSV/presets share `conflict=true|false`, `ruleConflict=true|false` and `embyMatch=unmatched|matched|missing|ambiguous|missing_size|no_tracks|unconfigured`. `unmatched` includes attempted matching failures and excludes unconfigured enrichment. The unified Audio column does not alter the separate `audio` and `language` filter parameters. Legacy language aliases and column layouts remain compatible.

Dashboard language distributions count distinct movies or episodes per language, independently of file and track multiplicity. Statistics include `languageTotals` by scope; overlapping multilingual groups must not be interpreted as a partition.

Paged lists materialize sorted row IDs and fetch full evidence/track JSON only for the selected page. Matching is reevaluated only for Sonarr season-context rows. A deterministic outer sort preserves all allowed column orders and tie-breakers while keeping large JSON out of the full-catalog temporary sort. CSV still streams all actual matches with the same sort semantics.

The sync writer owns its completed upstream snapshot and drops each input record while inserting it into the atomic SQLite transaction. Remaining input is cleared on failure; transaction rollback preserves the last complete cache. Ordinary `Store.Replace` callers retain their inputs. This avoids keeping the full live snapshot alongside growing database buffers during large syncs.

Emby matching stores only normalized tracks/HDR for candidate files plus a SHA-256 fingerprint of the decoded raw stream records. Conflicting duplicates remain ambiguous even when their normalized traits agree. Raw page data is discarded rather than retained across the whole Emby catalog.

### Settings drafts and notifications

`PUT /api/custom-tags/batch` accepts `{ original, tags }`. Positive IDs reference existing tags; negative IDs denote unsaved additions. The original snapshot must match stored identities/names. A single transaction applies the validated list and dependent cleanup; the recognition mutex coordinates sync/reprocessing. This prevents partial saves and stale-editor overwrite. CSRF and authenticated mutation checks apply to the new endpoint.

Settings language changes remain browser-local drafts until the Display section is saved. Notifications are emitted through a local UI event bus and rendered as accessible, timed toasts. Toasts pause while hovered or focused and render in a manual native popover above the topmost modal and its backdrop. They stay top right and start below the open popover and a page's top controls they would cover (`placeToasts`: a list's card head, the page header's actions), measured again when the toasts, the page, the scroll position or the size change. The portal follows the dialog stack to retain interactivity, viewport positioning and timer remaining time when dialogs open or close. System sync activity is indeterminate because upstream fetching does not expose a stable total.

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

## Navigation (2.0.0)

The frame's sidebar (docs/STYLEGUIDE.md, Part 1, 10.1) groups the pages: Library (Dashboard, Movies, TV series), Tools (Muxing, Disk placement and Files & permissions, each only when it is available) and System (Settings with its six areas). Movies and TV series open all their instances; with more than one enabled instance, each one is a sub-entry that sets the library's `instance` filter. Groups open only by their arrow (Settings: its own button), and the rail shows them in a flyout. Phones show Dashboard, Movies, TV series, a Tools menu and More (the sidebar as a drawer) in a tab bar. Everything comes from the route through `nav-model.ts`; the topbar's breadcrumbs name the shown page.

The topbar's bell counts the open jobs from the status. Its jobs menu loads the jobs only when it opens, never at startup, and again when a tool's counts change while it is open: `mux/jobs`, and `placement/items` and `filecheck/items` with `limit=3`, once for the running and waiting items and once for the failed ones, each only for the states the tool has. Startup therefore asks for no item list beyond the library's `mux/jobs`. Quick search (⌘K or Ctrl+K) filters the sidebar's pages in the browser and, from two letters on, asks `files?service=…&mode=matches&q=…&limit=6` once per library.

## Routing (2.0.0)

The URL hash is the only stored address of the view. Browsers never send it to the server, so deep links need no server fallback, and signing in keeps it. `router.ts` maps hashes to routes with pure functions: `parseRoute` never throws, and `formatRoute` returns one canonical form. All comparisons use `formatRoute(parseRoute(hash))`, so `%20` and `+` cannot cause loops. Path segments are encoded with `encodeURIComponent`, queries with `URLSearchParams` (a space becomes `+`).

| View | Hash | Query (`*` = repeatable) |
| --- | --- | --- |
| Dashboard | `#/dashboard` | none |
| Movies / TV series | `#/movies`, `#/series` | the library filters in their order (`instance`, `q`, `resolution`, …, `custom`\*, `customOp`, `<field>Op`), then `page` (from 2) and `sort` + `dir` (a library column, only when not title/asc) |
| Muxing | `#/tools/mux` | `q`, `status`\*, `sort`, `dir`, `page` |
| Disk placement | `#/tools/placement` | `q`, `status`\*, `target`\*, `kind`\*, `sort`, `dir`, `page` |
| Files & permissions | `#/tools/files` | `q`, `status`\*, `kind`\*, `sort`, `dir`, `page` |
| Settings | `#/settings/<section>[/<tab>]` | none. Sections: `connections` (Services), `appearance` (Display), `widgets`, `custom` (Custom tags), `recognition` (Tag rules), `system`. Tabs: a service tab ID (`radarr-4k`, `mux`, `unraid`, `mediainfo`, …), `general`/`lists`/`colors`, `info`/`log` |
| System → Log | `#/settings/system/log` | `q`, `level`\*, `source`\*, `instance`\* (the names of `/api/events`) |

Some hashes fall back:

- An empty or unknown hash, extra segments or a broken `%` sequence in the path open `#/dashboard`.
- `#/settings` and unknown sections open `connections`.
- An invalid tab is dropped. Only System → Log keeps a query.
- Library routes reserve `page`, `sort`, `dir` and `service`. An invalid `page` reads as 1, and a `sort` without a valid `dir` counts as not given.
- An empty or blank `q` is no filter, in a library and in a tool route.

One table, `TOOLS` in `tool-route.ts`, names each tool's path, the name of its storage keys and its filter keys. The router, the tool queries and the tool page hook read it.

A load without a hash writes `#/dashboard` in place, without a new entry. A start hash is written in its canonical form at once.

`route-history.ts` is the only code that uses `window.history`. Named actions and in-app links (`openLink`) push a new entry, and only when the hash changes. The links are the entries of the sidebar, its flyouts, the tab bar and its Tools menu (with the settings areas), the tool rows of the bell's jobs menu, the options of quick search, both brand links and dashboard tag filters. The other named actions are Set up, Open settings in empty states, Open in mux and Placement → Files; Show in log in toasts and in the jobs menu sets the hash (see below). A link follows `nav-link.ts`: a plain left click (`isPlainClick`) opens its target in the app, and `followLink` cancels the browser's navigation for it. Clicks with Ctrl, Cmd, Shift or Alt and middle clicks keep the browser's link. The brand links point at `#/dashboard`, so a new tab starts on the dashboard. Every other change replaces the current entry: filters, presets, reset, page, sort, settings tabs, log filters, canonical forms and fallbacks. The fallbacks are a hidden tool, which returns to the library; deleted custom tags, which leave the filters; and a page past the end, which moves to the last page. Replaces wait 300 ms and are combined, so Back leaves a list instead of replaying keystrokes. This also stays below Safari's limit of 100 history calls per 30 s. A waiting replace is written before any push, on Back/Forward and on `pagehide`. If the user has already left its entry, the replace waits until that entry is shown again. `history.scrollRestoration` is `manual`.

Every entry stores its index in `history.state.scopearr`. `popstate` and `hashchange` cannot be cancelled, so the route of a Back, Forward or typed-hash step applies only after its guard:

- Leaving settings asks the unsaved-changes question of `canLeaveRules`.
- Another settings section asks the section guard that `useSettingsDraft` registers, with the same questions as a section link.
- Another tab asks nothing.

Pushes ask the same guards before they push, and one navigation asks at most once. `openLink(target)` asks with the same check as Back and Forward, then runs the named action of its target as a push; it returns false when declined, and nothing changes. The other named actions run only after `canLeaveRules()`; a section link asks the section guard through `openLink`. The link of the shown settings area asks nothing and keeps the unsaved draft, while 1.7.0's header Settings button asked first and then reopened Settings with a fresh draft. `linkHref(target)` is the route that the action opens from the current state, so the `href` of a link and its click lead to the same route: a library link keeps the filters and sort of its library, sets or clears the instance and starts on page 1; the link of the open tool keeps its parameters, another tool starts without them, and a search with text replaces them. The exception is Show in log (`openLog`): it creates the history entry first and the guard asks afterwards, like a typed hash. A declined step returns to the accepted entry with `history.go(Δ)`, so forward entries are kept. An entry without an index (a typed hash or `location.hash = …`) gets the index after the entry seen last: the accepted one, or a step that arrived while its question is open, since the browser drops the entries after that step. It always arrives fresh, also when it names the shown route. Dialogs have no routes and stay open on Back.

After a history step, route parameters describe the whole state, and a missing parameter means the default. Settings tabs are the exception: a missing tab falls back to its session key, then the default. Stored values fill the parts a route leaves out only on a fresh entry: a page load, a named action or link such as a sidebar click, or an entry without an index. The route history reports such an entry with `arrival.fresh`: a typed or pasted hash and `location.hash = …`, so also Show in log. A fresh entry follows the rules of a page load. Tool pages fill the gaps from storage, the library sort comes from storage when the route names none, and the filters come from the route. Back and Forward onto an entry with an index stay history steps. Steps that arrive while a question is open only move the target, and the answer applies to the newest entry as it arrived: a hash typed meanwhile starts like a page load, and a Back step meanwhile stays a history step. `libraryEntry` counts the libraries that a link or an action opened, also the shown one. The library clears its selection and closes its filter drawer on each, as 1.7.0 cleared the selection and collapsed its filters on a header click; Back, Forward and replaces keep the selection; leaving the library or its service closes the drawer, and a step inside the library keeps it open with its draft taken again from the filters the step brought. `revision` counts three things: accepted external steps, links to the shown route, and pushes that open the same page with other parameters. Tool pages and the log viewer use it as their key, so they start again from the route. The app's own replaces never change it. `openLog(filter)` in `event-log.ts` stays in the start chunk. It first dispatches the cancelable `LINK_EVENT` (`scopearr:link`). The route history then writes any waiting replace. If the link leads to the shown route, the route history cancels the event and starts that route again, without a new entry or a question. Otherwise, `openLog` sets `location.hash`, which arrives like a typed hash.

The storage keys and formats of 1.7.0 remain, so 1.7.0 still reads them after a downgrade:

- **Tool pages:** for what the route leaves out, they read filters and sort from localStorage (`scopearr-<tool>-filters`, `scopearr-<tool>-sort`) and the page from sessionStorage (`scopearr-<tool>-page`). They write these keys as before and mirror their whole state into the route by replace, also right after opening. Opening a tool rewrites the stored sort only for a sort in the route or after a history step (its default); otherwise the stored value stays until the user sorts, also one the page cannot read.
- **Library sort:** it stays in `scopearr-film-sort` and `scopearr-series-sort`.
- **Settings tabs:** a tab shows a valid route tab, else its session key (`scopearr-service-settings`, `scopearr-display-tab`, `scopearr-system-tab`), else the default. Choosing a tab writes the key and replaces the route; a linked tab writes only the route. `scopearr-columns-tab` and dialog tabs stay outside the route.

Two localStorage keys are new (Phase 5a), the browser preferences of Settings → Display (`list-prefs.ts`): `scopearr-density` holds `compact` and `scopearr-tracks-stacked` holds `true`; without a key, or with any other value, rows are comfortable and tracks compact. 1.7.0 ignores both.

Two session keys are new:

- `scopearr-library-filters` (`{"radarr":"…","sonarr":"…"}`) keeps the filters of the library that is not in the route through a reload. The route wins for its own library.
- `scopearr-pending-route` (`{index, url, hash}`) holds a replace that is still waiting. A reload of that entry therefore keeps the last keystroke.

Removed:

- `scopearr-navigation`, the 1.7.0 view state, which is no longer read or written.
- The dead `scopearr-settings-section` write.
- The storage hand-offs that preset another page before switching to it. These were `scopearr-filecheck-filters`/`-page` from Placement → Files, `scopearr-mux-filters` from Open in mux and `scopearr-service-settings` from Set up. They are now routes: `#/tools/files?q=<path>`, `#/tools/mux?q=<file>` and `#/settings/connections/mux`.
- The `scopearr-open-log` event and its pending filter.

Known limits:

- Two hashes typed on the sign-in screen leave two entries without an index, and the route history numbers only the last one when it starts. A Back step onto the earlier one counts as a new entry and leaves a gap in the indexes. If that step leaves unsaved settings and is declined, `history.go` returns too far. Chromium also caps `history.length` at 50, which the index of a start entry relies on. A fix would need another storage path.
- While a question is open, further steps ask nothing: Back, Forward, typed hashes and Show in log only move the target, and the answer applies to the newest entry. A link to the shown route that arrives meanwhile (Show in log on the shown log) is dropped. In-app links cannot be clicked meanwhile, because the question is a modal dialog.
- A hash typed while a question is open replaces the entry the question is for. If the answer is Cancel, the address bar keeps the typed hash while the app still shows the earlier page. After two Back steps during one question, the restoring step has no entry to return to, which leaves the same mismatch. Reloading or opening any link puts them back in step.
- Quick search returns focus to the button that opened it. If the window shrinks to phone width while it is open, that button leaves the topbar, and focus falls to the page when quick search closes.
- Menus from 1.7.0 that close when focus leaves them (filters, operators, evidence sources) and the rail flyout still close when a toast is pressed, because the press moves focus. Frame popovers stay open.

## Files & permissions (schema 18)

`Settings.FileCheck` holds libraries, checks, target owner and modes, strict mode, ownership options and allowed/ignored name patterns. Availability follows the rename prerequisite (MKVToolNix service with path mappings). Scans reuse the Arr folder lookup of disk placement, walk mapped item folders with `lstat` metadata only and stream findings through a connection-local staging table; publication replaces `filecheck_items` and `filecheck_scan` atomically. A scan stops at 500,000 findings.

Each row is one `(path, kind)` with the fix `chmod`, `take_ownership`, `delete` or `manual`. `/api/filecheck/scan` supports status/start/cancel, `/items` filtered, sortable pages (`sort=title|path|kind|size|fix|status`), `/fix` selected IDs or `{all:true}` with the current filters (never untracked videos), `/cancel`, `/commands` reviewable shell text, and `DELETE /items/{id}` or `/items?fixed=1` for fixed rows. Fixes run sequentially in title/path/kind order under the shared file-operation claim with mux and placement. Every fix re-reads type, mode, owner, size and mtime, confines the path to the item folder and refuses deletions of files Radarr/Sonarr manages. Ownership copies use exclusive hidden partials on the resolved physical disk and an atomic rename; restart recovery removes them.

Schema 17 → 18 creates a consistent pre-migration backup. Schema 19 and newer are rejected. Rollback to 1.3.0 requires the schema-17 snapshot.

## Tool result filters (1.3.2)

Placement `/api/placement/items` accepts repeated `status` and `target` parameters (for example `status=waiting_for_mover&status=conflict&target=disk6&target=disk3`). File checks `/api/filecheck/items` accepts repeated `status` and `kind` parameters; `/api/filecheck/fix` with `{all:true,query:"..."}` reuses exactly those filters, excluding untracked videos. Values within a field combine with OR, different fields with AND. Single values remain compatible; unknown statuses and file-check kinds return HTTP 400. Counts describe the same predicates across all stored findings, including completed rows.

All three tool pages share checkbox result filters, count badges and ordered removable chips. Browser preferences persist canonical filter values and search text independently of the next-scan configuration. Mux filters apply locally after sorting using effective job status; counters, Start all and successful-job removal remain global, while the header checkbox selects visible startable rows.
