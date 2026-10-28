# Validation — Scopearr 1.6.3

Validated on 2026-10-28 against v1.6.2 (`659fe465968b32ee24ba1c554e961a0fea26ffd5`). All credentials, services, media paths, titles and screenshots are synthetic. No personal Appdata or media was mounted.

## Automated checks

- Docker Go 1.27.3: full `go test -race -timeout=20m ./...` passed; the application package completed in **374.971 s**. Gofmt, Vet and Staticcheck v0.8.2 (`all,-ST*`) passed.
- Govulncheck v1.8.0 found **zero reachable vulnerabilities**, zero affected imported packages and one uncalled module-level advisory.
- Frozen pnpm 11.25.0 install, TypeScript, **218 web tests**, production build, moderate-level dependency audit, source/package/Docker/notes version consistency and **7 release-CI tests** passed. The existing Vite advisory about chunks larger than 500 kB remains.
- Directory checks preserve names, entry counts and directory mtimes through marking, job checks, rename preview and mapping checks. Access failures EACCES, EROFS and ENOTSUP fail closed, as do unwritable modes and forbidden symlinks. A real read-only Docker bind mount passes the regression. The configured mux workspace still performs and cleans up its explicit write probe. Physical-directory preflight and user-share identification are checked separately.
- Placement CSV regressions compare literal expected rows for combined status/kind/share/search/target filters, ascending/descending display sort, pagination independence and invalid queries. List and export share filter validation; execution ordering is unchanged.
- Web regressions run real transpiled components and handlers for commands with/without selection, full long-script Copy/Download payloads, filter-footer order and disabled CSV semantics, measured unsortable Info headings, session height cleanup, conditional tab reveal and scan blocking reasons.

## Performance

All `TestPerformance50K*` checks passed in **45.342 s**, Linux/arm64 with `GOMAXPROCS=2`.

| Measurement | Result |
| --- | --- |
| 50K library query | p50 41.88 ms · p95 87.97 ms |
| 50K placement scan | 3.436 s |
| Full sync with 500 confirmations and 500 MediaInfo results | 5.103 s · peak heap 368.16 MiB |
| Confirmed filter | p95 34.04 ms |
| MediaInfo inclusion | p50 77.70 ms · p95 98.41 ms |
| MediaInfo exclusion | p50 87.12 ms · p95 105.68 ms |

## Browser checks

The actual application ran in an isolated fixture at port 18163 with fake Radarr/Sonarr, media server and tool executables. Four library files, all 13 placement status options and all eight file-check kinds/four states were represented. German light/dark layouts were checked at **1440, 820 and 375 px**, with no page-width overflow. A second fixture configuration exposed only one share.

- Expanded result panels at 1440 px measure **359.90 px** for placement and **319.90 px** for file checks, down from 932/732 px in the same baseline fixture. Counts stay adjacent to labels. With one share, the share group disappears; the first remaining group has a zero-width border and the next has exactly one divider.
- CSV occupies the filter footer. Searching for no matches renders an inert `span` with role link, `aria-disabled=true` and no href. The commands dialog without selection explains the current-filter count and offers the all-matches download. With selected findings it retains Copy and selected-script Download beside that action. No generated script was executed.
- File-details outer tabs, MediaInfo Result/General/Video/Audio tabs and placement disk tabs show **0 px** movement between selections. Desktop panels start **16 px** below the tab bar. On phones the MediaInfo date wraps between its bar and panel consistently across sections. A short dialog grows to the larger Overview, retains that height when returning, and starts short again after closing/reopening.
- At **375×667** and **812×375**, genuine pointer and keyboard tab changes preserve the dialog heading and tab positions; content scrolls within the dialog. The phone height cap uses the same 50 px viewport allowance as the remembered minimum. The automation adapter's focus-and-click operation can center a control by scrolling its parent; direct pointer events and native keyboard events were used to distinguish that adapter behavior from application layout.
- With Custom values, File-check Scan ends at **642 px** in both 720 px and 780 px viewports. Placement Scan ends at **387 px** in both. On phones the body scrolls above the visible footer. Focused UID/GID inputs remain above it at both 667 px and a reduced 400 px viewport height. A visualViewport lifecycle helper additionally tracks visible height and vertical offset on resize/scroll, keeps focused fields within the body and removes listeners/overrides on close. Regression tests shrink only visual height from 667 to 400 px while leaving innerHeight at 667, then pan offsetTop to 90 px. Both tests failed before the fix and pass afterward. This covers the browser model described by [Chrome’s viewport documentation](https://developer.chrome.com/blog/viewport-resize-behavior/); an actual mobile operating-system keyboard was not available in the desktop browser.
- Info is visible in placement, file-check and mux table headers in **English, Spanish and Italian**, alongside German. English display-settings Info labels were inspected; all four catalogs and table-label mappings are covered by automated checks.

Synthetic screenshots are in [images/releases/1.6.3](images/releases/1.6.3/), including [compact filters](images/releases/1.6.3/placement-de-light-1440.png), [all-matches commands](images/releases/1.6.3/commands-all-de-dark-1440.png), [laptop scan](images/releases/1.6.3/filecheck-scan-de-dark-1280.png), [phone scan](images/releases/1.6.3/filecheck-scan-de-light-375.png), [landscape tabs](images/releases/1.6.3/mediainfo-de-dark-812.png) and [disk details](images/releases/1.6.3/placement-details-de-dark-375.png).

An actual Unraid shfs/cache share was unavailable. The maintainer's remaining host-specific check is to mark a file on a share with cache enabled and compare `/mnt/cache/<share>` before/after. Automated metadata-preservation, effective-access error and read-only-mount checks cover the local behavior; they cannot certify each shfs/NFS/SMB server's access semantics. Actual write failures continue to fail the job with a reason.

## Final branch review

The independent whole-branch review found one important issue: layout-viewport units alone could leave Scan behind a mobile keyboard. The visualViewport lifecycle fix passed its two RED→GREEN regressions, all 218 web tests, TypeScript/build and renewed browser geometry checks. No critical findings or declined judgments remain. One minor documentation inconsistency is deferred: an older sentence in the Unraid guide still says the Scan report exports CSV, while the control now lives in the filter footer.

## Container and rollback

`scopearr:1.6.3-review` built and started as **99:100**, with a read-only root, dropped capabilities, no-new-privileges, **512 MiB memory and no additional swap**. Healthcheck passed, its image label is 1.6.3, startup reported `Scopearr 1.6.3 started`, and no OOM occurred.

Actual rollback validation ran **1.6.3 → archived v1.6.2 → 1.6.3**, separately with saved checksum false and true. All six Docker invocations passed. Each version ran real server startup, settings GET→PUT normalization and cache replacement against the same synthetic Appdata. Exact allowed/ignored patterns, owner 1000:100, three presets, a MediaInfo result, a confirmation and an encrypted API key survived. The complete schema digest remained `981e7473922bc66ff147cafaffe4b7924c736bf991928046af8b4bec5720e2a1` (schema version 18). No database restoration was needed. This checks a one-file cache/backend downgrade, not a frontend downgrade or production dataset. Initial setup attempts used an unsupported Python extraction option and invalid tool preset IDs; fresh corrected fixtures passed the complete sequence.

Publication follows successful PR CI, successful main CI for the exact merge commit and Approved release. Anonymous version/stable digest equality, both Linux architectures and published-image startup are verified after promotion. Only this release's generated fixtures and test containers are then removed.
