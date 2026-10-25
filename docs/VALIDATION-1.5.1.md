# Scopearr 1.5.1 validation

All services, media, accounts and images used here are synthetic. Go checks run only in `golang:1.27.3` containers. No private library or Appdata is included.

## Automated checks

The frontend frozen-lockfile install, TypeScript check, **155 tests**, production build and moderate-or-higher dependency audit passed. No dependency changed. Vite retains its existing advisory for chunks larger than 500 kB. The source/package/Docker/release-notes version check and all **7 release-CI guard tests** passed.

The final full Go race suite passed in **349.844 s**; Vet, Staticcheck v0.8.2 and govulncheck v1.8.0 also passed. No called or imported vulnerability was found; one advisory affects an unused required-module path. Formatting and whitespace checks passed. An existing shared test fixture returned an instance slice aliased to live server settings; a deterministic regression now guards the copy, and its placement test also passed three race-enabled repetitions.

## Metadata semantics

Backend regressions cover filename 1080i / Arr 1080p / measured 1080i without a warning, genuine x265 / measured h264 disagreement, and Arr-only differences with missing, pending, ambiguous or unconfigured media data. Resolution, codec, bit depth and channels use the measured fallback ahead of Arr when the filename has no value. Filename values remain visible.

Category refinements, audio comparison rules, primary codec containment, combined languages and additive HDR retain their existing behavior. Conflicts between media providers remain a separate provider finding. Filter and CSV tests retain measured-conflict coverage. `apiDiffers` is omitted from JSON when false and recalculated from the final displayed value.

Channel measurements distinguish known layouts from counts: filename 5.1 and measured 6 ch do not establish a layout disagreement; filename 5.1 versus an explicit measured 6.0 does. A measured six-channel stream still disagrees with filename 2.0. The count fallback does not invent an LFE layout.

## Cache upgrade and rollback

New tests cover upgrades with only the 1.5.0 marker and direct upgrades without either marker. Both perform one refresh and backup, correct indexed flags and evidence JSON, mark active instances for tag reconciliation, and store both completion markers. A second startup performs no refresh. Existing empty-store tests retain no-op backup and event behavior.

A trigger that rejects the final marker proves that changed data, tag flags and earlier markers roll back together. Startup remains available, logs the failure and retries successfully on the next start. Existing tag-removal approval safeguards remain in place.

There are no new columns, schema version or recognition-rule fields. A populated synthetic 1.5.0 cache was started with the review image read-only as **99:100**, with memory and memory-plus-swap both **512 MiB**. Health returned **1.5.1**, logs recorded the refresh and `Scopearr 1.5.1 started`, and OOM remained false. Resolution became 1080i, the warning cleared, `apiDiffers` became true, both markers were present, and schema version stayed **18**. Exactly one backup retained the old warning.

The actual published **1.5.0 image** then started against that updated Appdata. Its authenticated files API returned the same resolution and cleared warning while ignoring the new JSON property, proving old cache/rule reading without a restore. Its earlier disagreement interpretation can return on a later reparse, as documented in the release notes.

## Performance and memory

These measurements used **GOMAXPROCS=2**, **512 MiB RAM** and **512 MiB memory-plus-swap**, with no additional swap allowance. The test binary was compiled before applying the runtime memory cap.

| Check | Result |
| --- | --- |
| Refresh 50,000 files, both release markers | **18.74 s**, **14.10 MiB** sampled peak heap; budget ≤60 s and <512 MiB |
| 50,000 cached-file queries | p50 **45.05 ms**, p95 **76.44 ms**; budget p95 ≤200 ms |
| Statistics over 100,000 files | **791.58 ms** |
| 50,000-file custom-tag filter | p95 **91.55 ms** |
| 50,000 placement rows, scan and search | **3.32 s**, without retained file lists |
| 50,000 episode season-outlier filters | p95 **40.67 ms** (matches), **27.27 ms** (season) |

All selected performance tests passed.

## Interface checks

Chromium and WebKit on macOS and Firefox in the official Playwright 1.62.1 Linux container use the same real local backend fixture. Each engine covers German and Italian, light and dark, and **1440/820/375 px**: **36 System/dialog layouts** and **108 file-detail cases** in total, with no page errors.

Only the genuine measured codec disagreement has a list warning and yellow detail row. The 1080i example and a WEB-DL/Arr-BluRay file without a media match show muted Arr information, accessible title/label explanations and no yellow row. The agreement explanation is present only when measured data agrees. Mobile details fit the viewport.

The three System cards stretch equally within each grid row: desktop cards measured **162.5 px** in Chromium/WebKit; the first tablet row has equal heights, and the single-column layout follows natural content height. Password fields open in the standard dialog, belong to the external password form and initially focus the current password. Native required/minimum-length validation, cleared values on Escape/Close/Cancel, Enter submitting only `PUT /api/password`, sign-out and new-password login were checked. No settings write or dirty indicator appeared. Native autocomplete attributes remain available; third-party password-manager extensions were not tested.

Firefox's native validation popup consumes the first Escape after an invalid Enter; the next Escape dismisses the dialog and clears fields. The harness accounts for that native popup. Log reload checks wait for focus scrolling to settle before taking their baseline.

A real 120-entry log shows **25 rows** on the first page and **20 rows** at offset **100**. Newest-page auto-reload after entry 121 keeps the displayed row count at **25** and preserves focus and scroll. API default-limit and complete-export behavior remain unchanged.

An independent code review found no remaining critical, important or minor issues.

## Selected synthetic images

- [German dark Arr information](images/releases/1.5.1/chromium-de-dark-1440-arr-information.png)
- [Italian light measured conflict](images/releases/1.5.1/chromium-it-light-1440-measured-conflict.png)
- [Arr information without media match](images/releases/1.5.1/chromium-de-light-1440-no-media-information.png)
- [Equal System cards](images/releases/1.5.1/chromium-it-light-1440-system.png)
- [Tablet System layout](images/releases/1.5.1/chromium-it-dark-820-system.png)
- [Mobile password dialog](images/releases/1.5.1/chromium-it-light-375-password.png)
- [Mobile Arr information](images/releases/1.5.1/chromium-it-light-375-arr-information.png)
- [First 25 log rows](images/releases/1.5.1/chromium-de-dark-log-first.png)
- [Last 20 log rows](images/releases/1.5.1/chromium-de-dark-log-last.png)
- [Auto-reloaded 25 log rows](images/releases/1.5.1/chromium-de-dark-log-reloaded.png)
