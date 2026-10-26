# Validation — Scopearr 1.6.1

Validated on 2026-10-26 against `bda42c7` (1.6.0). Browser services, credentials, file titles, media and screenshots are synthetic. No personal Appdata or media was mounted.

## Automated checks

- Go 1.27.3 in Docker: full `go test -race -timeout=20m ./...` passed; the application package completed in **361.577 s**. Go formatting, Vet and Staticcheck v0.8.2 (`all,-ST*`) passed.
- Govulncheck v1.8.0 reported **zero reachable vulnerabilities**, zero affected imported packages and one uncalled module-level advisory.
- Frozen pnpm 11.25.0 install, TypeScript, **182 web tests**, production build, moderate-level dependency audit, version consistency and **7 release-CI tests** passed. The build retains the existing large-chunk advisory.
- New backend regressions cover preservation of `confirmed=true` and `mediaInfo=false` through preset save/load, invalid optional preset-state removal, legacy presets, both Radarr and Sonarr instances, valid results, stale size/path, a different instance, missing results and HTTP 400 for an invalid MediaInfo filter.
- Web regressions cover preset inclusion/exclusion, filter/help wiring, five custom-tag help sections, section retention/fallback including empty track fields, attribute-union alignment and absent values, tab panels, scoped dialog width and the nonwrapping Used column.

## Query plan and performance

Linux/arm64, `GOMAXPROCS=2`, 50,000 synthetic files and 500 saved MediaInfo results:

| Query | p50 | p95 | Rows matched |
| --- | --- | --- | --- |
| `mediaInfo=true` | 80.39 ms | 93.93 ms | 500 |
| `mediaInfo=false` | 86.34 ms | 100.72 ms | 49,500 |

`EXPLAIN QUERY PLAN` reports a correlated lookup using `SEARCH m USING INDEX sqlite_autoindex_mediainfo_results_1 (service=? AND file_id=?)`. The remaining size and path predicates validate that result against the file. No new index or table is needed.

All `TestPerformance50K*` checks passed. The metadata-lifecycle benchmark completed a 50K rebuild with 500 confirmations and results in 5.257 s, peak heap 370.31 MiB; the existing confirmation filter p95 was 35.05 ms.

## Browser checks

A dedicated fixture on port 18161 used the real application with fake Arr/media services and a fake local MediaInfo executable. One movie has five audio and eight subtitle tracks, one episode has one audio track, and another movie has a manual confirmation.

- Checked German and Spanish in light/dark themes at **1440, 1024, 820 and 375 px**. Long German, Spanish and Italian tag help stays within the popup width and scrolls vertically.
- File details measured **1060 / 996 / 792 / 347 px** at those widths. No horizontal page overflow. The evidence table retains six columns; the Used cell does not wrap. The separate tag dialog remains **450 px**.
- Both MediaInfo filter operators return the expected movies and episodes; exclusion uses the red chip style. A saved combined `confirmed=true&mediaInfo=false` preset reloads with both choices. With the service disabled, the active filter remains visible and removable; resetting removes the inactive filter.
- Both filter help icons open their explanations. Custom tags help contains Management, Count, Name, Colors and Creating tags, including manual, local-rule, shared and protected service-rule behavior.
- MediaInfo starts with Result and exposes only available sections. Single tracks use two columns and stack on phones; multiple tracks use one column per track and scroll inside the table wrapper. The attribute column is sticky, and headers retain language/default/forced hints.
- Arrow navigation keeps focus within the inner tablist and leaves the outer MediaInfo tab selected. Closing and reopening retains the selected section. A real fixture read that removes all subtitle tracks while Subtitles is selected immediately returns to Result.
- Independent review found one important keyboard issue in the shared long-help popup. Reproduced before the fix: keyboard opening retained trigger focus and Page Down left popup scroll at zero. After the fix: focus enters the scroll region, Page Down scrolls, End reaches Creating tags, and Escape closes the popup and restores trigger focus. Pointer opening retains its existing focus behavior. The complete 182-test web suite and build passed after this fix. No review findings are deferred.

Synthetic screenshots are under [images/releases/1.6.1](images/releases/1.6.1/), including the [desktop comparison](images/releases/1.6.1/audio-es-dark-1024.png), [phone comparison](images/releases/1.6.1/audio-de-light-375.png), [episode](images/releases/1.6.1/episode-audio-de-light-1440.png) and [keyboard help](images/releases/1.6.1/tag-help-keyboard-de-light-1280.png).

## Container and rollback

The production `scopearr:1.6.1-review` image built and started as **99:100**, with a read-only root, dropped capabilities, no-new-privileges, **512 MiB memory and no additional swap**. Healthcheck passed, the version label is 1.6.1, startup reported `Scopearr 1.6.1 started`, and no OOM was reported.

There are no database-table, schema-version or settings-structure changes. An Appdata directory prepared by 1.6.1 was opened with the **actual archived v1.6.0 source**: server initialization, encrypted settings, preset loading, library query and cache replacement succeeded while retaining confirmations and MediaInfo results. Reopening with 1.6.1 retained and applied them before a new sync, then again after a rebuild. No database restoration was required. The older version does not implement the new MediaInfo filter or section presentation.

Publication uses the existing Approved release workflow after successful PR and exact-commit main CI. It builds and tests amd64 and arm64 images, scans both, runs the 100K container check and promotes the approved digest to stable. Anonymous pull, tag-digest equality and published-image startup are checked after publication; generated fixtures and test containers are then removed.
