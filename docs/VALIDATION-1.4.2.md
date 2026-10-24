# Scopearr 1.4.2 validation

Validated on 2026-10-24 against 1.4.1 (`781a3ef`). Full scripts, synthetic fixtures and measurements remain in ignored `work/ui142/`. The selected images below contain no private library data.

## Automated checks

- Frozen pnpm installation, TypeScript, **111 frontend tests**, production build and dependency audit pass. No known frontend dependency vulnerabilities; Vite retains its existing large-chunk advisory. Dependencies are unchanged.
- Linux Go 1.27.3: full race suite passes (`internal/app`: **565.671 seconds**), with Vet and Staticcheck v0.8.2. A subsequent targeted run found an unsynchronized settings assignment in the new fixture; its writes now use the server mutex. The affected detection, compact-row and updated filter tests pass three consecutive race runs. Final GitHub CI repeats the full suite on the release head.
- Govulncheck finds **zero affecting vulnerabilities** (one required-module finding outside called code). Seven release-script tests pass; source/package/Docker defaults and notes agree on 1.4.2.
- With `GOMAXPROCS=2`, the 50,000-file query fixture records p50 **56.86 ms**, p95 **160.97 ms**; TV size-descending median **70.78 ms**, resolution-descending **76.36 ms**. Custom tags p95 is **101.36 ms**. The new 50,000-row placement scan and search takes **2.97 seconds**.
- A separate real scan/planning/storage/search test with **100,000 compact one-disk rows**, no saved file lists, completes in **5.56 seconds** in a container limited to **512 MiB with no additional swap**. Cgroup memory peak is **168,071,168 bytes (160.29 MiB)**; all OOM/limit events are zero. The metadata interface never opens media contents.

## Disk-placement evidence

The initial reproduction was red for intact seasons spread across disks, missing disk folders, renamed share paths and discarded one-disk results. Correctly mapped documentary movies and series already passed. Final tests cover both Jackass grouping modes, documentary movies/series, missing folders, unique/nested aliases, excluded system roots, root decision counters and hidden one-disk search matches. Directory identity discovery reads only directory metadata and is bounded to two levels. Nested roots use the most specific match.

The Docker fixture additionally mounts one real directory at `/media/dokus-alias` and `/unraid/user/Dokus`. The final scan recognizes its identity, supplies `Dokus` as the physical relative path and explains it in the report. Browser checks verify Seasons spread is unstartable, not-found/error counts, one-disk details and Scanned → All scanned drilldown. Errors includes conflicts and insufficient space so blocked root decisions remain available in the corresponding drilldown.

These are fixture results. On a real Unraid host, the next manual scan's Folders report establishes the actual documentaries/shows layout; no claim is made about a host that was not accessed.

## Interface and behavior

The before/after and new-dialog matrix contains **6,984 screenshots**, covering Chromium and WebKit, default/copper/linen, dark/light and **1440 / 1180 / 1024 / 820 / 600 / 375 px**. Dashboard, libraries, all settings sections/service tabs, tools, reports, metadata, mux options and the new selection/progress/cancellation/error/tag dialogs are included. Final measurements have zero browser errors, document overflows or out-of-viewport dialogs. Mobile settings grid minima and clipped accessibility captions were corrected after this matrix exposed overflows. Baseline screenshots use the unchanged 1.4.1 frontend against the common synthetic fixture API; backend behavior is established by the reproduction tests.

The four-language table inventory covers **160 view cases**, including reports, file details and mux tracks, plus 16 tag-removal-review and selection-error cases. All standard tables fit at 1440 px without horizontal scrolling or clipped headers; control columns have no ellipses. Tool geometry depends on translated headers and selected columns, never row content. The common progress column remains independently sortable.

Both browsers pass **18 functional scenarios**: page selection; preservation through paging/sorting; reset on search/preset/view change; 150-episode series and 75-episode season selection across pages; partial states; context inclusion; select-all-matching; keyboard selection; disabled empty actions; confirmations/cancellation; sequential mux inspection; 200-file cap; duplicate summaries; unmark protection for running/queued jobs and backups; single-entry behavior; explicit selected tag writes. Browser mux responses are synthetic and do not modify media; existing Go tests validate the real single-job workflow and guards.

The settings proof contains **14 entries** across both browsers. All six section headings align with navigation, description gap is **4 px**, and the following section starts at **16 px**. Service/Display tabs to cards measure **16 px**. No visible card heading contains a form field. Ordered-list cell borders align at **1 px**, independent tab dirty indicators and active-list reset work, and Save remains at **142 px** while scrolling.

The JSX button inventory changes from **188 to 194** declarations. Source/handler comparison and behavior tests map shared CardHeading/OrderedList actions, selected tagging, mux actions, progress and report drilldowns to their accessible controls. The requested removals are the unselected filtered-view tag action (replaced by All matching selection), bulk default-rule reset, redundant rule count and separate info-icon card (moved into Icons). The legacy default-rule endpoint is retained and marked unused by the UI. Scan, move, fix, mux, single-file actions, presets, CSV and settings save routes remain available.

## Selected images

| Area | Before | After |
| --- | --- | --- |
| Placement table | [1.4.1](images/releases/1.4.2/before-placement.jpg) | [1.4.2](images/releases/1.4.2/after-placement.jpg) |
| Lists & columns | [Two cards](images/releases/1.4.2/before-lists-and-columns.jpg) | [One card with Icons](images/releases/1.4.2/after-lists-and-columns.jpg) |
| Library selection | — | [Series and seasons](images/releases/1.4.2/after-series-selection.jpg) |
| Scan diagnostics | — | [Folders report](images/releases/1.4.2/after-folders-report.jpg) |

## Compatibility and publication

There is no schema change. Serialization tests cover both ordinary settings writes and the transactional tag-policy settings path: the persisted five-value info lists pass the 1.4.1 validator, while optional `muxInfo` metadata restores the new icon's position and visibility in 1.4.2. No layout reset is required for rollback; run a new placement scan after returning to 1.4.1. This is serialization validation, not a claim that an old binary was run against the fixture.

Approved release gates publication on exact-main CI, both image architectures, runtime vulnerability scans and the existing 100,000-file container test at 512 MiB without additional swap. Commit identities and complete messages are checked before every commit; no assistant attribution is added.
