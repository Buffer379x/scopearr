# Unraid installation

Use the public release image and the included XML template. Existing installations update through Unraid’s normal container update action.

1. Save `deploy/scopearr.xml` as `my-scopearr.xml` under `/boot/config/plugins/dockerMan/templates-user/`.
2. Select Docker → Add Container → template `scopearr`.
3. Use repository `ghcr.io/buffer379x/scopearr:stable`, keep Privileged off, and select Shell `sh`. With Bridge, choose a free host port. With an existing custom Docker VLAN, choose that network and a reserved fixed IP; port 8080 is reachable directly on that IP.
4. Mount `/data` at a local SSD/NVMe pool path such as `/mnt/cache/appdata/scopearr`. Adjust the pool name. For library exploration, add no media directories. Optional track editing and renaming require a read-write media mount outside `/data`; [MediaInfo inspection](MEDIAINFO.md) can use a read-only media mount. See [MKVToolNix and renaming](MUX.md). Before first start, create the directory and set ownership/mode for the container: `mkdir -p /mnt/cache/appdata/scopearr`, `chown 99:100 /mnt/cache/appdata/scopearr`, `chmod 700 /mnt/cache/appdata/scopearr`.
5. Extra Parameters: `--user=99:100 --read-only --tmpfs=/tmp:rw,noexec,nosuid,nodev,size=32m --cap-drop=ALL --security-opt=no-new-privileges --memory=512m`. Match the directory owner when changing UID/GID. PUID/PGID environment variables are not used; there is no root entrypoint.
6. Apply and open WebUI. Read `cat /data/setup-token` in the container console, then enter the code and new credentials yourself in the interface.
7. In Settings → Services, enter/test/enable/save Radarr and Sonarr URLs and API keys. Optionally connect Emby. Keys are located under Settings → General in Arr services and Dashboard → API keys in Emby. Wait for the initial complete sync.
8. Enable Autostart. Choose the interface language on login or under Settings → Display.

Updates: Docker → Check for Updates → Scopearr → Update. The existing `/data` is reused; required schema migrations create a consistent database snapshot first. Version 0.3.0 upgrades SQLite to schema 5 with an automatic backup. A rollback to 0.2.3 also requires its matching pre-migration database snapshot.

A dedicated container IP does not need host port mapping. Ensure the container can reach its services through your VLAN/firewall rules. Without HTTPS, keep `SCOPEARR_HTTPS=false`; with an existing HTTPS proxy, set it to true. The template does not set up public Internet exposure. A swap-limit warning means the host cannot enforce that additional limit; it does not remove the RAM limit.

If pulling reports access denied, verify that the GHCR package is Public, independently of repository visibility. See [operations](OPERATIONS.md) for backup and recovery.


The template uses a 512 MB RAM limit (`--memory=512m`) without requesting an unsupported swap-accounting limit. Existing Unraid container parameters are stored separately: an image update does not replace Extra Parameters. If your host reports the swap-limit warning, remove only `--memory-swap=512m` from that field when editing the container, retaining `--memory=512m` and the other restrictions. Hosts supporting swap accounting may retain the stricter flag. Docker Compose and automated tests continue to set memory-plus-swap to 512 MB. See [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/).

When enabling MKVToolNix, retain the 512 MB limit, mount the media root `/mnt/user/` at `/media` manually, and grant UID 99/GID 100 write access. Existing installations do not inherit template changes.

## Media root and mux working directory (1.2.1)

The optional Media root template entry suggests `/mnt/user/` (not `/mnt/usr/`) at `/media`, with an empty initial value. Shares appear as `/media/movies`, `/media/shows` and `/media/documentaries`. Map Radarr's `/movies` to `/media/movies`; for a TRaSH layout in the `data` share, map `/data/media/movies` to `/media/data/media/movies`. The host root is exposed read-write; Scopearr writes inside configured mappings. Keep media outside Appdata `/data`.

Existing containers do not inherit template changes. Edit the existing `/media` path, or use **Add another Path**. Optionally mount a cache/SSD folder at `/mux-work` and select it in MKVToolNix → Processing. Leaving it empty retains the same-folder default. Both media and work directories need write access for UID 99/GID 100 and source-size free space plus about 1.1 GB. Outputs are copied across mounts after verification; allow extra time. See [the mux guide](MUX.md).

Version 1.2.2 raises the supported default from 256 MB to 512 MB after a repeated 100,000-file/two-media-server sync reproduced an OOM at 256 MB. Existing containers must update Extra Parameters manually: use `--memory=512m`, and `--memory-swap=512m` where supported. Keep `GOMEMLIMIT=64MiB`; image updates do not rewrite your saved container limits.

## Disk placement (1.3.0)

Existing containers do not inherit new template paths. Edit Scopearr, choose **Add another Path** and add `/mnt/` on the host at `/unraid` in the container. For scanning alone read-only is sufficient; moving, physical renaming and same-disk mux output require read-write access for UID 99/GID 100. Retain the separate `/mnt/user/` → `/media` mapping. Optionally add `/var/local/emhttp/` → `/unraid-state` **read-only**. Keep Appdata and the three mount destinations separate; do not mount `/var/run`, the Docker socket or system directories.

Enable **Unraid** in Settings → Services. Since 1.4.4 disk placement needs neither MKVToolNix nor path mappings; mappings only help to resolve root folders, while Files & permissions and physical mux output still require them. Use **Check paths** to discover array disks and pools, probe write access and, when mappings exist, compare a sample of cached media files with physical files. Save the settings. A missing state mount leaves a persistent warning: mover/parity waiting is unavailable. Unknown state formats warn instead of pretending the system is idle. The Unraid state snapshot can lag actual system activity; stop competing operations before starting a move.

Open **Disk placement** and choose **Scan** to open its options dialog. Select services, series/season grouping, allowed target disks and the free-space reserve, then start the scan. Set **Verify copies with checksums** under **Settings → Services → Unraid → Paths**; it controls moves and same-disk ownership copies, independently of scan options. Scans are manual, use metadata only and never open media contents. Cache residency affects whether metadata access spins up disks: consider **Dynamix Cache Directories** and verify behavior on your own shares. The real-Unraid warm-cache spike kept disks asleep with and without the plugin; that does not guarantee cold-cache scans remain asleep.

Disk tags show the target in green and all source disks in orange; without a planned target, the largest existing share is green (ties use disk name). Hover or keyboard-focus a tag, or tap it on touch devices, to see source/target meaning, size and file/folder counts. The +N chip describes remaining disks and opens the full details. Disk detail files can be sorted by path, size and placement.

The **Scan report** groups moves by target disk and exports CSV, including host paths for deliberate offline inspection. Pools are visible but cannot be placement targets. Pool/array mixtures wait for mover. Existing target disks are ranked by bytes already present, then free space; the planner accounts for other proposed moves and the reserve. Small companion-file moves are distinguished from media moves. Duplicate paths, foreign file ownership and unsafe/changed paths block moving. Series-folder companion files follow the disk containing most series bytes when grouping by season.

Marking for muxing and preflight checks never create files or folders in media directories, including cache-backed shares. They inspect existing directories and effective access permissions. Actual mux, rename and move operations still write as required. Existing empty cache folders from earlier checks can be inspected and cleaned up through Disk placement → Empty copies; this release does not delete them automatically.

Start an item, selected items or all ready items. Moves run one at a time and cannot overlap mux jobs. With the state mount, queued moves wait during mover or parity activity. Copies are written on physical array disks, synchronized about every 17 MB, verified for size (optionally SHA-256), and published without overwriting. Mode, mtime and atime are preserved. Source files and empty source folders are removed only within the mapped item. Nothing is copied or linked through `/mnt/user`; user-share paths stay the same. No Arr or player rescan is requested.

Cancel stops the current copy and the queue, retaining already completed files. After a restart, Scopearr removes its own unfinished partials when a safe source exists; identical published copies can be reconciled, while differences request manual attention. Use **Check again** or run another scan before continuing an interrupted item. Do not manually delete the only remaining copy. Status checklists, relative-path logs and item details explain the next step.

To reduce future split movie folders, review Unraid share split-level settings; **Automatically split only the top level directory** generally keeps an individual movie folder together. Match the setting to the actual share layout. Retain the **512 MiB** memory limit and `GOMEMLIMIT=64MiB`.

Version 1.3.0 migrates SQLite schema 16 → 17 after an automatic Appdata backup. Rollback to 1.2.6 requires restoring that backup; see [operations](OPERATIONS.md).

## Disk placement and file fixes (1.3.1)

Items marked **Mover** (parts on a pool and on the array) now have a target. Start them individually or by selection; **Start all** still skips them. Without the `/unraid-state` mount, Scopearr asks you to confirm that the mover is not running. Pool files are copied disk to disk like array sources; if the mover changes the item meanwhile, the row stops with **Review**.

Tools → Files & permissions can take ownership of foreign-owned files by copying them on the same physical disk. This needs the Unraid service and the `/unraid` mount with read-write access. See [Files & permissions](FILES.md).


## Result filters

Use the **Show** checkboxes and their count badges to filter scan results immediately. Multiple values in one group match any selected value; different groups combine. Active filters appear as removable tags; reset clears the result filters and search while keeping scan options. Choices persist in this browser. Tool filter panels start collapsed on every visit; active tags and progress remain visible. The **Scan report** begins with its local completion time and duration (with the full ISO timestamp available). While a new scan runs, the report retains the previous completed scan and says so. Select multiple targets from the disk summary to narrow the list.

## Additional root folders (for example documentaries)

Disk placement reads the share folder behind every root folder of the selected Radarr/Sonarr instances, including additional roots such as `/documentaries`. A path mapping such as `/documentaries => /media/documentaries` is optional and only helps to resolve the share folder. Folder names are detected; no movies/shows/documentaries names are hard-coded.

Expand the filters to choose **Shares** under Show when the last scan detected at least two shares. This filters the list independently of the services selected in the Scan dialog. Both Disk placement and Files & permissions support this filter, removable chips and saved list-filter presets. Presets never change scan settings. Since 1.4.4 missing mappings, unresolved roots and scan notices appear inside the **Scan report**, marked by a dot on the report icon; scan errors appear as a toast. **Apply mapping** accepts only the server-verified local suggestion. Use **Map in settings** when no suggestion is available. Mapping changes are blocked while file jobs or scans are active. After saving a mapping, start a new scan manually. A scan never starts automatically. Files & permissions shares the same coverage and mappings. The scan button is the first results action; progress appears below the results heading. Reports, scan information and scan help are in the filter footer. Files & permissions can export the complete filtered list to CSV, using the current sorting and selected shares.

## Complete placement diagnostics (1.4.2)

A mapped container root is checked against `/unraid/user/<relative-path>` (normally host `/mnt/user`). When the directory identity differs, Scopearr searches normal share directories and one nested level, using metadata only. A unique identity match supplies the actual disk-relative path, for example `Dokus` for `/media/documentaries`. The notice and **Scan report → Folders** show the detected path. Multiple matches, system/external roots and unsafe replacements never authorize moves. A missing identity match retains a warning; a folder absent from every physical disk is **Not found**, belongs to Errors and cannot start.

With **season-folder grouping**, a series with complete seasons on different array disks appears as **Seasons spread** under Several disks. This informational row cannot start; switch to **series grouping** and scan again to plan consolidation. Existing season plans are unchanged. **One disk** rows store disk totals without file lists. They are hidden by default, but searches offer **Show** when only hidden one-disk matches exist. Their details identify the disk and folder/file totals.

A root such as `/documentaries` may be shared by Radarr and Sonarr. Scopearr matches its normalized Arr path and stable instance IDs, including unnamed instances, and retains the source root through physical path remapping. The Folders report shows root, all instance labels, actual share path, **From Arr** and **Scanned** before the decision counts. From Arr includes reported items from unselected enabled instances; a notice explains the most common reason for a difference (unselected instance, outside share or path warning). Number buttons set the Shares and Show filters; Scanned selects All scanned. For additional roots such as documentaries or shows, inspect this report after the first scan to distinguish missing mappings, a renamed share, one-disk items and split seasons. The diagnostics describe the current host; the release fixture cannot establish the layout of another Unraid installation.

Release **1.4.3** introduces no schema change; rollback to **1.4.2** has no restrictions. Bulk starts confirm the number of eligible entries. Start all in Disk placement uses the current filtered eligible list. On rollback to **1.4.1**, run a new placement scan to replace new statuses and compact rows; no settings reset or schema rollback is needed. Keep `/data` and its key, and retain the **512 MiB / no additional swap** container budget.

## How disk placement finds folders (1.4.5)

Disk placement now starts from the share folders behind the Radarr/Sonarr root folders and reads each share directly on every disk. Only shares that an enabled, selected Radarr or Sonarr instance reports as a root folder are scanned; other shares (for example `Fotos`) are never read and never need to be excluded.

Each root folder resolves to one share folder below `/unraid/user` (host `/mnt/user`):

1. a saved choice in **Settings → Services → Unraid → Shares** (including **Do not scan**);
2. the MKVToolNix path mapping, confirmed by filesystem identity against the first-level shares;
3. the share with the same name as the last root-path component, for example `/documentaries` → `documentaries`;
4. otherwise the root stays unresolved and the report links to the Shares card.

For every resolved share Scopearr reads the item folders once per disk (`/unraid/<disk>/<share>`). Devices include array disks and every detected pool, not just pools named cache. Several disks means presence on at least two devices, including empty copies and blocked/mover results, excluding successfully moved rows. One-device folders get a metadata-only recursive emptiness check that stops at the first non-directory entry, without per-file stat calls, reading media contents or following links. These rows remain compact, with size “—”. Folders are matched to Arr entries by name (exact first, then a unique case-insensitive match). Folders without a Radarr/Sonarr entry are listed with **No Radarr/Sonarr entry** and can be shown with the **Without Arr entry** status filter. Arr entries without a folder on any disk remain **Not found**. A root shared by Radarr and Sonarr is read once and keeps both instances.

The **Shares** card lists only the root folders reported by enabled services, with their instances, the automatic share folder and its status. Choose another share, or a subfolder via **Choose subfolder …**, when the automatic match is wrong; the choice associates an existing root and never adds scan scope. Save settings, then start a new scan.

The scan report's **Shares** table shows the root folders/instances and devices checked, then live counts for all rows, Several disks, One disk, Empty folders, Without Arr entry and Not found. Each number opens exactly that share/filter result. **Several disks by result** breaks down split folders, empty copies, empty folders, mover, spread seasons and blocked/error results; these clicks restrict the list to that multi-device subset. Counts and lists share one SQL predicate definition and refresh together after moves, rechecks and removals. Scan-time device errors and unresolved roots remain diagnostics. A covering index groups equal status facts before evaluating the live counters; no stale counters are stored.

- **Empty folder**: recursively no non-directory entry on any device. Even a link, socket, zero-byte file or `.strm` file makes the folder nonempty. Empty folders on one or several devices are visible and never startable/selectable.
- **Empty copies**: content on one array disk, only empty directory trees on the others. Cleanup removes only non-target empty directories and leaves the target intact, including its empty subfolders.
- **Waiting for mover**: content on a pool and an array disk, or pool-only content with another device present. Cache-only content plus an empty array copy has no manual target or planned influx; run the mover first. Pool-only content on just one device remains On one disk. Mover entries never join Start all.
- **Seasons spread** retains the series-root/season model; use grouping by series to consolidate. Links and special files retain warnings and cannot move; a plan is blocked if one would remain on a source device.

Normal `#`/`@` media folders, including `#amleben`, are scanned. Exclude these exact system names case-insensitively: `#recycle`, `#snapshot`, `@eaDir`, `@Recycle`, `@Recently-Snapshot`, `@tmp`, `@SynoResource`, `lost+found`, `.Recycle.Bin`, plus the `.Trash-` prefix. Other leading-dot folders are excluded unless an Arr entry points to that exact name. The same rule applies to season folders. Top-level symlinks and non-directories are excluded.

Release **1.4.5** adds `share` and `devices` columns and indexes without changing the schema version. Rollback to **1.4.4** has no restrictions; its explicit column lists still work. Run a new manual placement scan after updating or rolling back. No scan starts automatically.

### Compare placement with the Unraid host

Use the metadata-only [host helper](scripts/placement-host-check.sh), which discovers array disks and pools by their actual mounted device, skips reserved names, never follows links and distinguishes a wholly empty folder from an empty copy. Unlike a per-disk `find -empty`, the Empty mode combines every device and checks nested directory trees. Neither command reads file contents.

For an exact comparison of top-level folders, select **Grouping by series** and run a fresh scan. Season grouping additionally lists season rows and their series-root companions, so its totals can exceed a top-level host listing. Pass the same resolved share folder as shown in the report, including a nested path if applicable.

```bash
curl -fsSLo /tmp/scopearr-placement-host-check.sh \
  https://raw.githubusercontent.com/Buffer379x/scopearr/v1.4.5/docs/scripts/placement-host-check.sh
# Several disks for documentaries (including cache and other pools):
bash /tmp/scopearr-placement-host-check.sh documentaries several
# Completely empty shows folders across all devices, once per logical folder:
bash /tmp/scopearr-placement-host-check.sh shows empty
```

Each line is `device count`, `folder name`, `device names`, separated by tabs. The number of lines matches the corresponding fresh report/filter count when grouping by series and filesystem contents are unchanged. The helper defaults to `/mnt`; its third argument overrides that root for testing. If Arr explicitly includes a leading-dot media folder, list its exact name after the root argument, for example `… movies several /mnt '.hidden-film'`; the helper cannot discover Arr associations itself. Unreadable directory trees are reported to stderr and never classified as empty. Reserved system names remain excluded even when passed explicitly.

## Pool consolidation and saved checks (1.4.6)

Cache and other pools are ordinary source devices. A folder with files on a pool and an array disk, or a pool with an empty array copy, can be consolidated manually and through **Start all**. Targets are always eligible array disks, ordered by existing bytes, free space, then disk number. If the folder is absent from every array disk, choose an eligible disk by free space and mark the target as new. A folder only on one pool remains **On one disk**.

Read-only `shares.ini` beside `var.ini` supplies each top-level share's runtime `useCache`, `cachePool` and `cachePool2` fields; the prefixed configuration/form aliases (`shareUseCache`, `shareCachePool`, `shareCachePool2`) are also accepted. Nested scan folders inherit the top-level share's policy. **Prefer/Only** keeps pool files on the pool: mixed pool/array content stays Split without a target and explains the restriction. Missing or unknown settings follow the ordinary-device model; the report shows the cache policy and a notice if the file is unavailable. The runtime fields and their form aliases are shown in [Unraid's primary/secondary storage implementation](https://github.com/unraid/webgui/blob/master/emhttp/plugins/dynamix/ShareEdit.page). A running mover or parity operation still prevents execution; queued moves wait. Old Mover and Owner results remain readable and can be rechecked into the new model.

Exact source ownership is no longer a blocker. Scopearr checks effective-process read access and write/search access to each source parent, including sticky-directory restrictions, without reading file contents during scanning. Links/special files and existing conflict/space/path safeguards still block moves. Readable, removable files owned by another user may move: the copy becomes **99:100**, retaining its mode and timestamps. The dialog, start confirmation and event log explain this ownership change. **Check in Files & permissions** opens that tool with the folder search prefilled; its configurable ownership rules remain unchanged.

The last check is stored with the row and its UTC time, shown in local time. Reloading or rescanning unchanged files preserves it; changed files clear it. Successful rows retain the last preflight until removed. File diagnostics are limited to 50 entries and 16 KiB, with a remaining count. Every move still performs a fresh preflight. After updating or rolling back, run a new disk-placement scan. The additive check column leaves the schema version unchanged and permits unrestricted rollback to 1.4.5.


## Rename directly on the original disk (1.6.0)

With Unraid enabled and its media mappings configured, file renaming resolves the video and every selected companion independently to a physical path under `/unraid/<device>/<share>/…`. A video on `disk2` and its subtitle on `cache` are each renamed on their own device. Renaming does not copy between devices, create a destination directory or use hardlinks on physical paths. It does not depend on the separate same-disk mux-output option. If a companion operation fails, completed moves are reversed on their original devices; an incomplete rollback names the files to inspect manually.

The preview shows each file's device. A file found on several devices blocks the preview: consolidate its folder with **Disk placement** first. Without a usable Unraid setup, renaming retains the mapped user-share behavior; the preview explains **Renamed through the user share** and points to Unraid setup. Keep the MKVToolNix service enabled for the shared mapping/rename workflow; installing mkvmerge is unnecessary for renaming.

Before moving files, Scopearr checks which devices contain the folder using directory metadata only. After a completed Arr refresh it checks again. If another device now contains that folder, a warning toast and a `rename` event identify the new devices. Radarr/Sonarr or a media server can create renamed NFO files or artwork through `/mnt/user` after the rename; use Disk placement to consolidate the result. An incomplete refresh does not claim a completed check, and an inspection failure produces a warning for manual review.

## Default file owner (1.6.0)

**Settings → Services → Unraid** has **Paths** and **Default owner** cards above Shares. Set the default UID/GID there; initial values are 99:100, with existing Files & permissions values carried forward on upgrade. The card also shows Scopearr's effective process UID/GID. Opening or resetting **Files & permissions** takes its owner filter values from these defaults; a scan does not change the defaults.

Choosing a default does not change the container's identity or grant permission to assign an arbitrary owner. Findings that the current process cannot fix are marked **Manual** and skipped by Fix all; use the generated commands with an appropriate host identity. See [Files & permissions](FILES.md).

## Scan dialogs and file-check preferences (1.6.2)

Both tools keep search, presets, Shares, Kind and Status in the result filter panel. **Scan** opens a separate options dialog; changing a result filter or loading a preset never changes the scan scope. Files & permissions orders its options as Services, Checks, Target owner, Target permissions and Fixing. The Custom values radio choice reveals file and folder modes directly below it. Target modes are always used by fixes; enable strict checking to report every mode difference rather than only inaccessible paths. A scan dialog can open while fixes or moves are active, but starting waits until that work finishes or is cancelled.

Under **Settings → Services → Unraid**, the **Files & permissions** card combines the persistent default owner with **Allowed and ignored names**. Edit both name lists in their dialog, apply to the settings draft, and use the normal **Save settings** action. The counts and hint explain that changes apply to the next scan. The Paths card contains the existing **Verify copies with checksums** preference; scans preserve it.

Manual and failed file-check findings can be selected for **Terminal commands**. Automated Fix selected counts only fixable rows. **Terminal script for all matches** downloads the current filtered open findings across all pages, up to 50,000 entries. Commands group at most 100 quoted paths per command and value; owner findings produce chown, permissions produce chmod, explicit deletion findings take precedence, and links/special or untracked-media findings produce review comments. Over 500 script lines, the dialog previews the first 50 while Copy and Download retain the complete script. Scopearr generates these commands for review and never executes them. See [Files & permissions](FILES.md).
