# Unraid installation

Use the public release image and the included XML template. Existing installations update through Unraid’s normal container update action.

1. Save `deploy/scopearr.xml` as `my-scopearr.xml` under `/boot/config/plugins/dockerMan/templates-user/`.
2. Select Docker → Add Container → template `scopearr`.
3. Use repository `ghcr.io/buffer379x/scopearr:stable`, keep Privileged off, and select Shell `sh`. With Bridge, choose a free host port. With an existing custom Docker VLAN, choose that network and a reserved fixed IP; port 8080 is reachable directly on that IP.
4. Mount `/data` at a local SSD/NVMe pool path such as `/mnt/cache/appdata/scopearr`. Adjust the pool name. For library exploration, add no media directories. Optional track editing requires a read-write media mount outside `/data`; see [MKVToolNix](MUX.md). Before first start, create the directory and set ownership/mode for the container: `mkdir -p /mnt/cache/appdata/scopearr`, `chown 99:100 /mnt/cache/appdata/scopearr`, `chmod 700 /mnt/cache/appdata/scopearr`.
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

The optional Media root template entry suggests `/mnt/user/` (not `/mnt/usr/`) at `/media`, with an empty initial value. Shares appear as `/media/movies` and `/media/shows`. Map Radarr's `/movies` to `/media/movies`; for a TRaSH layout in the `data` share, map `/data/media/movies` to `/media/data/media/movies`. The host root is exposed read-write; Scopearr writes inside configured mappings. Keep media outside Appdata `/data`.

Existing containers do not inherit template changes. Edit the existing `/media` path, or use **Add another Path**. Optionally mount a cache/SSD folder at `/mux-work` and select it in MKVToolNix → Processing. Leaving it empty retains the same-folder default. Both media and work directories need write access for UID 99/GID 100 and source-size free space plus about 1.1 GB. Outputs are copied across mounts after verification; allow extra time. See [the mux guide](MUX.md).

Version 1.2.2 raises the supported default from 256 MB to 512 MB after a repeated 100,000-file/two-media-server sync reproduced an OOM at 256 MB. Existing containers must update Extra Parameters manually: use `--memory=512m`, and `--memory-swap=512m` where supported. Keep `GOMEMLIMIT=64MiB`; image updates do not rewrite your saved container limits.

## Disk placement (1.3.0)

Existing containers do not inherit new template paths. Edit Scopearr, choose **Add another Path** and add `/mnt/` on the host at `/unraid` in the container. For scanning alone read-only is sufficient; moving and same-disk mux output require read-write access for UID 99/GID 100. Retain the separate `/mnt/user/` → `/media` mapping. Optionally add `/var/local/emhttp/` → `/unraid-state` **read-only**. Keep Appdata and the three mount destinations separate; do not mount `/var/run`, the Docker socket or system directories.

Enable MKVToolNix and configure Arr path mappings, then enable **Unraid** in Settings → Services. Installing mkvmerge is unnecessary for disk placement. Use **Check paths** to discover array disks and pools, probe write access and compare a sample of cached media files with physical files. Save the settings. A missing state mount leaves a persistent warning: mover/parity waiting is unavailable. Unknown state formats warn instead of pretending the system is idle. The Unraid state snapshot can lag actual system activity; stop competing operations before starting a move.

Open **Disk placement**, choose libraries, series/season grouping, allowed target disks, free-space reserve and optional checksum verification, then **Scan**. Scans are manual, use metadata only and never open media contents. Cache residency affects whether metadata access spins up disks: consider **Dynamix Cache Directories** and verify behavior on your own shares. The real-Unraid warm-cache spike kept disks asleep with and without the plugin; that does not guarantee cold-cache scans remain asleep.

Disk tags show the target in green and all source disks in orange; without a planned target, the largest existing share is green (ties use disk name).

The summary groups moves by target disk and exports CSV, including host paths for deliberate offline inspection. Pools are visible but cannot be placement targets. Pool/array mixtures wait for mover. Existing target disks are ranked by bytes already present, then free space; the planner accounts for other proposed moves and the reserve. Small companion-file moves are distinguished from media moves. Duplicate paths, foreign file ownership and unsafe/changed paths block moving. Series-folder companion files follow the disk containing most series bytes when grouping by season.

Start an item, selected items or all ready items. Moves run one at a time and cannot overlap mux jobs. With the state mount, queued moves wait during mover or parity activity. Copies are written on physical array disks, synchronized about every 17 MB, verified for size (optionally SHA-256), and published without overwriting. Mode, mtime and atime are preserved. Source files and empty source folders are removed only within the mapped item. Nothing is copied or linked through `/mnt/user`; user-share paths stay the same. No Arr or player rescan is requested.

Cancel stops the current copy and the queue, retaining already completed files. After a restart, Scopearr removes its own unfinished partials when a safe source exists; identical published copies can be reconciled, while differences request manual attention. Use **Check again** or run another scan before continuing an interrupted item. Do not manually delete the only remaining copy. Status checklists, relative-path logs and item details explain the next step.

To reduce future split movie folders, review Unraid share split-level settings; **Automatically split only the top level directory** generally keeps an individual movie folder together. Match the setting to the actual share layout. Retain the **512 MiB** memory limit and `GOMEMLIMIT=64MiB`.

Version 1.3.0 migrates SQLite schema 16 → 17 after an automatic Appdata backup. Rollback to 1.2.6 requires restoring that backup; see [operations](OPERATIONS.md).

## Disk placement and file fixes (1.3.1)

Items marked **Mover** (parts on a pool and on the array) now have a target. Start them individually or by selection; **Start all** still skips them. Without the `/unraid-state` mount, Scopearr asks you to confirm that the mover is not running. Pool files are copied disk to disk like array sources; if the mover changes the item meanwhile, the row stops with **Review**.

Tools → Files & permissions can take ownership of foreign-owned files by copying them on the same physical disk. This needs the Unraid service and the `/unraid` mount with read-write access. See [Files & permissions](FILES.md).


## Result filters

Use the **Show** checkboxes and their count badges to filter scan results immediately. Multiple values in one group match any selected value; different groups combine. Active filters appear as removable tags; reset clears the result filters and search while keeping scan options. Choices persist in this browser. Tool filter panels start collapsed on every visit; active tags and progress remain visible. The information icon beside scan help shows the last scan time and duration plus mover/parity state. Select multiple targets from the disk summary to narrow the list.
