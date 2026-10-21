# MKVToolNix track editing

Scopearr 1.2.0 adds an optional, single-worker mux queue. Nothing is downloaded or analyzed until you enable MKVToolNix under Settings → Services → Add service, save, and download the tool. Library syncs remain independent. Jobs are added individually in File & metadata; there is no library bulk-mark action.

## Media root

Mount your media root read-write, for example `/mnt/user:/media`. Shares such as `movies` and `shows` then appear under `/media/movies` and `/media/shows`. The Unraid host path is `/mnt/user/`. Do not mount it under `/data`, which belongs to Appdata. UID 99 / GID 100 must be able to read files, write directories and traverse their parents. Appdata must allow execution. Existing installations must edit the existing `/media` container path or use **Add another Path** to add it manually; updating the template does not change installed containers. The template suggests `/mnt/user/` but leaves the actual value empty until you opt in. This root mount grants read-write access to everything beneath it; Scopearr writes only inside mapped folders.

Configure one shared mapping for **all Radarr and Sonarr instances**, one prefix per line:

```
/movies => /media/movies
```

With a TRaSH layout inside a `data` share, `/data/media/movies` maps to `/media/data/media/movies` instead. Match the actual share structure.

The left side is the path reported by Radarr/Sonarr, the right side the mount inside Scopearr. The longest prefix wins. Paths and resolved symlinks must remain within the configured mount. System directories and Appdata are rejected. Use **Import root folders** to read root-folder configuration from every enabled Arr service. Overlapping roots are deduplicated. Scopearr suggests an existing `/media` + Arr path or `/media/<root basename>` directory; Docker mounts cannot be inferred, so unresolved roots need manual mapping. Imported lines are a draft until you save the service settings.

**Check paths** uses your current, unsaved mappings and working-directory value. Its dialog reports the first syntax error with its line number, checks valid mapping destinations for existence, directory/read/write access and free space, compares Arr roots against the draft, and checks up to three cached files per enabled instance for reachability and matching size. Sample file paths are never returned. The check has a 15-second request budget; a failing Arr instance appears as its own warning.

On upgrade, mappings merge in instance-ID order, retaining line order. Exact duplicates collapse; conflicting targets retain the first and produce a server warning. The merged field is mirrored into the legacy per-instance fields for rollback to 1.2.2.

## Working directory

The default **Same folder as the media file** is unchanged: MKVToolNix writes a hidden partial file beside the source. To use a cache/SSD folder, add an optional read-write mount such as `/path/to/fast/disk:/mux-work`, choose **Separate directory** under Processing, enter `/mux-work`, and save. Appdata, `/tmp`, root and system directories are not allowed. Changing the directory is blocked while any job is queued or running.

A separate directory must already exist and be writable. Each job uses `<working directory>/.scopearr-mux/<jobID>/output.mkv.partial`. After verification, Scopearr moves the output to a hidden staging file in the media directory. Different container mounts require a copy even if they share a physical disk. The copy is cancellable, flushed to disk and size-checked before replacement. This adds time and requires source-size free space plus 1 GiB on **both** the working and media filesystems. Check paths reports working-directory access and free bytes as well as per-file readiness.

Job directories are removed on success, failure or cancellation. Startup removes leftover numeric job directories under `.scopearr-mux`; other names remain untouched. Verified staging files beside the source are preserved if replacement was interrupted, as described under Recovery. Do not use this private job directory for other files.

## Tool installation

The Alpine image keeps its package manager and trusted signing keys. Scopearr installs signed packages into `/data/tools/mkvtoolnix/root-<timestamp>` with no root permissions, scripts, shell or untrusted-package override. It invokes mkvmerge using the downloaded tree's own musl loader and library path. A version self-test precedes activation of the `current` symlink. Failed updates retain the previous tree. Tools cannot be changed during a mux job.

Stable follows the image's Alpine release; Current uses Alpine edge. Versions can differ by CPU architecture. On the tested Alpine 3.23 repositories, Stable includes GUI dependencies: allow about 340 MiB per tree and at least **800 MiB free Appdata** for installation/update. Edge required about 60 MiB. Use a **512 MiB** container limit when enabling this feature. Page cache counts toward cgroup memory; the spike reached the limit without an OOM. Downloads are not part of the image vulnerability scan. Check for updates queries signed Alpine package indexes; upstream release information is informational. Requests reject redirects.

## Editing and running

Open a file's details and choose Mark for muxing. Scopearr checks access and identifies its tracks with `mkvmerge -J`. The Muxing tab remains visible whenever MKVToolNix is enabled, including when there are no jobs. Open **Mux options** in the job row to edit track retention, language, name, default/forced flags, chapters, attachments, output basename. At least one video track must remain when video is present; only one retained default track per type is allowed. Output is always `.mkv`, including for MP4, AVI and TS sources.

Save options to make the job **Ready**. Existing drafts remain **Not configured** after upgrading and need one explicit save. Starting never saves drafts automatically. Start selected only affects selected startable jobs; Start all queues ready, failed and cancelled jobs. The header checkbox selects only these jobs. A warning does not hide selection, but starting reports the failed file checks.

The page uses the same table layout as the movie and series libraries. All mux columns are always shown in a fixed order: selection, buttons, filename, size, source service, status, progress and actions.

Status tags open a vertical checklist. **Check again** bypasses the 30-second check cache, or identifies the file again when review is needed. Status meanings: Not configured = options need saving; Ready = saved and startable; Waiting = queued; Running = executing; Successful = finished; Failed = execution failed; Cancelled = stopped; Review needed = source changed/interrupted identification; Action needed = finishing/recovery steps remain. Warning overrides editable states when a file check fails.

**Terminal** opens a black, plain-text MKVToolNix log. It refreshes every second during execution using offsets, up to 64 KiB per response, and follows new output unless you scroll up. Paths are redacted before being written to disk; only basenames appear. Warnings/errors/completion lines are colored. Copy log copies the displayed text. Logs are removed when their jobs are removed, including retention cleanup. The page itself polls every two seconds while jobs wait/run and every 15 seconds otherwise; hidden tabs pause polling. Jobs run one at a time, with progress and cancellation. Concurrent edits use revisions and reject stale saves. Changed source files require identification and review. Failed commands and cancellations before replacement remove temporary output and preserve the source.

Scopearr writes a hidden `.scopearr-<jobID>.partial` file in the source directory. It verifies track counts, nonzero size and duration before touching the original; duration checks account for removed longer tracks as described under Troubleshooting. It never overwrites an unrelated existing destination. Publishing a different name uses a same-directory hard link followed by unlinking the temporary name, preventing a concurrent destination from being overwritten. This requires hard-link support on the media filesystem.

**Delete original after success** is a global setting under Settings → Services → MKVToolNix → Processing. Scopearr copies its current value into each job when it is queued; later changes do not affect queued or running jobs. Job options cannot override this policy.

With Delete original enabled, Scopearr rechecks Arr's original path and size, then deletes through `moviefile`/`episodefile`; Arr's configured recycle bin is respected. With the same name, deletion precedes publishing the verified replacement. If deletion fails, the original is preserved as `<original>.scopearr-backup-<jobID>` and the job needs attention. Without deletion, the same-name workflow always preserves a backup. Delete backup requires confirmation. Backups are never removed by job retention or tool removal. With a different output name and deletion off, both files remain; Arr chooses what to import, especially for duplicate episodes.

After publishing, Scopearr issues RescanMovie (`movieId`) or RescanSeries (`seriesId`), waits for completion and queues an internal delta sync even when webhooks are disabled. Existing tag reconciliation follows this sync. Optional notifications go only to media servers using the source Arr instance, through `/Library/Media/Updated`; existing media path mappings translate the source path. Radarr/Sonarr automatic renaming may subsequently change your chosen filename.

## Rename files

Open a movie or episode's **File & metadata** dialog and click the pencil beside its filename. Edit the name without its extension; Scopearr preserves the original extension, including uppercase extensions and files without an extension. Enter saves, Escape cancels editing. Confirm before changing the file. During the rename and Arr rescan, the field stays locked.

The MKVToolNix service must be enabled with a writable media mount and matching Arr → Scopearr path mapping. Renaming does not require an installed mkvmerge. It is unavailable in demo mode. Remove every mux job for that file first, including completed jobs, because the Arr file ID may change after rescanning. Renames run one at a time and never deliberately replace an existing destination. Case-only changes are supported. Mapped symlinks must stay inside the mapped root; the media file itself must be a regular file.

For Sonarr, keep the series identity and season/episode numbers in the filename. Scopearr uses Sonarr's [parse API](https://github.com/Sonarr/Sonarr/blob/main/src/Sonarr.Api.V3/Parse/ParseResource.cs) to require the same series and the exact same episode IDs, including multi-episode files, before changing anything. Radarr associates the video with its existing movie directory. Both services must still report the cached source path and size.

A preview finds regular files in the same directory whose names start with the full old stem followed by `.` or `-`. Examples include `.de.srt`, `.de.forced.srt`, `.sub`/`.idx`, `.nfo`, `-poster.jpg`, `-thumb.jpg` and `-fanart.jpg`. Hidden files, symlinks, directories, nested subtitles, other videos, Scopearr partials/backups and write probes are excluded. Prefix matching is case-sensitive; `Show.S01E01` does not match `Show.S01E10.srt`. More than 50 companions is rejected.

Choose **Rename companion files too**, **Only the media file**, or **Cancel**. A companion target collision disables renaming companions while leaving the media-only choice available. A changed list requires a new preview. All selected destinations are checked before moving the media file; any companion failure reverses the completed moves. If a rollback also fails, the error lists the affected basenames for manual recovery and no rescan starts.

Scopearr then requests an Arr rescan, queues an internal library delta and sends configured media-server notifications for the old/new media paths. The rescan continues if the browser reloads. A timeout reports successful renaming with a pending refresh and schedules a delayed delta. Other refresh failures request manual synchronization; the rename remains in place. Emby/Jellyfin discover external subtitles when refreshing the item. Arr manages companion metadata as Extra Files; verify that your installation has rediscovered them after rescanning. Live Arr extra-file behavior must be checked in the target installation.

If **Rename Movies/Episodes** is enabled in Radarr/Sonarr, a future import or upgrade can rename the media again according to the Arr naming scheme. Companions are changed by Scopearr only when explicitly confirmed.

## Recovery and limits

Rescan or notification failures keep the output and mark the job as needing attention. Retry rescan repeats these finishing steps. A crash during muxing discards incomplete output. A crash during replacement preserves verified temporary output; restore/publish it locally before retrying the rescan if a partial file remains. Do not remove such a file until you have recovered the media. Keep Appdata database backups when updating; schema 16 cannot be opened by 1.1.x.

Check directory permissions for access errors, mount options for `noexec`, Appdata space for installation failures, and media space for job failures. Jobs require source-size free space plus 1 GiB reserve. If a file changed, synchronize Arr and identify it again. Diagnostic install output is local to `/data/tools/mkvtoolnix/install.log` (bounded); raw absolute media paths are not returned to browsers; authenticated users can view the redacted mux terminal. A 15-minute no-progress watchdog terminates a stalled mux. Linux readers holding an old inode can finish playing while replacement occurs; their storage is reclaimed when they close it.

There is no transcoding, external-track import, track reordering, scheduled execution or parallel muxing in this release. Successful jobs without backups are removed after seven days by default; set zero to retain them indefinitely.


## Troubleshooting

The terminal covers the entire job. `mkvmerge finished` means only the muxing command has exited; Scopearr still verifies the output, replaces or publishes the file, waits for the Arr rescan, queues its own library sync and optionally notifies Emby/Jellyfin. Only `Done: Mux completed` marks successful completion of this workflow. Every phase has a timestamp; errors include concrete duration, track-count, HTTP or timeout details, with absolute paths redacted.

When tracks are removed, a shorter container duration can be valid. Scopearr uses the longest retained track duration when every retained track has a duration tag; otherwise it allows shortening by up to 2% (at least one second). Without removed tracks the tolerance remains one second. Output longer than the source plus one second is rejected in every case. Source identification allows two minutes and output verification five minutes. An output-check failure before replacement preserves the original and removes temporary output.

`Waiting for Radarr/Sonarr rescan (queued/started)` describes the Arr command state. After five minutes without completion, the job needs attention and the message confirms that the new file is already in place. Check the Arr queue, then choose **Retry rescan**; do not start another mux over a preserved output. Failed final database writes retry for up to two minutes and remain pending in memory for subsequent worker ticks. A watchdog recovers stale running states when no worker or rescan handler owns them; after replacement it asks you to check the output and retry the rescan.

### Damaged source file / invalid data size

A failed job containing `malloc() returned nullptr` with an implausibly large size can indicate damaged input or a MKVToolNix parser problem. For example, `18446744072874029143` bytes is near the unsigned 64-bit limit, far beyond the container's memory budget. Raising the 512 MiB limit will not make that allocation possible. Repair or replace the source, or try a newer MKVToolNix using **Current (edge)**. Scopearr preserves the original on a failure before replacement. A warning about skipped invalid data alone does not stop a successful mux.

The failed status and terminal hint also distinguish a full target disk, UID 99 / GID 100 write permissions and unsupported/unreadable input. Absolute paths remain redacted; codec names containing slashes and relative MKVToolNix source references remain readable. There is no automatic retry, ffmpeg fallback or package-channel switch.
