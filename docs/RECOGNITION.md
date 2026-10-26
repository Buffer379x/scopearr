# Filename recognition

Open **Settings → Tag rules**. The rule editor previews its draft; the preview above the table uses the current checkbox draft. Both evaluate the filename only, without Radarr, Sonarr or Emby enrichment.

## Rule modes and priority

- **Direct recognition** extracts explicit filename attributes.
- **Only if missing** applies only when direct rules found no value for that attribute.
- **Explicit override** intentionally replaces direct and fallback results for that attribute.

Lower priority numbers run first. Equal priorities use the stable rule ID. Sorting table headers changes the display order only. For scalar attributes, the first matching rule supplies the displayed value. Different values in the winning mode produce a recognition warning with the contributing rules and values. Codec aliases from the same family do not conflict. HDR profiles, audio codecs and languages are additive.

An explicit override resolves lower-mode conflicts deliberately. Two contradictory overrides still warn. Filename/media-server disagreements use a separate metadata warning. Both warning colors can be changed in **Settings → Appearance → Warning colors**. Differences reported only by Radarr/Sonarr are information in file details: they never create a metadata warning, list icon, filter match or export disagreement flag.

## Metadata evidence and manual confirmations (1.6.0)

Each evidence field separates metadata `conflict` from informational differences. A conflict compares a known filename value with measured metadata: **MediaInfo when available, otherwise the media server**. `apiDiffers` compares Radarr/Sonarr with the value Scopearr uses and appears as muted information in file details. A media-server difference is also informational when MediaInfo confirms the filename. With no measured value, there is no metadata-disagreement warning. Recognition-rule warnings remain independent.

Resolution, codec, bit depth and aggregate channels use **filename → MediaInfo → media server → Radarr/Sonarr** priority. Source and processing use filename → Radarr/Sonarr because neither measurement establishes an import source. Saved MediaInfo audio tracks replace media-server tracks for audio, language and channel presentation. Without a measurement, filename languages retain their existing API-language behavior. Codec-family aliases, rule-controlled audio equivalence, additive HDR and compatible Arr source categories retain their comparison rules.

Open **File & metadata** and choose a source in an evidence row's **Used** menu to confirm that source's current value. Only sources with a value appear. The UserCheck marker shows the source, saved value and confirmation date. A confirmation applies to one field: it suppresses metadata disagreement, recognition-rule conflict and informational differences for that field, while preserving findings in other fields. Choose **Automatic** in the same menu to remove it and restore ordinary resolution. The **Confirmed** filter finds files with active confirmations.

For example, `Megan.2.0.2025.1080p.WEB-DL.mkv` can be read as filename channels 2.0 while a matched media server measures 5.1. Confirming the media-server source changes Used to 5.1 and removes that field's warning; Automatic restores the filename value and disagreement. Confirmations belong to the service instance, Arr file ID and byte size. They survive sync rebuilds; a changed size or replaced file ID makes them inapplicable. A source that later has no value is ignored rather than supplying a guessed value.

MediaInfo reads are explicit and optional; see [MediaInfo setup and result lifetime](MEDIAINFO.md). Confirmations and results use additive tables without changing the database schema version. Scopearr 1.5.1 can open the same database and ignores them. Saved disagreement presets and widgets may match fewer files after a read or confirmation. Recognition rules themselves are unchanged.

## Example: missing UHD resolution

Add a rule with:

| Setting | Value |
| --- | --- |
| Name | UHD disc resolution |
| Attribute | Resolution |
| Match type | Token |
| Pattern | UHDBD |
| Result | 2160p |
| Mode | Only if missing |
| Priority | 10 |

`Movie.UHDBD.x265.mkv` recognizes 2160p. `Movie.1080p.UHDBD.x265.mkv` retains 1080p. This fallback does not create a conflict with the explicit resolution. Add a separate Source rule if you also want `UHDBD` recognized as a source.

## Sources and Radarr/Sonarr categories

Filename source and processing values retain priority over Radarr/Sonarr. Arr qualities are broad categories, often derived from the same imported filename. Emby/Jellyfin do not supply a source, so a majority vote cannot resolve source differences.

From 1.5.0, a filename source that refines its Arr category is compatible for metadata disagreement warnings:

| Filename source | Compatible Radarr/Sonarr category |
| --- | --- |
| UHD | BluRay |
| BDRip | BluRay |
| BRRip | BluRay |
| DVDRip | DVD |

The displayed filename value and its existing recognition origin stay unchanged. File details retain the Arr value as evidence and label the broader value as a Category. This comparison is directional: BluRay in a filename does not refine an Arr value of UHD. WEB-DL versus BluRay and WEBRip versus WEB-DL still count as Arr differences; from 1.5.1 they appear as information in file details.

Only these fixed, normalized values are covered. Custom source labels such as `UHD BluRay` remain strict; add no source comparison expression. Conflicting filename rules still produce recognition warnings even when their outputs belong to the same Arr category. Arr-only differences are information. Codec, resolution, bit depth, HDR, audio and channel comparisons retain their existing equivalence rules.

The first-start cache refresh after updating to 1.5.0 recalculates existing source disagreement flags without a new sync. Rules remain readable by 1.4.6; comparison expressions remain audio-only.

## Patterns

Tokens match case-insensitively at separators such as dots, spaces, hyphens and brackets. Regular expressions use Go's RE2 syntax, with bounded input and configuration size and no catastrophic backtracking. Capture references such as `${1}p` can be used in regex results. Invalid expressions are rejected, including lookbehind and backreferences. Zero-width matches cannot infer values.

Advanced controls include an exclusion expression and consuming matched text before subsequent rules in the same attribute and mode. Default audio rules use consumption to distinguish DTS-HD from DTS. Preserve this setting when editing overlapping audio patterns.

Audio rules also expose an optional comparison expression. The default DTS-family rules accept DTS, DTS-HD and DTS-HD MA as equivalent for disagreement warnings, while retaining precise recognized and Emby track labels. Clear the expression for strict comparisons. Default audio-language rules exclude adjacent subtitle qualifiers such as German.Subbed; a subtitle language does not establish an audio language.

## Saving and data safety

Confirming an add/edit dialog, a deletion or a reset saves immediately. Enabled/Tag color checkbox changes remain a draft until Save settings is clicked. Several changes trigger one atomic reprocessing operation; confirmed CRUD retains other unsaved checkbox edits. Each change validates rules, creates a backup and commits rules and the recomputed cache in one transaction. Failed or cancelled changes preserve the previous state. A revision check prevents a stale browser from overwriting another session's changes.

Cache reprocessing makes no upstream reads or media scans. If optional outbound tag synchronization is enabled, a successful save queues tag reconciliation separately. API traits stay separate from filename evidence. Previously matched media-server tracks, HDR data, valid MediaInfo results and manual confirmations are replayed from the cache. A sync that finishes after an edit uses the current rules at commit time. Library filters, CSV, facets and statistics all use the updated cache.

Rules are stored in SQLite, not in the application image. New installations receive the built-in defaults; customized rules remain intact on upgrade. Version 0.5.1 updates only untouched old DTS/language defaults and reprocesses the cache if those defaults change. Keep a complete Appdata backup, including the local key. Rule edits and migrations share the last-three-snapshot retention policy.

## UHDBD source default

Version 0.5.2 adds a specific UHDBD → UHD source override, so a broad BluRay token does not override the more specific disc notation. Resolution stays independent; add a fallback rule if UHDBD should also imply 2160p in your installation. Equivalent existing rules, including customized/disabled rules, are preserved during upgrade.

## UHD BluRay and presentation

The editable `Source / UHD` default recognizes an independent UHD token as Source UHD, including `UHD.BluRay`, `UHD.JAP.BluRay` and `UHD.US.BluRay`. It does not infer a video resolution. Customized/disabled equivalent rules are preserved on upgrade. Standard rule IDs remain unchanged while untouched generated names use a slash separator.

The sortable **Tag color** checkbox controls the matching value's presentation and color availability, independently of recognition, filters and outbound categories. A rule without Tag still provides plain column information. A different rule for the same value does not override that choice unless it also matches the file. Manual custom assignments remain explicit tags. Removed or information-only values are excluded from color choices; API data and filters remain available.

Adding/editing, confirmed deletion and restore save atomically. Checkbox changes save together using the heading Save action. Cached evidence is reprocessed; failures restore the previous rule state, and revision conflicts reject stale edits. Preview uses the current draft.

A token matches a fixed case-insensitive term at separator boundaries. A regular expression describes a pattern, such as `UHD[ ._-]+BluRay`, allowing alternate separators.

The standalone UHD override excludes explicit WEB-DL, WEBRip, HDTV and DVD tokens. In `UHD.WEB-DL`, UHD is a quality indication and the known source remains WEB-DL. The exclusion expression is editable, and an existing user-defined exclusion is preserved during migration.

## Priorities and literal separators

Built-in and user rules share the same priority ordering. Priorities apply within each mode: direct detection runs first, fallback only fills missing values, and explicit override can replace earlier results. Lower numbers run first within the same mode; ID breaks ties. Multiple conflicting single-value results remain visible as a recognition warning.

For `Movie.Ultra.HD.BluRay.mkv`, a Source token `Ultra.HD` returning UHD with priority 95 and Explicit override replaces BluRay. With Only if missing, BluRay remains because the direct rule already found it. A direct UHD rule at priority 95 chooses UHD before the broader BluRay rule but still reports the contradictory direct results.

From 0.6.1, explicit edge separators such as `.Ultra.HD.` supply their own boundaries rather than requiring a second adjacent separator. Interior text stays literal: `Ultra.HD` does not match `Ultra-HD`; use regex for alternative spellings. Existing rule definitions, priorities and modes are preserved. Apply the new matching to cached files by saving a rule or completing the next file-data sync.

## Retained presentation entries

Removing a filename rule retains its known presentation tags and saved colors under Display. Assignment counts use file entries across both libraries and include composite values once per file. Unused entries can be removed after confirmation; linked entries are rejected by both UI and backend. Removing a presentation entry does not delete a recognition rule or change outbound tag groups. A later recognized match restores its default presentation entry.

Custom tags also show file counts. Their local display names remain independent from canonical sync labels; external auto-rule references still protect assignments and deletion.

## Result spelling

Fixed enabled rule results supply presentation labels while internal normalization remains stable. For example, `VP9` displays as `VP9` and retains the existing `vp9` filter/color key. When several fixed results map to the same internal value, override rules take precedence; within a mode, lower priority numbers and then rule IDs win. Language labels continue to use the localized ISO registry. Regex replacement templates retain their normal expanded/normalized values. Disabling/removing a rule removes its presentation alias; cached data and saved presets are not rewritten merely to change label spelling.
