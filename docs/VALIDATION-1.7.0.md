# Validation — Scopearr 1.7.0

Validated on 2026-10-28 against `718d3b4` (1.6.3). Services, credentials, media and screenshots are synthetic. No personal Appdata or media was mounted. No database schema or CSV format changes are included.

## Automated checks

- Go 1.27.3 in Docker: full `go test ./... -count=1` passed (application 108.907 s); full `go test -race -timeout=20m ./...` passed (application 395.934 s). The final release-specific race tests also passed (15.164 s).
- Gofmt, Vet, Staticcheck v0.8.2 (`all,-ST*`) and Deadcode v0.51.0 passed; Deadcode output is empty. CI now rejects nonempty deadcode output.
- Govulncheck v1.8.0 found zero reachable vulnerabilities and zero affected imported packages; one advisory exists only in an uncalled required module.
- Frozen pnpm 11.25.0 installation, TypeScript, **237 web tests**, production build, moderate-level dependency audit, version consistency and **7 release-CI tests** passed. The pre-existing language-registry chunk-size warning remains. The local pnpm wrapper initially attempted automatic reinstall without network access; the explicit frozen installation with network access and direct installed build/check commands passed.
- All 13 planned API failures assert their exact status, JSON error object and `no-store`. Non-JSON, malformed, null/invalid error payloads and network failures preserve readable translated errors and existing unauthorized/abort notification behavior.
- Mux list polling performs no byte reads, filters in SQL, and checks only statuses whose displayed state needs the result. Explicit refresh, marking, queueing and worker start still perform the byte-read probe, including regressions where a successful cached metadata check precedes a failing read. Completed-job dialogs wait for cached detail checks.
- Indexed status queries preserve mixed-state counts. Prefix tests cover boundary keys, underscore-containing instance IDs and indexed seek plans. An idle worker is tested with its database connection deliberately unavailable: it returns without querying. Durable internal jobs survive restart and disabled-service jobs remain eligible after re-enabling.
- Demo settings round trips preserve cached libraries. Unchanged initial settings emit no event and do not conflict with active placement work. Unknown sign-in names are absent from the log. Existing exact CSV export regressions and shared formula-protection cases pass.
- Removed seven test-only Go entry points, three frontend helpers, fourteen unused tokens and **238 unused translation keys** per catalog. Twenty dynamically composed messages remain in an explicit, justified allowlist. Catalog parity, literal usage and one-rule-per-selector guards pass.

## Performance and transferred data

With `GOMAXPROCS=2`, the requested 50K/100K performance checks passed in 48.115 s. Authenticated `/api/status` with 100,000 placement rows measured **0.100 ms median, 0.114 ms p95, 0.128 ms maximum** across 30 warm requests, with exact pending/running/failed counts asserted. Existing 100K placement counts/report measured 11.337/12.521 ms; the 50K library query p95 was 103.407 ms.

The entry JavaScript decreased from **677,035 B to 54,361 B**, plus the eager English fallback at 126,269 B. German, Spanish and Italian messages are separate lazy modules. A production-build graph test failed before separating eager name-module IDs and passed afterward; it proves the startup graph excludes all three complete catalogs.

A fresh German login transferred **110,576 B** of static resources (415,886 B decoded); subsequent reloads transferred **0 B** for assets. Actual headers include gzip, immutable caching, representation-specific ETags and `Vary: Accept-Encoding`; HTML revalidates with `no-cache`. The delayed German catalog test showed German from the first rendered text, and a delayed Spanish load followed by Italian ended in Italian. Unselected catalogs were not requested at startup. Static tests additionally cover decompression identity, HEAD, weak/list ETags, 304, explicit gzip rejection, redirects and unknown paths.

## Browser and visual checks

Chromium exercised German light/dark views at **1440, 820 and 375 px** (30 page views), plus English navigation/settings. No page-width overflow or browser errors occurred. Representative synthetic images, including before/after operator and mobile-selection views, are in [images/releases/1.7.0](images/releases/1.7.0/).

- Search, preset and collapse controls on all five pages move **0 px** between collapsed and expanded states. Expanded Mux is 311.89 px; Disk placement and Files & permissions are 327.89 px, within the 360 px budget.
- Navigation geometry is identical with counts 0/3/12/128 at 1440 and 375 px. Badges overlap neither labels nor chevrons. Settings clears all main-navigation active states and activates the gear with `aria-current=page`.
- State operators are exactly 8 px after label/help for eleven filters at both widths. Their effective text remains 13 px. Four mobile library actions fit one row; coarse-pointer hit areas measure 44×44 px and full accessible names include counts.
- The mobile demo banner follows the measured 110 px header even after scrolling, and stays beneath header menus in the stacking order. Saving retains 26 movies and the synthetic episode cache.
- Original/consolidated CSS comparisons used fixed fixtures for 38 library/35 tool selector recipes, covering 52/43 nodes on each page. There were **zero unapproved computed-style differences**; exclusions were the approved padding/operator changes.

## Review and container

The independent review identified one important regression: local actions could leave a slow idle polling timer scheduled. A real ToolPackageCard/shared-hook fake-timer test reproduced it, then passed after cadence transitions replaced the old timer without an extra immediate request. The complete web suite and build passed afterward. The network check separately exposed eager imports of full locale chunks; the build-graph regression and actual browser measurements verified its correction.

One nonblocking HTTP negotiation edge remains: requests explicitly forbidding identity can still receive an uncompressed representation when gzip is unavailable. Normal browser negotiation and the specified gzip quality behavior are covered.

The final `scopearr:1.7.0-review` container starts as **99:100**, with a read-only root, dropped capabilities, no-new-privileges, **512 MiB memory and no extra swap**. Its healthcheck passes, no OOM occurred, and startup reports `Scopearr 1.7.0 started`.

A real Unraid installation was unavailable. The maintainer's hardware check remains: leave Mux open for 30 minutes with completed-job disks manually asleep and confirm they stay asleep. Automated byte-read hooks prove the application avoids those reads; they cannot certify filesystem metadata caching or physical disk behavior.

Publication requires successful PR CI, successful main CI for the merge commit and the Approved release workflow. Published image/stable digest equality, anonymous pulls and version startup are verified after promotion, before cleaning this release's fixtures.
