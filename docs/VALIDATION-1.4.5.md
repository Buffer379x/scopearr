# Scopearr 1.4.5 validation

Validated on 2026-10-25 against 1.4.4 (`be100ae`). All browser data and images are synthetic. The release plan's two report/host-check clarifications and natural description wrapping were explicitly approved by the maintainer.

## Automated checks

- Frozen pnpm installation, TypeScript, **136 frontend tests**, production build and dependency audit pass. No frontend dependency vulnerabilities; the existing Vite large-chunk advisory remains. No dependencies were updated.
- Go **1.27.3 through Docker only**: gofmt, Vet, Staticcheck v0.8.2 (`all,-ST*`) and full race suite pass (`internal/app`: **303.905 seconds**). Govulncheck reports **0 called vulnerabilities**; one advisory in an unused module path does not affect called code. Seven release-script tests pass. Source, package, both Docker defaults and English notes agree on 1.4.5.
- With `GOMAXPROCS=2`, the 50,000-file query fixture records p50 **44.31 ms**, p95 **75.10 ms**, below the unchanged 200 ms gate. Custom-tag filtering p95 is **100.97 ms**. Compact 50,000-row placement scan/search takes **2.51 seconds**.
- The new 100,000-row live-counter fixture measures **11.67 ms** for counts and **11.84 ms** for the report, both below 50 ms. Both GitHub performance gates now include this test. A covering index groups equal status facts before applying the shared weighted CASE expressions, preserving one live aggregate statement per endpoint and avoiding stored counters.
- The 20,000-folder metadata fixture retains only 7,000 regular file records across 1,000 multi-device folders; peak heap is **47.50 MiB**, below the unchanged 64 MiB gate. One-device probes stop at the first non-directory entry with `fs.SkipAll`, without file contents or per-file `Info` calls.
- A separate **100,000-folder compact placement scan** runs in **4.91 seconds** inside a container with memory and memory-plus-swap both **536,870,912 bytes**; exit 0, `OOMKilled=false`.
- The release image builds and starts read-only as **99:100**, with memory and memory-plus-swap both **512 MiB**, answers `/healthz` with version 1.4.5 and records `Scopearr 1.4.5 started`. The Approved release workflow additionally gates both architectures, runtime vulnerability scans and the existing full 100,000-file media-server container check.

## Placement matrix and invariants

`release_145_test.go` covers array disks, cache, movies, series, a root shared by Radarr/Sonarr and an unrelated Fotos share: split content; content plus empty copies; pool-only content plus an empty array copy (mover, no target); mixed pool/array content (manual target); a single pool; empty single/multiple-device folders and nested empty trees; `#amleben` and ordinary `#`/`@` names; an explicit hidden Arr folder; reserved system names; symlinks; foreign ownership; Harry Potter without a Sonarr entry; season grouping; ten multi-device documentaries; and a missing Arr folder.

All release-1.4.5 cases also pass under the race detector as both root and unprivileged UID 1000. The foreign-owner fixtures use real ownership as root and explicit, narrowly scoped foreign-file identities when chown is unavailable, so the same safety assertions run on hosted CI.

Counting metadata proves no access to Fotos. The synthetic matrix uses 17 explicit ReadDir calls and 44 WalkDir calls, including early-exit single-device probes. The Files & permissions Arr-folder resolver has exactly one corresponding placement row per root-relative media folder. Read errors retain known device presence, so a multi-device error remains in Several disks. Non-directory special entries are nonempty and keep warnings; moves are blocked if such an entry would remain on a source device.

Every status count matches the corresponding list total. Every per-share report number and scoped multi-device breakdown matches its list total before and after simulated successful moves. Breakdown sums include fully empty multi-device folders, as approved. A browser pass checks **all 36 report drilldowns** against returned and displayed totals. The report headline also uses the live several-devices count, rather than the former startable-move count. Controlled first-load and reload failures show one inline error, without a duplicate toast or stale count drilldowns.

Cleanup-only plans move zero files, remove non-target empty trees and preserve the target, including empty child directories and zero-byte files. A source that becomes nonempty after scanning is rejected and preserved, including a link added during copying; a completed copy is retained while the job requires review. Series-root companions still permit their managed season directories to remain. Existing collision, copy and ownership tests remain enabled.

## Migration and rollback

The test recreates the literal 1.4.4 placement table, opens it with 1.4.5, confirms additive `share`/`devices` columns and unchanged `user_version`, then performs a select and insert using the literal old column list. Reopening is idempotent. Additive covering indexes and the optional per-disk special-entry fact are ignored by old readers. Rollback to 1.4.4 requires no database restoration or layout reset; run a new scan after either version change.

## Interface measurements

Both settings and placement run through **48 combinations each**: Chromium/WebKit × 1440/820/375 px × light/dark × en/de/es/it, with **0 browser page errors**. Report tables fit without horizontal scrolling at 1440 px in all four languages; narrow tables scroll inside their wrappers without page overflow. All thirteen visible status counts match the API, including zero counts, One disk, Empty folders and Empty copies.

The timezone card keeps its heading above the control across both columns, additionally checked in Chromium/WebKit × three widths × four languages in the final image.

All six settings titles have the same measured y-position within 0.5 px in every combination. The title reserves the 34 px save-control height. Descriptions wrap naturally by the maintainer's decision: for example, at 820 px in German the Tag rules heading is 77.38 px high versus 58.19 px for shorter descriptions, while all titles start at y=200 px. A uniform whole-heading height is intentionally not imposed.

At 1440 px the German MKVToolNix package-channel and retention fields both measure **550 px** wide at **x=279 px**; at 820 px both measure **357 px** at **x=45 px**. Radarr/Sonarr address/synchronization and API-key/start-time pairs match x and width in every combination. At 375 px they stack and measure **293 px** wide. The log count is inside its h3 immediately after Log, using the shared heading-count recipe.

## Settings events and host checks

Tests save an interval, theme, columns, share choice, retention and API key and verify the appropriate named areas and field paths. Secrets are formatted only as `changed` before the normal redaction boundary; array elements are also redacted. Unchanged saves do not add events or increment repetitions. Distinct settings saves are exempt from background-notification deduplication, so saves within the same area retain separate field details and chronology. Details stop after 50 fields plus a remaining-count line. Custom-tag saves and tag-rule/preset saves/deletes produce concrete events. The viewer translates area-array elements, including service prefixes, and text exports retain English area names.

The corrected metadata-only [host helper](scripts/placement-host-check.sh) reports documentaries Several=10 and movies Empty=3 in the browser fixture. A separate tmpfs fixture proves support for an arbitrarily named `fast_pool`, nested empty trees and reserved-folder exclusion. The commands compare top-level folders with series grouping; season grouping includes additional rows. Empty mode groups all device copies and treats links/special entries as content, rather than counting every empty copy as an empty logical folder.

## Selected synthetic images

- [Live report with both tables](images/releases/1.4.5/placement-report.png)
- [Several disks list](images/releases/1.4.5/placement-several.png)
- [Empty folders list](images/releases/1.4.5/placement-empty.png)
- [Log with heading badge](images/releases/1.4.5/system-log.png)
- [Settings-change details](images/releases/1.4.5/settings-event.png)
- [MKVToolNix fields](images/releases/1.4.5/mkvtoolnix-settings.png)
- [Radarr fields](images/releases/1.4.5/radarr-settings.png)
