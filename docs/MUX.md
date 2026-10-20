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

Open a file's details and choose Mark for muxing. Scopearr checks access and identifies its tracks with `mkvmerge -J`. The Muxing tab appears while jobs exist, including finished jobs. Open **Mux options** in the job row to edit track retention, language, name, default/forced flags, chapters, attachments, output basename. At least one video track must remain when video is present; only one retained default track per type is allowed. Output is always `.mkv`, including for MP4, AVI and TS sources.

Save options to make the job **Ready**. Existing drafts remain **Not configured** after upgrading and need one explicit save. Starting never saves drafts automatically. Start selected only affects selected startable jobs; Start all queues ready, failed and cancelled jobs. The header checkbox selects only these jobs. A warning does not hide selection, but starting reports the failed file checks.

The page uses the same table layout as the movie and series libraries. Configure visible columns and their order under **Settings → Display → Muxing columns** (visible only with the service enabled). Selection always stays first; Filename always remains visible. **All columns** temporarily reveals hidden columns without changing the saved layout.

Status tags open a vertical checklist. **Check again** bypasses the 30-second check cache, or identifies the file again when review is needed. Status meanings: Not configured = options need saving; Ready = saved and startable; Waiting = queued; Running = executing; Successful = finished; Failed = execution failed; Cancelled = stopped; Review needed = source changed/interrupted identification; Action needed = finishing/recovery steps remain. Warning overrides editable states when a file check fails.

**Terminal** opens a black, plain-text MKVToolNix log. It refreshes every second during execution using offsets, up to 64 KiB per response, and follows new output unless you scroll up. Paths are redacted before being written to disk; only basenames appear. Warnings/errors/completion lines are colored. Copy log copies the displayed text. Logs are removed when their jobs are removed, including retention cleanup. The page itself polls every two seconds while jobs wait/run and every 15 seconds otherwise; hidden tabs pause polling. Jobs run one at a time, with progress and cancellation. Concurrent edits use revisions and reject stale saves. Changed source files require identification and review. Failed commands and cancellations before replacement remove temporary output and preserve the source.

Scopearr writes a hidden `.scopearr-<jobID>.partial` file in the source directory. It verifies track counts, nonzero size and duration within one second before touching the original. It never overwrites an unrelated existing destination. Publishing a different name uses a same-directory hard link followed by unlinking the temporary name, preventing a concurrent destination from being overwritten. This requires hard-link support on the media filesystem.

**Delete original after success** is a global setting under Settings → Services → MKVToolNix → Processing. Scopearr copies its current value into each job when it is queued; later changes do not affect queued or running jobs. Job options cannot override this policy.

With Delete original enabled, Scopearr rechecks Arr's original path and size, then deletes through `moviefile`/`episodefile`; Arr's configured recycle bin is respected. With the same name, deletion precedes publishing the verified replacement. If deletion fails, the original is preserved as `<original>.scopearr-backup-<jobID>` and the job needs attention. Without deletion, the same-name workflow always preserves a backup. Delete backup requires confirmation. Backups are never removed by job retention or tool removal. With a different output name and deletion off, both files remain; Arr chooses what to import, especially for duplicate episodes.

After publishing, Scopearr issues RescanMovie (`movieId`) or RescanSeries (`seriesId`), waits for completion and queues an internal delta sync even when webhooks are disabled. Existing tag reconciliation follows this sync. Optional notifications go only to media servers using the source Arr instance, through `/Library/Media/Updated`; existing media path mappings translate the source path. Radarr/Sonarr automatic renaming may subsequently change your chosen filename.

## Recovery and limits

Rescan or notification failures keep the output and mark the job as needing attention. Retry rescan repeats these finishing steps. A crash during muxing discards incomplete output. A crash during replacement preserves verified temporary output; restore/publish it locally before retrying the rescan if a partial file remains. Do not remove such a file until you have recovered the media. Keep Appdata database backups when updating; schema 16 cannot be opened by 1.1.x.

Check directory permissions for access errors, mount options for `noexec`, Appdata space for installation failures, and media space for job failures. Jobs require source-size free space plus 1 GiB reserve. If a file changed, synchronize Arr and identify it again. Diagnostic install output is local to `/data/tools/mkvtoolnix/install.log` (bounded); raw absolute media paths are not returned to browsers; authenticated users can view the redacted mux terminal. A 15-minute no-progress watchdog terminates a stalled mux. Linux readers holding an old inode can finish playing while replacement occurs; their storage is reclaimed when they close it.

There is no transcoding, external-track import, track reordering, scheduled execution or parallel muxing in this release. Successful jobs without backups are removed after seven days by default; set zero to retain them indefinitely.
