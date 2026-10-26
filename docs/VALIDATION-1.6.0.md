# Validation — Scopearr 1.6.0

Validated on 2026-10-26 against the release branch based on `961d5e2` (1.5.1). All media, titles, credentials, services and screenshots used for browser checks are synthetic. No personal Appdata or media was mounted.

## Automated checks

- Go formatting clean; `go vet ./...` and Staticcheck v0.8.2 (`all,-ST*`) passed with Go 1.27.3 in Docker.
- `go test -race -timeout=20m ./...` passed; the application package completed in 359.799 s. Subsequent installer cleanup removed an unused forwarding adapter; the affected MKVToolNix/MediaInfo tests and static checks passed again.
- `govulncheck` v1.8.0 found **zero reachable vulnerabilities**. It reported one vulnerability in an otherwise required module that application code does not call.
- Frozen pnpm 11.25.0 installation, TypeScript, **175 web tests**, production build, moderate-level dependency audit, version consistency and **7 release-CI tests** passed. The build retains the existing large-chunk advisory.
- Regression tests cover physical per-file rename/rollback, duplicate devices, completed-refresh folder checks, owner migration/manual fixes, concurrent/idempotent inline tag creation, metadata confirmations and undo, full/delta cache rebuilding, MediaInfo normalization/lifetime, bounded command output and cancellation, and additive migration compatibility.
- Review fixes have focused failing-then-passing tests: count-only channel comparison; effective confirmed audio/language/channel summaries and unknown traits; read-only MediaInfo path checks; hanging pre/postflight filesystem subprocesses; service-removal cleanup; media-only rename previews; and evidence-menu positioning. The independent review's important findings were resolved; no findings are deferred.

The single 120-second MediaInfo deadline covers path/symlink validation, initial identity checks, the reader and postflight checks. Filesystem validation uses a private subprocess running the existing guards; cancellation kills its process group. Startup and library sync tests verify that they never invoke MediaInfo.

## Compatibility and rollback

The database remains at schema version **18**. `field_confirmations` and `mediainfo_results` are additive tables; existing table columns and recognition rules are unchanged. New cached-file fields are optional. The confirmation index is partial (`WHERE json_valid(data)`) so damaged legacy JSON does not prevent index maintenance or existing corruption handling.

A populated 1.6.0 database and encrypted settings were opened with the **actual archived 1.5.1 source**. Its `OpenStore`, server/settings normalization, file query and cache replacement succeeded. Settings and side tables survived. Reopening with 1.6.0 restored confirmations and MediaInfo immediately, **before a new sync**, and another sync retained them. The old version uses its automatic metadata interpretation while it runs. No database restore was needed.

## Performance

Go performance checks used `GOMAXPROCS=2`, Go 1.27.3 and synthetic data on Linux/arm64.

| Check | Result |
| --- | --- |
| 50,000-file insert | 2.842 s |
| Cached-file queries | p50 41.46 ms; p95 74.04 ms |
| Statistics over 100,000 files | 779.90 ms |
| 100,000 placement counts / report | 10.98 / 11.32 ms |
| Derived refresh of 50,000 files | 12.557 s; 12.30 MiB sampled peak heap |
| Full sync with 500 confirmations and 500 MediaInfo results among 50,000 files | 4.947 s; 370.50 MiB sampled peak heap |
| Confirmed filter | p95 34.35 ms |

`EXPLAIN QUERY PLAN` for the confirmation filter reports `SEARCH f USING INDEX files_confirmed (<expr>=?)`. The confirmation expression is the first index term, followed by service, so both an exact instance and the family/instance range query can select confirmed rows efficiently.

The production image also passed the **100,000-file** test with named Radarr/Sonarr, Emby and Jellyfin instances under **512 MiB memory and 512 MiB memory-plus-swap**, without OOM. Both libraries completed; HTTP filter p95 was **81.14 ms**, sampled application RSS peaked at **275.77 MiB**, and cached statistics p95 was **0.885 ms**. This load harness uses the host UID for its temporary writable Appdata; the separate production smoke and tool tests use **99:100**.

## Runtime and signed tools

The production image started read-only as **99:100** with dropped capabilities, no-new-privileges, 512 MiB memory and no extra swap. Health checks passed, OOM remained false and the log contained `Scopearr 1.6.0 started`.

- Real signed Alpine **MediaInfo 25.09** installation, version check, WAV inspection and removal passed. The installed tree occupied **22,856 KiB** and cgroup peak memory was **93,691,904 bytes**.
- Real signed **MKVToolNix 96.0** installation and two-track-to-one-track remux passed unchanged. Its installed tree occupied **322,424 KiB** and cgroup peak memory was **507,793,408 bytes**, within the 512 MiB limit.
- The private filesystem helper was additionally exercised in the Alpine runtime as 99:100.

The MediaInfo smoke accepts CLI JSON whitespace variations. CI runs it immediately after the existing optional MKVToolNix smoke.

## Browser checks

The real local backend fixture uses temporary disk1/disk2/cache directories, fake Arr/media-server APIs and an installed fake MediaInfo binary. The interface was inspected in **German and Spanish**, **light and dark**, at **1440, 820 and 375 px**.

Checked flows include manual channel confirmation and Automatic undo with the detail dialog staying open; accessible confirmation provenance; keyboard navigation and focus return; a MediaInfo read clearing a codec warning; saved movie/episode results and collapsed tracks; new tags in single-file and three-file dialogs, persistence and confirmation; the Unraid Paths/Default owner/Shares layout; owner defaults and manual findings; and per-device companion rename previews. The actual synthetic video and subtitle were renamed on disk1 and cache respectively. Physical-device semantics use real filesystem operations on synthetic directories; no live Unraid hardware was used.

Evidence menus portal into the native dialog, use the mobile card width and stay within the viewport. Shared card actions wrap on narrow screens; the mobile update/check/remove buttons remain reachable. The settings/Log unseen-error dot and event-details job-log link are absent.

Selected synthetic captures:

- [Manual confirmation](images/releases/1.6.0/confirmation-de-dark-1440.png)
- [Mobile source menu](images/releases/1.6.0/source-menu-de-dark-375.png)
- [MediaInfo comparison](images/releases/1.6.0/mediainfo-es-dark-1440.png)
- [Tablet MediaInfo](images/releases/1.6.0/mediainfo-es-dark-820.png)
- [Mobile inline tag](images/releases/1.6.0/inline-tag-es-light-375.png)
- [Unraid defaults](images/releases/1.6.0/unraid-de-light-1440.png)
- [Mobile package actions](images/releases/1.6.0/service-de-light-375.png)
- [Different-device companion preview](images/releases/1.6.0/rename-de-light-375.png)
