# Scopearr 1.4.4 validation

Validated on 2026-10-25 against 1.4.3 (`704f73c`). Synthetic fixture sources and browser scripts remain in ignored `work/ui144*`. The images below contain no private library data.

## Automated checks

- Frozen pnpm installation, TypeScript, **130 frontend tests**, production build and dependency audit pass. No known frontend dependency vulnerabilities; the existing Vite large-chunk advisory remains. Dependencies are unchanged.
- Linux Go 1.27.3: gofmt, Vet, Staticcheck v0.8.2 (`all,-ST*`) and the full race suite pass (`internal/app`: **298.229 seconds**). Seven release-script tests pass. Version, package, both Docker defaults and English release notes agree on 1.4.4.
- With `GOMAXPROCS=2`, the 50,000-file query fixture records p50 **47.35 ms**, p95 **93.14 ms**, below the unchanged 200 ms gate. Custom-tag filtering p95 is **106.14 ms**; the 50,000-row compact placement test passes in **2.41 seconds**.
- The release image builds and starts as **99:100** with memory and memory-plus-swap at **512 MiB**; the health check answers and the event log records the start-up. The 100,000-file container check runs in the Approved release workflow.

## Share-first disk placement

Go tests cover a root shared by named Radarr and unnamed Sonarr **without any path mapping**: `/documentaries` is read once per device and reports 4 folders, 3 on several disks, 1 on one disk, 1 without an Arr entry and 1 Arr entry without a folder. A `Fotos` share next to it is never read; counting metadata calls proves one directory listing per share and device and a recursive walk only for folders on two or more devices. Saved choices (including Do not scan), second-level shares such as `media/documentaries`, season grouping, ignored dot/`@`/`#` folders and symlinks, unresolved roots and Arr failures are covered separately. Starting a scan through the API now succeeds without MKVToolNix or mappings; malformed mappings still block it, and Files & permissions and physical mux output keep requiring mappings.

The browser fixture shows the same layout: documentaries for Radarr and Sonarr, `/archive` and `/dokus-alias` unresolved with notices and **Open in settings** inside the report, and a dot on the report icon. No result-dependent box remains between the filters and the results on either scanner; scan errors appear once as a toast. This is synthetic evidence; run a fresh scan after updating and compare **On several disks** with the host command in the release notes.

## Layout and dialogs

All five library and tool pages measure the same filter panel height (158 px), a 24 px gap to the results heading (34 px) and the 200 px preset select at 1440 px. Settings card titles align at the shared minimum height with and without actions. Mux options, recognition edits, presets and file-check lists close after a successful save.

## Event log

Go tests cover filters (level, source, instance), search over message keys, parameters, subject and detail, all sort orders, counts that omit their own filter, pagination, text and JSON export, Clear (blocked in demo mode), 24-hour rotation, the 20,000-row limit removing old info first, merging within 10 minutes, a full buffer dropping only info entries and redaction of URL credentials, API keys, tokens, passwords and authorization headers. A finished placement scan writes exactly one completion event. Reads and exports drain the background writer first.

In the browser fixture with **320 seeded entries**, the log renders time, level tag, source and message with subjects; the Level filter shows counts (42 / 122 / 41) and reduces the list to errors; the details dialog shows key values and wrapping technical detail with Copy. Unseen errors mark the settings button and the Log tab and clear when the log is opened. At 375 px the page has no horizontal overflow; the table scrolls inside its wrapper. No browser errors occurred.

Independent fixes found during validation: test fixtures wrote server settings without the lock and returned instance slices aliasing the server's settings; both are corrected in the shared fixture.

## Selected synthetic images

- [Shares report](images/releases/1.4.4/shares-report.png)
- [Unraid Shares settings](images/releases/1.4.4/shares-settings.png)
- [Disk placement list](images/releases/1.4.4/placement-list.png)
- [System log](images/releases/1.4.4/system-log.png)
- [Log entry](images/releases/1.4.4/log-entry.png)

## Compatibility and publication

The `event_log` table is additive (`CREATE TABLE IF NOT EXISTS`); the schema version is unchanged and no dependency changes. Rollback to 1.4.3 has no restrictions. A new manual scan refreshes placement results; no background scan starts as part of the update.

The Approved release workflow gates publication on exact-main CI, both image architectures, runtime vulnerability scans and the existing 100,000-file container test at 512 MiB without additional swap. The maintainer identity and complete messages are checked before every commit; no assistant attribution is added.
