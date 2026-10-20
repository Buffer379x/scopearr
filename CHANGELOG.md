# Changelog

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
