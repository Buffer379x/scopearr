# Validation — Scopearr 1.6.2

Validated on 2026-10-26 against v1.6.1 (`9718c7dc176e721b168bfb12a4083706d49071a2`). Services, credentials, media trees, titles and screenshots are synthetic. No personal Appdata or media was mounted.

## Automated checks

- Go 1.27.3 in Docker: full `go test -race -timeout=20m ./...` passed; the application package completed in **380.143 s**. Formatting, Vet and Staticcheck v0.8.2 (`all,-ST*`) passed.
- Govulncheck v1.8.0 reported **zero reachable vulnerabilities**, zero affected imported packages and one uncalled module-level advisory.
- Frozen pnpm 11.25.0 install, TypeScript, **207 web tests**, production build, moderate-level dependency audit, version consistency and **7 release-CI tests** passed. Vite retains the existing advisory about chunks larger than 500 kB.
- Command regressions cover owner-only and permissions-only commands, combined metadata findings, explicit deletion precedence, child-before-parent deletion, manual-only comments, mixed metadata/manual findings, individually quoted and host-mapped paths, newline rejection, 100-path grouping and current-filter exports excluding queued/running/succeeded findings. **10,000 findings generated in 3.510455 ms**; the 50,000-finding export boundary passes and 50,001 is rejected.
- Settings regressions preserve explicit checksum false/true, prevent scan requests from changing it and validate allowed/ignored names through settings. Report tests preserve completed scan snapshots during replacement scans.
- Web tests cover selection eligibility and visible-only lifecycle, fixable counts, full Copy/Download payloads at the 500/501-line boundary, scan dialogs, result-only presets/filters, settings drafts, timestamps and icons. Real transpiled hook tests exercise deferred reads, a busy guard, success and failure. A real transpiled placement page with mocked API polling verifies live counts after a move while retaining the completed timestamp, including during a replacement scan.

## Performance

All `TestPerformance50K*` checks passed in **45.953 s** on Linux/arm64 with `GOMAXPROCS=2`.

| Measurement | Result |
| --- | --- |
| 50K base queries | p50 42.69 ms · p95 77.60 ms |
| 50K placement scan/search | 3.610 s |
| 50K metadata rebuild, 500 confirmations and 500 MediaInfo results | 5.059 s · peak heap 371.63 MiB |
| Confirmation filter | p95 35.80 ms |
| MediaInfo inclusion | p50 80.47 ms · p95 110.54 ms |
| MediaInfo exclusion | p50 91.05 ms · p95 96.25 ms |

## Browser checks

The real application ran in an isolated Docker fixture on port 18162 with fake Radarr/Sonarr and MediaInfo executables. Its initial dataset contains **1,810 findings**, including **1,200 manual owner findings**, 300 special-file findings, 300 untracked-media findings and examples of the other kinds. German light/dark layouts were checked at **1440, 820 and 375 px**.

- Both scan dialogs follow the documented section order. Custom target modes appear inline; the strict-permissions help explains the distinction between detection and fixing. Owner defaults/reset and inline service validation work. Editing target disks returns the changed selection to the placement scan dialog.
- Result panels contain only result filters. Phone panels use one column: measured **293 px**, with page width equal to the **375 px** viewport. Unraid path fields measure 259 px without inheriting the table minimum width.
- Selecting 100 manual owner findings enables Terminal commands while Fix selected remains disabled with count zero. The seven-line script contains one grouped `chown`, 100 host paths and no `chmod`. Changing page clears selection. Selecting 500 manual-only findings yields **506 script lines**, a 50-line preview and no destructive commands. Copy shows its success state; Download and all-matches export were invoked. The browser clipboard adapter did not expose the app clipboard consistently, so complete payload preservation is established by automated handler tests rather than a browser clipboard byte comparison. No generated script was executed.
- Applying a name edit changes the settings draft; Save settings and reload preserve the new count and checksum preference. The scan-dialog link opens the Unraid settings. Phone settings stack without page overflow.
- Both reports start with the completed local timestamp and ISO tooltip, followed by duration: the seeded reports show **2 min 3 s** for file checks and **1 min 2 s** for placement. Starting a real replacement scan retains those values and displays the previous-report notice. With a queued fix, the scan dialog opens but Scan is disabled with the reason to finish or cancel fixes first.
- The MediaInfo action follows the mux action in Overview. A successful real fixture read switches to MediaInfo → Result and shows the saved toast/date/version. A simulated executable failure retains Overview and shows a toast plus the MediaInfo notice. With MediaInfo disabled, its action disappears while saved results remain accessible. The empty state refers to the action above; the timestamp wraps below the inner tabs on phones.
- Movie, episode, filename and list-settings details icons use Film. Source checks reject any remaining `FileVideo2` import.

Independent task reviews and the final branch review identified selection lifecycle, mixed command kinds, mobile filter CSS and stale placement-summary counts. Each was reproduced and corrected; scoped follow-up reviews approved the fixes. **No review findings are deferred.**

Synthetic screenshots are under [images/releases/1.6.2](images/releases/1.6.2/), including [scan help](images/releases/1.6.2/filecheck-scan-custom-help-de-light-1440.png), [manual command preview](images/releases/1.6.2/commands-preview-de-dark-1440.png), [phone filters](images/releases/1.6.2/filecheck-filters-de-light-375.png), [phone settings](images/releases/1.6.2/unraid-settings-fields-de-dark-375.png), [previous report](images/releases/1.6.2/placement-previous-report-de-dark-1440.png), [busy scan dialog](images/releases/1.6.2/filecheck-scan-busy-de-light-1440.png) and [phone MediaInfo](images/releases/1.6.2/mediainfo-result-de-light-375.png).

## Container and rollback

The final `scopearr:1.6.2-review` production image built and started as **99:100**, with a read-only root, dropped capabilities, no-new-privileges, **512 MiB memory and no additional swap**. Healthcheck passed, its label is 1.6.2, startup reported `Scopearr 1.6.2 started`, and no OOM was reported.

The plan described `unraid.verifyChecksum` as new, but it is already persisted and read by both workers in 1.6.1. This release reuses that boolean and removes scan-time mutation; no migration or duplicate field is needed. There are **no database-table or schema-version changes**.

Actual rollback validation ran **1.6.2 → archived v1.6.1 → 1.6.2**, separately with saved checksum false and true. Eight targeted Docker invocations (ten top-level tests) passed. Each version ran real server startup, settings GET→PUT normalization and cache replacement against the same synthetic Appdata. Exact allowed/ignored patterns, owner 1000:100, three presets, a MediaInfo result, a confirmation and an encrypted API key were preserved. Schema version **18** and the complete schema digest remained unchanged. No database restoration was required. This checks a one-file cache and backend compatibility, not a frontend downgrade or production dataset. An initial archive setup attempt lacked embedded web assets; after supplying them, the complete check passed on fresh data.

Publication uses Approved release after successful PR CI and successful main CI for the exact merge commit. The workflow builds amd64/arm64 images, smoke-tests and scans both, runs the 100K container check and promotes the approved digest to stable. Anonymous pull, version/stable digest equality and published-image startup are verified after publication; generated fixtures and test containers are then removed.
