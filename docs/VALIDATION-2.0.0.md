# Validation — Scopearr 2.0.0

Validated on 2026-11-20 against commit `a3cb549` on branch `release/2.0.0` (after 1.7.0). Services, credentials, media and screenshots are synthetic. Browser checks ran against the demo (`SCOPEARR_DEMO=true`) on Linux with Chrome for Testing 156 in the time zone Europe/Berlin. The database schema stays at 18; no stored setting, settings field or column ID was added.

## Automated checks

Local release-candidate gate, all green:

- Go: full `go test ./...` and `go test -race ./...`, Gofmt and Vet: passed locally; the race run, Staticcheck, Deadcode and Govulncheck run in PR CI.
- Frontend: frozen pnpm 11.25.0 installation, TypeScript, web unit tests, production build, bundle budgets (`node web/scripts/bundle-budget.mjs`), moderate-level dependency audit and version consistency: 903 unit tests passed, bundle budgets ok, no known vulnerabilities.
- Playwright projects `invariants` and `dialogs` (layout invariants, behavior, accessibility), and the local pixel comparison: `invariants` 274 passed, `dialogs` 103 passed, pixel 188 passed.
- Downgrade check (`scripts/check-downgrade.py`) against `ghcr.io/buffer379x/scopearr:1.7.0`: ok.

## Feature parity with 1.7.0

A checklist of **66 points** covers filters, dashboard, libraries, Muxing, Disk placement, Files & permissions, settings and cross-cutting behavior (sign-in, demo, session recovery, confirmations, toasts, four languages, 18 palettes). Each point is backed by a named e2e, web unit or Go test.

- **65 points** were already covered. One of them, a jump from a log entry to a job terminal, is not a 1.7.0 function: 1.7.0 events carry no job ID.
- **1 point** received a new e2e test: Select all of a Disk placement scan-report target. That test found and fixed a defect: selecting a target that was already the filter cleared the selection just made.
- **0 gaps** remain.

Further behavior checks added in this phase:

- A declined leave question keeps the address, the history length, the view and the entered text.
- This covers sidebar links, quick search, Back and a typed address.
- A hidden Services area polls exactly as 1.7.0 did: two `mux/tool` requests per 61 s and none for the other tools.

## Performance with 100,000 files

`TestPerformance100K` (`SCOPEARR_PERF=1`) uses 20,000 movies and 80,000 episodes in 2,000 series, each file with 1–3 audio tracks, and two custom tags. It measures the real HTTP handlers including JSON, as the median of five runs.

| `/api/files` request                       | 50 per page | 100 per page | 1000 per page |
| ------------------------------------------ | ----------: | -----------: | ------------: |
| Movies by title (as 1.7.0)                 |       18 ms |        14 ms |         66 ms |
| Movies with `track=`                       |       58 ms |        61 ms |        113 ms |
| TV series grouped (as 1.7.0)               |       41 ms |        44 ms |         99 ms |
| TV series by size, descending              |      220 ms |       220 ms |        289 ms |
| Collapsed series view (`summary=1`) page 1 |      226 ms |       190 ms |        433 ms |
| Collapsed series view, one series opened   |      185 ms |       202 ms |        450 ms |

- **Same as 1.7.0:** all 13 library queries without new parameters match 1.7.0 within measurement noise, on the same data at store level.
- **Collapsed series view:** it loads summaries only. A page of 100 series shrinks from **8,195 kB to 43 kB** and from **431 to 190 ms**. A 1,000-series page drops from 3.1 s to 433 ms.
- **Quick search:** TV series (`distinct=series`, limit 6) takes 105 ms. The worst case, where every episode matches, dropped from 569 to 384 ms after evaluating the filter once.
- **CSV export:** it stays linear at 50–70 µs per row.
- **Webhooks:** a 40-episode webhook delta takes about 100 ms.
- **Cold caches:** cold statistics and facets take 2–3 s after a sync, unchanged from 1.7.0.

**Full syncs.** A full sync now builds the audio track index once at the end, instead of through triggers per file.

| Full sync                              | Before |  After |
| -------------------------------------- | -----: | -----: |
| First fill, 20,000 movies              |  6.6 s |  4.4 s |
| First fill, 80,000 episodes            | 29.8 s | 19.6 s |
| Replace, 80,000 movies (A/B, same run) | 54.2 s | 48.1 s |

Two tests cover this path:

- `TestFullSyncAudioTrackIndexMatchesTriggers` proves both paths write identical rows.
- `TestAbortedFullSyncKeepsAudioTrackTriggers` proves an abort or a rejected commit restores the exact trigger text.

Writing remains slower than in 1.7.0 because of the track index: a 20,000-movie replace with custom tags takes 14.0 s against 12.5 s.

**Browser rendering.** A 1,000-row page renders in about 2.1–2.4 s after the response arrives, measured in the local Playwright project `perf`. Removing a per-row exception in `entryLink()` saved about 176 ms per page. Virtualization is planned after 2.0.0.

## Bundles

Budgets are raw bytes without language catalogs, checked by `web/scripts/bundle-budget.mjs`.

| Set                                   | Size        | Budget      |
| ------------------------------------- | ----------- | ----------- |
| Start (index + dialog-stack)          | 52,792 B    | 54,000 B    |
| Library (beyond start)                | 199,076 B   | 204,000 B   |
| Settings page                         | 105,433 B   | 108,000 B   |
| Tag rules (including settings)        | 118,418 B   | 121,000 B   |
| Muxing                                | 48,763 B    | 50,500 B    |
| Disk placement                        | 65,363 B    | 67,000 B    |
| Files & permissions                   | 50,074 B    | 51,500 B    |
| All JavaScript without language files | 1,013,350 B | 1,035,000 B |
| CSS (gzip -9)                         | 22,779 B    | 23,500 B    |

The chunk structure was reviewed and kept. Small shared chunks are preloaded in parallel with their importers, so they cause no request waterfalls.

## Accessibility, palettes and languages

These checks ran in the Playwright project `invariants`.

- **Palettes:** all 18 palettes ran in dark and light mode at 1440 × 900. Each run checked every axe WCAG A/AA rule, including color contrast, on four views: the dashboard (view and frame), Movies, Muxing and the dialog “Save filter view”. All 18 tests passed. The palettes come from a rewritten settings response, so nothing is saved.
- **Languages:** English, German, Spanish and Italian ran at 1440 and 375 px. The views were the dashboard, Movies and TV series (each with the filter drawer open), Muxing, Disk placement and Files & permissions. No page scrolls sideways, and every clipped text has an ellipsis or a `title`/`aria-label`. All tests passed.
- **Accessibility suite:** without the palette test, `a11y.spec.ts` has 44 tests, including the new language test; all pass. Settings, dialogs, tool rows, cards and columns were already covered in four languages by their own specs.
- **Findings:** there were no contrast violations, no page overflow and no other findings.
- **Phone card chip line:** in Spanish at 375 px, the chip line of a phone card is single-line by design and fades out under a mask. The test accepts this case.

## Downgrade to 1.7.0

The downgrade check writes data with the 2.0.0 image and then starts 1.7.0 on the same data:

- It signs in and compares the saved interface settings.
- A demo scenario lets 1.7.0 rewrite every demo file through the audio track index triggers.
- The new default rules stay unchanged and appear once.
- 1.7.0 ignores a track filter, and a preset saved with one, without an error.
- Back on 2.0.0, the filter and the preset return the same files, and the index equals a fresh rebuild.

The bundled full-sync index path was rechecked against 1.7.0 and passed. Result for the release candidate: ok.

## Review and container

Findings from the live tests of the release candidates (`2.0.0-rc.1` to `2.0.0-rc.6`) were fixed in the following candidates.

The final container is `ghcr.io/buffer379x/scopearr:2.0.0`, built by the Approved release workflow from the merge commit.

A real Unraid installation was unavailable. The maintainer's hardware check remains: leave Mux open for 30 minutes with completed-job disks manually asleep and confirm they stay asleep.

Publication requires successful PR CI, successful main CI for the merge commit and the Approved release workflow. Published image/stable digest equality, anonymous pulls and version startup are verified after promotion.
