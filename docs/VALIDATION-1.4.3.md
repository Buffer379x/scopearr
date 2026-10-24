# Scopearr 1.4.3 validation

Validated on 2026-10-24 against 1.4.2 (`cd6f78c`). Synthetic fixture sources, browser scripts, screenshots and measurements remain in ignored `work/ui143*`. The images below contain no private library data.

## Automated checks

- Frozen pnpm installation, TypeScript, **120 frontend tests**, production build and dependency audit pass. No known frontend dependency vulnerabilities; the existing Vite large-chunk advisory remains. Dependencies are unchanged.
- Linux Go 1.27.3: Vet, the full race suite and Staticcheck v0.8.2 pass. After independent review, the shared-root/mapping/file-check race subset passes in **5.424 seconds**. The final complete race run passes on the release code (`internal/app`: **551.653 seconds**).
- Govulncheck finds **zero affecting vulnerabilities**; one required-module finding is outside called code. Seven release-script tests pass. Version, package, both Docker defaults and English release notes agree on 1.4.3.
- With `GOMAXPROCS=2`, the 50,000-file query fixture records p50 **45.41 ms**, p95 **92.78 ms**, below the unchanged 200 ms gate. Custom-tag filtering p95 is **98.07 ms**. The 50,000-row compact placement scan and search takes **2.78 seconds**.
- A separate scan/planning/storage/search test with **100,000 compact one-disk rows**, including the new provenance and series-decision aggregation, completes in **6.09 seconds**. The container is limited to **512 MiB with no additional swap**. Cgroup memory peak is **261,136,384 bytes (249.04 MiB)**; all OOM and limit events are zero. The metadata interface never opens media contents.

The full runtime container check also passes with **100,000 files**, named Arr instances and both Emby and Jellyfin enabled. The image runs as **99:100** with memory and memory-plus-swap both **512 MiB**, without an OOM kill. Sampled application RSS peaks at **239.84 MiB** during the sync/query fixture; it is **53.20 MiB** after queries. Cached statistics/facets, rule reprocessing and parallel cold reads pass their existing gates. Cgroup peak reaches the imposed limit including reclaimable filesystem cache; it is not application RSS.

## Root identity and report evidence

The regression is red before the fix: named Radarr plus unnamed Sonarr reports Scanned **1 instead of 2**; two unnamed instances report **0 instead of 2**. Excluding Sonarr incorrectly reduces From Arr to **1 instead of 2**. The passing table covers named/unnamed combinations, trailing and repeated slashes, an unselected instance and a conflicting season. Separate checks cover overlapping roots belonging to different instance IDs, cloning ID slices and keeping internal provenance out of serialized media rows.

Roots retain normalized Arr origin and stable instance membership through staging. Physical paths and display labels no longer decide ownership. Both scanners use the common folder/root association. The browser fixture's `/documentaries` root belongs to named Radarr and unnamed Sonarr, with a movie and a series on disk1 and disk3; the report shows **From Arr 2 / Scanned 2 / Several disks 2**, with both labels. Unselected instance counts remain visible and excluded-library availability does not block selected scans. Blocked/outside folders retain root attribution and error counts without claiming a physical scan.

Independent review found that ignoring season rows concealed conflicts in the root report. The new regression first reproduces **Errors 0** for a conflicting season. Decision flags now aggregate all season plans once per catalog entry; Arr/Scanned remain series counts, and the error is retained. The complete row plan and move safeguards are unchanged.

This is synthetic evidence. The maintainer's actual host was not accessed. Run a fresh manual scan after updating and compare **From Arr** with **Scanned** for documentaries; the release fixture cannot establish another host's mounts.

## Interface and behavior

The comparison matrix contains **4,032 screenshots**: Chromium and WebKit, default/copper/linen, dark/light and **1440 / 1024 / 820 / 375 px**. It covers dashboard, libraries, all six settings sections, service tabs, all ordered-list tabs, tools, reports and existing detail/options/status/terminal dialogs. Both versions use the same synthetic API; 1.4.2 UI sources are unchanged. Final measurements have zero document overflow, browser errors or out-of-viewport dialogs.

Another **384 captures** cover combined help, tag-rule help and inline scan/move/fix activity across the same browser/theme/mode/width combinations. Scrolling inside help remains possible; scrolling the window safely closes it. A browser-discovered non-Node scroll-event target is handled explicitly. Row progress and scan cancellation remain available.

Both browsers pass **18 functional scenarios**: visible series/season selection with partial states and context; clearing on page, sort, search and view changes; return to an earlier scope without reviving selection; shared-root counts and report labels; one help control per tool; inline hints in every list tab; settings Save geometry; rule help; single marking without a dialog; one short confirmation for three files; sequential requests; silent duplicate skipping; one aggregate failure toast without an additional per-request API toast. Mux identification responses in these browser scenarios are synthetic; existing Go tests validate real job guards and file work. Additional browser scenarios in both engines verify explicit selected-tag additions/removals and protected unmarking: queued jobs and retained backups survive, the draft marking is removed and one toast names the skipped count. A separate pure batch test processes **250 files**, proving the former 200-file cap is absent and checking protected removal and first-error reporting.

Custom tags and Display Save buttons have identical measured geometry in both browsers: **x 1289.22 / y 142 / width 126.78 / height 34 px** at 1440 px. Their underlying save transactions remain unchanged; tag names still save immediately. System has no Save button. Every section uses the shared heading component and retains its form callbacks and sticky selector.

Independent review also found selection was only hidden on scope changes. A browser test reproduced its reappearance after returning to the previous page. Scope and visibility changes now durably prune saved keys. A third finding about dominant mismatch reasons is covered by tests for all three reasons. No review issues are deferred.

## Selected synthetic images

- [Shared-root report](images/releases/1.4.3/shared-root-report.png)
- [Combined scan help](images/releases/1.4.3/combined-help.png)
- [Custom-tag Save settings](images/releases/1.4.3/custom-tags-save.png)
- [Tag-rule help](images/releases/1.4.3/rule-help.png)
- [Inline fixed-list hints](images/releases/1.4.3/inline-hints.png)

## Compatibility and publication

No database schema or dependency change is introduced. Internal root keys are neither serialized nor written to media rows. Rollback to 1.4.2 has no restrictions. A new manual scan refreshes saved counters; no background scan starts as part of the update.

The Approved release workflow gates publication on exact-main CI, both image architectures, runtime vulnerability scans and the existing 100,000-file container test at 512 MiB without additional swap. The maintainer identity and complete messages are checked before every commit; no assistant attribution is added.
