# Validation — Scopearr 2.0.1

Validated on 2026-11-21 against v2.0.0 (`ee25c51`). All credentials, services, media paths and titles are synthetic. No personal Appdata or media was mounted.

## Automated checks

- Go 1.27.4 on Linux/amd64: full `go test -race -timeout=30m ./...` passed; the application package completed in **1005 s**. `go vet` and `gofmt` passed.
- Frozen pnpm 11.25.0 install, TypeScript, **904 web tests**, production build, bundle budgets (all **1,015,628 / 1,035,000** bytes, CSS gzip **22,823 / 23,500**), moderate-level dependency audit (no known vulnerabilities) and source/package/Docker/notes version consistency passed.
- Playwright in Chrome for Testing 156: **274** invariant and behavior tests, **103** dialog tests and **188** pixel comparisons passed. The pixel baselines were recorded again for 2.0.1, as nearly all of them contain the version in the sidebar.
- Downgrade check: the 2.0.1 image's data opens in `ghcr.io/buffer379x/scopearr:1.7.0`.

## Sync statements

The per-file statements of a sync (custom tags, audio languages, search, years) are prepared once per transaction and reused. The stored rows are those of 2.0.0; the existing sync, custom-tag and recognition tests pass unchanged.

`TestPerformance100K` (`SCOPEARR_PERF=1`, the same machine and seed):

| Measurement | 2.0.0 | 2.0.1 |
| --- | ---: | ---: |
| Replacing sync, 20,000 movies | 21.3 s | 8.2–8.6 s |
| Replacing sync, 80,000 episodes | 70.6 s | 34.9–35.2 s |
| Seed, 20,000 movies | 4.3 s | 3.5 s |

The test passed on a quiet machine. One run started directly after the race run failed a read-query budget (series pages by series, about 300 ms). 2.0.1 does not change these queries, and the next run passed. The figure is from a shared development VM, not a production dataset.

## Filter drawer retry

When a drawer chunk's import fails, the import's rejection handler keeps the module's address from the error, and the next attempt imports it with a fresh query (`?retry=n`). That import is not wrapped in Vite's preload helper, so it never triggers the reload of `preload-recovery.ts`. The library drawer end-to-end test that aborts the first chunk request passes in Chrome for Testing 156 and Chromium 141. Before 2.0.1, Chromium 141 answered the second import with the cached failure and never requested the chunk again. Safari names no address in the error; there the plain import runs again, as in 2.0.0. A unit test covers the fresh-address retry, and the built output check confirms each drawer import still carries its handler.

## Tag rules table

Attribute (+8 px), Match type (+8 px) and Mode (+4 px) are wider and Result is 16 px narrower. Measured with a text range in each cell, every column keeps at least **7 px** in Chromium 141 and **8.5 px** in Chrome 156 beyond its longest value in English, German, Spanish and Italian (before: down to −1 px, the Spanish “Códec / codificador”). At 1440 px no language's table scrolls; Spanish keeps Name at 184 px against its 178 px minimum. The settings fit and rules tests pass in both browsers.

## End-to-end navigations

A CI trace of 2.0.0 showed a page load after `about:blank` that never finished while navigations had no time limit. Navigations now time out after 30 s, and `openRoute` retries a load that timed out or was aborted once. The retry path was not forced in a test; the affected dialog test passes.

## Container and rollback

The database schema stays at 18, and no setting or stored value was added. Publication follows successful PR CI, successful main CI for the merge commit and Approved release. Anonymous version/stable digest equality and both Linux architectures are verified after promotion.
