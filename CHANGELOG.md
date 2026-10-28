# Changelog

## 1.7.0 — 2026-10-28

- Keep filter controls and navigation steady when filters expand or job counts change. Show the correct Settings active state and accessible current-page indicators.
- Place state-filter operators beside their labels, improve light-theme secondary-text contrast, and fit mobile library selection actions into accessible icon buttons.
- Return JSON API errors and show translated request/network failures instead of parser messages.
- Cache and compress static assets with representation-specific ETags; load interface languages on demand before switching. Reload once if an older open tab encounters a removed lazy chunk.
- Use indexed status/webhook queries and shared polling that pauses in background tabs. Job-list polling no longer opens media files; explicit mux checks, marking and starting keep full read checks.
- Preserve demo libraries after saving settings, avoid false first-save changes, and omit unknown sign-in names from the event log.
- Remove unused code, tokens and translations; consolidate CSS rules without changing existing workflows, database schema or CSV formats.

Reload the page once after updating. See [validation](docs/VALIDATION-1.7.0.md).

## 1.6.3 — 2026-10-28

- Check media-directory access without creating temporary files or cache folders; mux preflight checks the physical source directory.
- Offer the all-matches terminal script inside Terminal commands, including when no findings are selected.
- Put CSV exports in filter footers; disk-placement exports follow the current filters and display sort.
- Compact tool result filters with adjacent counts and responsive dividers.
- Keep tabbed dialogs anchored and retain their largest height until close, with consistent panel spacing.
- Label tool information columns Info and measure their headings without a sort control.
- Fit scan options into two columns on laptops and keep Scan visible above a scrollable body.

## 1.6.2 — 2026-10-26

- Move Files & permissions and Disk placement scan options into dedicated dialogs; filter panels and presets only filter results.
- Manage allowed/ignored names and copy verification in Unraid settings while preserving existing preferences.
- Select manual findings and export grouped, kind-specific terminal commands for a selection or the complete filtered result.
- Show completed scan timestamps and durations, retaining the previous report while a new scan runs.
- Read MediaInfo from the file-details action row, with the read date beside its section tabs and Result selected only after success.
- Use Film consistently for movie and episode file details.

## 1.6.1 — 2026-10-26

- Explain manual confirmation and MediaInfo read filters; preserve both choices in saved presets.
- Filter files by a current MediaInfo result, including exclusion and disabled-service presets.
- Add Custom tags management help for assignment sources, counts, names, colors and creation.
- Replace expandable MediaInfo track sections with session-persisted tabs and side-by-side track tables.
- Widen File & metadata to 1060px while keeping Used evidence on one line and companion dialogs at their existing widths.

## 1.6.0 — 2026-10-26

- Add optional, explicit MediaInfo file inspection with signed package installation, shared path mappings, saved normalized metadata and track details. Bound reads to one file, 120 seconds and 4 MiB of command output; keep syncs and webhooks independent.
- Let users confirm an available evidence source for each metadata field, retain valid choices through sync rebuilds and restore ordinary resolution with Automatic. Prefer MediaInfo measurement over media-server and Arr fallback; keep other fields' warnings independent.
- Rename videos and selected companions directly on each file's Unraid device without hardlinks or cross-device copies. Block duplicate-file previews, reverse failed moves on their own devices and warn when completed service refreshes create folder presence on another device.
- Create custom tags in single-file and selection dialogs when applying assignments, reuse case-insensitive existing names and enforce the catalog limit atomically.
- Add the default file-owner card under Unraid settings, carry forward existing file-check values and keep unsupported owner fixes Manual.
- Remove unseen-error dots from Settings/Log and the job-log link from event details; retain the event log and add metadata/mediainfo sources.
- Add field_confirmations and mediainfo_results tables without a schema-version increase. Rollback to 1.5.1 is supported without restoring a database backup; the older version ignores the new features. Retain the 512 MiB memory budget without additional swap.

## 1.5.1 — 2026-10-25

- Warn about metadata disagreement only when a known filename value disagrees with measured media-server metadata. Show differing Radarr/Sonarr values as muted information in file details, independently of media-server configuration or match status.
- Prefer measured resolution, codec, bit depth and channels over Arr fallback values when the filename has no value. Keep existing comparison rules, source-category refinements and separate recognition/provider conflict states.
- Refresh cached disagreement flags once after an upgrade, with one backup and transaction for all pending derived-metadata markers. Reconcile active tag-sync instances through the existing approval safeguards.
- Give System overview cards equal height within each grid row and move password changes into a dialog with native validation and independent form submission.
- Show 25 event-log entries per page while keeping the API default and complete export unchanged.
- No schema or recognition-rule format change; unrestricted rollback to 1.5.0. Disagreement presets and widgets can match fewer files after the correction.

## 1.5.0 — 2026-10-25

- Measure tool status columns from every translated short label, preserve whole status tags and align progress bars and idle markers to the left with a fixed percentage slot. Remeasure after language changes and webfont loading.
- Classify cropped media-server video rasters by tolerant resolution tiers (1912 × 796 → 1080p; 3832 × 1600 → 2160p). Recognize bracketed speaker layouts such as 5.1(side), and quad as 4.0, consistently in the backend and track details.
- Treat filename sources that refine the Radarr/Sonarr category (UHD, BDRip, BRRip → BluRay; DVDRip → DVD) as compatible. Keep specific filename values and real disagreements; label broader Arr evidence as Category.
- Refresh cached media details once after creating a backup, without an upstream sync. Update only changed file JSON, queue active tag-sync instances and retry safely after a failed transaction.
- Show excluded filter chips and selected filter buttons in the error color. Move Change password into the third System overview card with its own externally associated form.
- No schema, recognition rule or dependency change; unrestricted rollback to 1.4.6. Saved filters containing old channel or resolution values may need adjustment.

## 1.4.6 — 2026-10-25

- Treat cache/pools as ordinary consolidation sources and always choose an eligible array target, including empty or new array folders. Include these rows in Start all; respect Prefer/Only share cache policies and keep mover/parity exclusion while those operations run.
- Store bounded placement checks with their timestamp and concrete source-file details. Retain checks across reloads and unchanged scans, show saved blockers on status badges and clear diagnostics with their row.
- Block only on unreadable or unremovable sources and existing move safeguards. Different owners produce a warning, confirmation count and audit event; copies belong to 99:100 and retain their modes and times. Preserve recovery verification across intentional ownership changes.
- Reuse library mux-marking removal on the Mux page, preserving protected jobs, confirmation, progress and one outcome toast.
- Additive check_result column with unchanged schema version; unrestricted rollback to 1.4.5. No dependency changes. Run a new disk-placement scan after updating.

## 1.4.5 — 2026-10-25

- Make disk placement presence-based across array disks and pools; include blocked and mover results in Several disks. Detect fully empty folders on one or several devices and distinguish them from Empty copies. Keep cache-only content with empty array copies visible and unplanned until the mover runs.
- Detect ordinary #/@ media folder names while excluding exact reserved system names. Preserve metadata-only scanning and unrelated-share boundaries; retain known device presence on read errors and block moves that would leave special entries behind.
- Store share/device facts additively, share SQL predicates between filters and live counts, and add live per-share report drilldowns plus the Several disks by result breakdown. Keep target folders untouched during empty-copy cleanup, including zero-byte media.
- Share heading count badges across tools, libraries and the log. Log saved settings areas and redacted field details, omit no-op events, and record custom-tag, tag-rule and preset changes. Translate area arrays.
- Align half-width service fields and keep settings section headings stable without a save action. No dependency or schema-version change; unrestricted rollback to 1.4.4 and a fresh scan after updating.

## 1.4.4 — 2026-10-25

- Make disk placement share-first: resolve each Radarr/Sonarr root to its share folder, read each share once per disk, scan only Arr-reported shares, list folders without an Arr entry and keep shared Radarr/Sonarr roots together. Path mappings are no longer required for disk placement. Add the Unraid Shares settings card and the report's Shares table.
- Remove result-dependent boxes between tool filters and results; show scan errors as toasts and notices in the report with a dot on its icon.
- Close dialogs after a successful save; align tool page rhythm, Scan height and card heading heights.
- Add Settings → System Info/Log tabs and a 24-hour event log with search, filters, sorting, details, export, Clear, credential redaction, an unseen-error dot and Show in log from error toasts.
- Additive `event_log` table without a schema version change; no dependency update; unrestricted rollback to 1.4.3.

## 1.4.3 — 2026-10-24

- Match shared Arr roots by instance ID and normalized source origin in both scanners. Add From Arr coverage and mismatch help to the placement report.
- Limit library selection and group checkboxes to visible rows; clear on paging and sorting. Remove global-selection UI/API and extra group counters while preserving explicit selected-file tag writes.
- Replace page-wide tool progress with inline activity and combine scan information/help. Add mux help, inline fixed-list hints, shared settings headings and contextual tag-rule guidance.
- Use short verb confirmations, sequential page-sized mux marking and one outcome toast; silently skip existing markings and preserve protected jobs on removal.
- No schema migration or dependency update; unrestricted rollback to 1.4.2.

## 1.4.2 — 2026-10-24

- Explain every disk-placement decision: missing folders, verified actual share paths, seasons spread across disks, searchable compact one-disk rows and a per-root scan report.
- Fit standard tables at 1440 px using measured translated headers, clear control columns and a shared compact progress column.
- Select movies, series, seasons and episodes across pages with partial states and an explicit 10,000-file limit. Keep group counts in the page snapshot, bounded to page-series keys without a second pooled connection.
- Mark selections for muxing sequentially (200-file cap), cancel after the active file, remove eligible markings and set tags on explicit files. Confirm multi-entry actions in libraries and tools; add the configurable mux info icon.
- Align settings spacing, move tag-rule actions to row ends and fields below headings, combine Lists & columns into one card with an Icons tab, and show media-server match dates/counts.
- Replace filtered-view tagging with Select all matching → Set tag. Remove the bulk default-rule reset and redundant rule count.

No database schema change or dependency update. Mux icon preferences remain readable by 1.4.1; after rollback, run a new disk-placement scan. Keep **512 MiB without additional swap**.

## 1.4.1 — 2026-10-23

- Give every stylesheet selector one owner and guard against cross-file cascade reversals. Fix dashboard language layout, shared charts, flag alignment and equal-height widget rows.
- Sort every TV column with separate movie/series preferences, flat episode sorting outside the default grouped title order, and matching CSV order.
- Share floating surfaces, accessible tooltips, segmented tabs, filter rows and filter footer slots across libraries, tools and settings. Add tool filter presets without saving scan options.
- Move Scan and progress to the results area. Put independent Shares filters under Libraries, retain missing-mapping actions, and add a filtered Files & permissions CSV export.
- Explain disk tags and overflow disks in keyboard/touch-accessible tooltips. Use real table semantics and consistent editor controls, headers, number alignment and three-step sorting.
- Reorganize Display into General, Lists & columns and Colors; share ordered lists; simplify Widgets, Services, System and custom-tag settings; keep Save reachable while scrolling.

No database migration. Rollback to 1.4.0 is unrestricted; it simply hides tool presets. Keep the container budget at **512 MB**.

## 1.4.0 — 2026-10-23

- Apply the interface style guide throughout the app, including settings: shared scale/status tokens, icons, controls, checkboxes, surfaces, table headers, titles and dialog footers; consolidate area stylesheets.
- Stabilize all tool table columns and row heights during removal; retain long-title details and phone actions.
- Count only open tool jobs; unify labeled counts, pagination, cleanup wording and plural forms in all four languages. Use adaptive file-size units and localized percentages.
- Show covered Arr root folders, verified one-click mapping suggestions and a detected Share filter. Additional roots such as documentaries become visible after a manual rescan.
- Renew active sessions over seven days with a 30-day cap; preserve the view through temporary session errors and restore navigation after sign-in.
- Update Preact, Lucide and approved Actions; use Node 24.22.1 LTS while Node 26 awaits LTS. Keep TypeScript 5.9.3.
- Migration: additive `sessions.created`; rollback to 1.3.3 supported. Container budget remains 512 MB.


## 1.3.3 — 2026-10-22

- Align reset, information and help icons in the filter footers of Disk placement, Files & permissions and Muxing.
- Start tool filters collapsed on every page visit and reload. Keep active filter tags, search values and scan/job progress visible; discard obsolete saved collapse preferences.
- Color the target disk green and every source disk orange in the Disks column, Target column and item details. Without a target, highlight the largest existing share, breaking ties by disk name.
- Match the explanation and notice typography in Files & permissions details.
- Give completed-row remove buttons consistent spacing from the right table edge while retaining fixed progress/removal column widths.

No database migration. Rollback to 1.3.2 is unrestricted. Keep the container memory budget at **512 MB** (`--memory=512m`, without swap).

## 1.3.2 — 2026-10-22

- Attribute automated changes to Buffer379x and correct the accidental AI co-author metadata in default-branch history; existing release tags remain unchanged.
- Open Movies, TV series and Tools directly when exactly one destination is available; show a dropdown only for multiple choices.
- Unify result filters in Disk placement, Files & permissions and Muxing: checkbox lists with count badges, removable filter tags and reset. Choices and searches persist locally in the browser.
- Support multiple placement statuses/targets and file-check kinds/statuses. Values within each field match with OR; fields combine with AND. Fix all acts on the filtered findings and always excludes untracked videos.
- Add filename/status filtering to mux jobs. Select all selects visible startable jobs; Start all and Remove successful jobs remain global.
- Move mover/parity state and the last scan time into an information popover next to scan help. Move allowed/ignored names below the libraries.
- Give every disk a visible tag, including intermediate disks in items spread over three or more disks. Reserve table widths for progress and removal buttons.
- Improve spacing and the explanation box in file-check details. Remove the header/tab subtitles and login marketing copy while keeping the centered artwork.

No database migration. Rollback to 1.3.1 is unrestricted. Keep the container memory budget at **512 MB** (`--memory=512m`, without swap).

## 1.3.1 — 2026-10-22

- Rebuild the main menu with subpages: Movies and TV series list each (renamed) Radarr/Sonarr service; Tools groups Muxing, Disk placement and the new Files & permissions page.
- Add Files & permissions: metadata-only scans for wrong permissions, foreign owners, hidden and junk files, orphaned companions, untracked videos, other files and empty folders; fix single, selected or all findings in a sequential queue.
- Change permissions of Scopearr-owned items, delete findings after confirmation and take ownership of files by copying them on the same Unraid disk; provide reviewable terminal commands where the non-root container cannot act.
- Make columns sortable in Muxing, Disk placement and Files & permissions without changing the processing order.
- Disk placement: start mover items manually, short colored status tags, green remove buttons, colored disk tags, target tags, a compact disk selection with an edit dialog and a terminal icon matching Muxing.
- Show sizes in decimal GB/MB everywhere; the disk placement reserve keeps its number as GB.
- Migrate schema 17 → 18 after an automatic backup; rollback to 1.3.0 requires that backup.

## 1.3.0 — 2026-10-22

- Add the Unraid service with physical disk/pool discovery, path checks and optional mover/parity status.
- Add Disk placement: metadata scans, target summaries, greedy planning, CSV export, configurable columns and four-language UI.
- Move items sequentially with progress, cancellation, exclusive verified copies, preserved metadata and restart recovery.
- Write mux output and backups on the original physical disk or pool, with an explicit user-share fallback and a shared placement/mux lock.
- Add optional `/unraid` and read-only `/unraid-state` mounts; keep the 512 MiB container budget.
- Migrate schema 16 → 17 after an automatic backup; rollback to 1.2.6 requires that backup.

## 1.2.6 — 2026-10-21

- Reorganize file details with compact title/filename fields, inline track titles, matching help and consistent section spacing.
- Rename movie and episode files safely, preserving extensions and validating Sonarr series/episode identities.
- Preview and optionally rename companion subtitles, metadata and artwork; prevent collisions and roll back partial failures.
- Rescan Arr, queue Scopearr library updates and notify configured media servers after renaming.
- Preserve format names and relative source references in redacted mux logs; explain damaged sources, space, permissions and format errors.
- Keep schema 16, the 512 MiB container budget and unrestricted rollback to 1.2.5.

## 1.2.5 — 2026-10-21

- Build with Go 1.27.3 to address GO-2026-6809 in crypto/x509.

- Persist mux results despite concurrent revisions, retry locked writes and recover orphaned running jobs with a watchdog.
- Verify durations against retained tracks when removing longer audio/subtitle tracks; allow longer source/output identification checks.
- Log every post-mux step and concrete failure details; show Arr rescan waiting states and safe recovery after timeouts.
- Remember dashboard scope in browser preferences and keep the enabled Muxing tab visible even with no jobs.
- Use fixed full mux columns, orange waiting tags and consistent contributing-library/outbound-tag checkbox spacing.
- Keep schema 16 and legacy column fields for unrestricted rollback to 1.2.4.

## 1.2.4 — 2026-10-20

- Fit mux tables to their row count and match library-style uppercase table headers.
- Align status checks and timestamps, suppress redundant progress messages and retain actionable warnings.
- Apply the global original-deletion policy when each job starts; ignore per-job client overrides.
- Widen mux options and path-check dialogs and unify MKVToolNix version-value typography.
- Preserve checkbox/text spacing, require no migration and support unrestricted rollback to 1.2.3.

## 1.2.3 — 2026-10-20

- Merge per-instance mux mappings into one global, rollback-safe mapping, with root-folder import from enabled Arr services.
- Check unsaved mapping/work-directory input with syntax line numbers, directory access, free space and cached samples in a results dialog.
- Replace mux cards with a configurable library-style table, status/check dialogs, track options and a redacted live terminal.
- Require saving mux options to reach Ready before starting; existing drafts must be saved once.
- Keep service tabs in one scrollable row and align mux settings/radios/track controls and their vertical spacing with existing service styles.

## 1.2.2 — 2026-10-20

- Raise deployment and load-test memory budgets together to 512 MiB after a repeated 100k/two-media-server sync reproduced an OOM at 256 MiB. Existing containers must update their saved memory limits manually.

- Give atomic recognition rewrites a bounded five-minute budget and report timeout failures as HTTP 503 without publishing a new rule revision.
- Avoid duplicate recognition work when reprocessing files with cached media-server matches, preserving tracks and evidence.
- Report HTTP response details and the failing phase in the 100k container test; support controlled CPU-limited reprocessing checks.
- Require successful Main CI for the exact release commit before publishing a release or promoting stable.

## 1.2.1 — 2026-10-20

- Keep timed, interactive notifications above modal dialogs without blur or timer resets; remove duplicate mux errors from file details.
- Suggest an optional Unraid media-root mount and a separate mux working-directory mount; existing containers adopt these manually.
- Allow separate mux output directories with verified, cancellable cross-mount staging and restart cleanup. The same-folder default is unchanged.
- Sort service tabs alphabetically, including MKVToolNix, and align its settings with the other services using dedicated tool, mappings and processing sections.
- Retain schema 16 with no database migration; rollback to 1.2.0 ignores the new settings field.

## 1.2.0 — 2026-10-20

- Add opt-in MKVToolNix downloads in Appdata, stable/edge package channels and per-library media mappings.
- Add individual file marking, editable tracks/output and a persistent single-worker mux queue with selection, progress and cancellation.
- Verify output before replacement, preserve backups, delete originals through Arr and rescan/sync/notify after publishing.
- Migrate to schema 16 with backup, keep mux paths private and translate the feature into English, German, Spanish and Italian.
- Document optional read-write mounts, 512 MiB memory and manual template adoption.

## 1.1.1 — 2026-10-20

- Refresh technical tags that Scopearr set when a file changes in Keep-and-only-add mode, including after background webhook and scheduled synchronizations. Unknown placeholders such as `resolution-unknown` are removed once the new file provides the value.
- Continue to preserve foreign, manual, kept-group and rule-protected assignments; removal of Scopearr-managed values needs no review.
- Apply the same rule to Emby/Jellyfin items for tags Scopearr added, and clean previously accumulated values once after upgrading.

## 1.1.0 — 2026-10-18

- Add named multi-instance connections with service tabs, stable identities and an instance filter for combined libraries.
- Preserve instance-scoped caches, credentials, schedules, webhooks, storage and tag ownership during migration.
- Add opt-in outbound Emby/Jellyfin tag synchronization for matched movies and individual episodes, with combined multi-source values and confirmed removal previews.
- Preserve unrelated media-player metadata and retain the bounded synchronization queue. See the [service guide](docs/SERVICES.md).
- Reduce large-library memory retention and accelerate cold tag-color counts without changing their values or provenance.

## 1.0.3 — 2026-10-18

- Unify Custom tags and Tag colors table controls, sizing and alignment while keeping editable names.
- Remove duplicate custom-tag previews and obsolete table styles without changing save or deletion behavior.

## 1.0.2 — 2026-10-18

- Add configurable SD tag colors while grouping is enabled and retain saved colors when it is disabled.
- Share complete SD counts with the cached color catalog without creating real tags or additional scans.
- Alphabetize filter choices by their localized display labels and keep Unknown last.

## 1.0.1 — 2026-10-18

- Mark tag-color values actually supplied by Emby/Jellyfin metadata with an accessible circled-exclamation tooltip, without changing tag visibility or upstream synchronization.
- Display fixed recognition-rule results with their configured spelling while preserving stable internal filter and color keys.
- Pair the TV view and Pagination cards and add saved dashboard SD grouping with an optional dependent list/filter setting.
- Preserve exact resolution details and add consistent SD drilldown/filter/export selection without extra upstream requests.

## 1.0.0 — 2026-10-17

- Harden configuration, tag reconciliation, session revocation, startup validation, database paths and Sonarr snapshot integrity.
- Keep reads and sync status responsive during writes; support cancellable, generation-checked snapshot commits and bounded password verification.
- Cache the read-only tag catalog, load authenticated pages on demand, remove duplicate requests and guard browser preference storage and stale responses.
- Split large modules and share custom-tag cleanup; remove unreachable UI code, unused helpers/styles and a duplicate embedded asset without changing the interface or feature set.
- Refresh GitHub highlights/screenshots and add targeted regression coverage. See [release notes](docs/releases/1.0.0.md) for validation and upgrade details.

## 0.9.5

- Require a tag-color recognition rule for codec frames again, including API-only codecs.
- Align channel rows with their verified audio tracks, preserving duplicate channel layouts.
- Add configurable media-server links to the Info column, with a provider picker for multiple enabled servers.

## 0.9.4

- Keep wide settings tables inside their own scroll areas on narrow screens; prevent the new tag display column from widening the page.

## 0.9.3

- Aggregate known channel layouts across all verified audio tracks, preserving language-to-codec pairing and channel-count fallbacks.
- Render API-only codecs such as vp9 with the regular tag style.
- Add saved per-tag display checkboxes for library cells and filter choices without changing totals or stored data.

## 0.9.2

- Fill missing video resolution, codec and bit depth from verified Emby/Jellyfin file matches, with provider evidence and safe cache reprocessing.
- Read MPEG-4 FourCC identifiers and explicit audio layouts without guessing source or language.
- Group the matching widget into four explained, non-overlapping states while retaining detailed filters.

## 0.9.1

- Fix dashboard widget alignment and filter operator alignment; add localized filter explanations.
- Add a separate sortable Processing column and preserve existing layouts.
- Refine display settings labels and use an iPad-friendly sync time text input.

## 0.9.0

- Configure visibility and order of the six graphical dashboard widgets, with a restore-defaults control.
- Configure a shared page size for Movies and TV series (default 100, range 1–1000).
- Persist these settings and retain full CSV exports, bulk operations and season context.

All project versions follow semantic versioning. Every release has an English entry under `docs/releases/`.

## 0.8.0

Independent Emby/Jellyfin connections, media-server matching checkboxes, indexed technical/language season outliers with explanations and CSV, parallel incoming/outgoing tag controls, clearer shared-storage identities, and German Quelle labels. Schema 14 preserves existing data with a backup.

## 0.7.3

Persistent tag presentation catalog, assignment counts and safe deletion, local names for external custom/auto-tags, editable storage path names, service-level sync actions, consistent tag settings and collapsed library filters. See [release notes](docs/releases/0.7.3.md).

## 0.7.2

Storage area navigation, optional inbound custom-tag reconciliation, protected external auto-tags with rule information, shared custom-tag color controls and schema 12. See [release notes](docs/releases/0.7.2.md).

## 0.7.1

Individual storage-area charts without summing overlapping shares, independent dashboard cards, Audio codec distribution, compact widget headings and reset controls, service-heading connection tests and a revealable webhook password. See [release notes](docs/releases/0.7.1.md).

## 0.7.0

Clock-anchored sync schedules, authenticated targeted webhooks, selected/shared storage capacity widgets, automatic release notices, sortable Info icon counts and library layout refinements. See [release notes](docs/releases/0.7.0.md).

## 0.6.3

Configurable Info action column with new-tab Radarr/Sonarr links, file details and both warning indicators; persistent icon visibility/order and per-library Info column ordering. Existing layouts and cache rows remain compatible. No database schema migration. See [release notes](docs/releases/0.6.3.md).

## 0.6.2

Shared ISO 639-1/2/3 metadata registry, localized language labels and bundled flags; immediate custom-tag writes; guarded rule-dialog dismissal and visible cache-save progress. Schema 11 reprocesses cached language evidence with a consistent backup. See [release notes](docs/releases/0.6.2.md).

## 0.6.1

18 saved, contrast-tested interface palettes in both modes; Tag color checkbox and mode guidance in rule dialogs; literal separator token fix; clarify local language-flag mappings and the distinction between language and country tokens. No database migration. See [release notes](docs/releases/0.6.1.md).

## 0.6.0

Saved Default/Nordic/Catppuccin interface palettes in both modes; simplified status filters and accessible filter help; compact language color settings and bundled Turkish flags. No database schema migration. See [release notes](docs/releases/0.6.0.md).

## 0.5.4

Fixed-size language flags without tag badges; Tag rules/Tag color naming; batched checkbox drafts with explicit Save and independent immediate CRUD; serialized cache reprocessing and immediate SQLite writes; standalone/regional UHD source recognition preserving custom rules; simpler tag-sync settings; clean empty Custom cells; host-compatible Unraid RAM parameters. Schema 10 makes a consistent backup. See [release notes](docs/releases/0.5.4.md).

## 0.5.3

Reviewed tag-removal plans with provenance and protection for new foreign assignments; category-scoped unknown output tags; editable UHD BluRay recognition; rule presentation flags and atomic autosave; per-file custom assignment; unified Display controls and settings header actions. SQLite schema 9 preserves existing data. See [release notes](docs/releases/0.5.3.md).

## 0.5.2

Default UHDBD-to-UHD source recognition; confirmed append/replace and keep/delete tag policies; durable group retention and safe unused-definition cleanup; deletion confirmations and muted-red controls; compact collapsed filters and full-width language selection. SQLite schema 8 preserves existing data and customized rules. See [release notes](docs/releases/0.5.2.md).

## 0.5.1

Opt-in authoritative Radarr/Sonarr tag synchronization; editable DTS comparison tolerance and subtitle-language exclusions; searchable recognition rules; simplified presets and reset controls; consistent settings spacing and filename preview layout; compact indexes for cold Dashboard queries. SQLite schema 7 retains existing configuration and customized rules. See [release notes](docs/releases/0.5.1.md).

## 0.4.1

Automatic toast notifications; explicit settings drafts and atomic custom-tag saves; consistent settings cards; HTTP-compatible rule creation; synchronization controls in System; expandable top-five Dashboard distributions. No database schema migration. See [release notes](docs/releases/0.4.1.md).

## 0.4.0

Scopearr branding; persistent custom tags with administration, atomic bulk assignment, filters, colors and filename recognition; custom CSV output; compatible upgrade to SQLite schema 6. See [release notes](docs/releases/0.4.0.md).

## 0.3.3

Consistent tables for tag and warning colors; bordered icon controls; uniform dropdown sizing; simplified settings footer; permanently visible filename-preview results with a wider input above. No database schema migration. See [release notes](docs/releases/0.3.3.md).

## 0.3.2

Grouped filters with persistent search and checkbox multi-selects; compact operator icons; full-page settings; compact color controls with confirmed resets; equivalent-preset rejection; manual service synchronization; removal of the audio info icon. No database schema migration. See [release notes](docs/releases/0.3.2.md).

## 0.3.1

Consistent Dashboard/library heading and card positions; Dashboard clicks select existing unsaved filters; removal of the Dashboard footer; persistent black/white/automatic tag text colors; reduced memory overlap during large syncs. No database schema migration. See [release notes](docs/releases/0.3.1.md).

## 0.3.0

Configurable filename recognition with previews and atomic cache reprocessing; separate, customizable recognition warnings; conflict and Emby matching filters; unified Audio column; clickable language distribution; consistent Dashboard heading and title-icon details. SQLite migration to schema 5 retains settings, presets and cached Emby tracks. See [release notes](docs/releases/0.3.0.md).

## [0.2.3] — 2026-10-11

See [0.2.3 release notes](docs/releases/0.2.3.md): full-canvas icons, consistent default tag outlines, unified responsive System settings and corrected screenshot sources.

## [0.2.1] — 2026-10-11

See [0.2.1 release notes](docs/releases/0.2.1.md): system information in settings, movie/series navigation, full-size icons and consistent custom tag borders.

## [0.2.0] — 2026-10-11

See [0.2.0 release notes](docs/releases/0.2.0.md): four interface languages, translation contribution support, dashboard filter drilldowns, audio language flags, and enforced version consistency.

## [0.1.0] — 2026-10-11

See [initial release notes](docs/releases/0.1.0.md).

[0.2.0]: https://github.com/Buffer379x/scopearr/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Buffer379x/scopearr/releases/tag/v0.1.0
[0.2.1]: https://github.com/Buffer379x/scopearr/compare/v0.2.0...v0.2.1
[0.2.3]: https://github.com/Buffer379x/scopearr/compare/v0.2.1...v0.2.3
