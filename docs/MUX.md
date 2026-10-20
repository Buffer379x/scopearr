# MKVToolNix track editing

Scopearr 1.2.0 adds an optional, single-worker mux queue. Nothing is downloaded or analyzed until you enable MKVToolNix under Settings → Services → Add service, save, and download the tool. Library syncs remain independent. Jobs are added individually in File & metadata; there is no library bulk-mark action.

Mount media read-write, for example `/mnt/user/data/media:/media`. Do not mount it under `/data`, which belongs to Appdata. UID 99 / GID 100 must be able to read files, write directories and traverse their parents. Appdata must allow execution. Existing installations must add the mount manually; updating the template does not change installed containers.

For each Arr instance, configure explicit prefix mappings, one per line:

```
/data/media/movies => /media/movies
```

The left side is the path reported by Radarr/Sonarr, the right side the mount inside Scopearr. The longest prefix wins. Paths and resolved symlinks must remain within the configured mount. System directories and Appdata are rejected. Use Check paths after saving to test up to five cached files per library.

## Tool installation

The Alpine image keeps its package manager and trusted signing keys. Scopearr installs signed packages into `/data/tools/mkvtoolnix/root-<timestamp>` with no root permissions, scripts, shell or untrusted-package override. It invokes mkvmerge using the downloaded tree's own musl loader and library path. A version self-test precedes activation of the `current` symlink. Failed updates retain the previous tree. Tools cannot be changed during a mux job.

Stable follows the image's Alpine release; Current uses Alpine edge. Versions can differ by CPU architecture. On the tested Alpine 3.23 repositories, Stable includes GUI dependencies: allow about 340 MiB per tree and at least **800 MiB free Appdata** for installation/update. Edge required about 60 MiB. Use a **512 MiB** container limit when enabling this feature. Page cache counts toward cgroup memory; the spike reached the limit without an OOM. Downloads are not part of the image vulnerability scan. Check for updates queries signed Alpine package indexes; upstream release information is informational. Requests reject redirects.

## Editing and running

Open a file's details and choose Mark for muxing. Scopearr checks access and identifies its tracks with `mkvmerge -J`. The Muxing tab appears while jobs exist, including finished jobs. Expand a job to edit track retention, language, name, default/forced flags, chapters, attachments, output basename and original deletion. At least one video track must remain when video is present; only one retained default track per type is allowed. Output is always `.mkv`, including for MP4, AVI and TS sources.

Save edits or start a job to save automatically. Start selected only affects selected jobs in the mux queue; Start all queues runnable jobs. Jobs run one at a time, with progress and cancellation. Concurrent edits use revisions and reject stale saves. Changed source files require identification and review. Failed commands and cancellations before replacement remove temporary output and preserve the source.

Scopearr writes a hidden `.scopearr-<jobID>.partial` file in the source directory. It verifies track counts, nonzero size and duration within one second before touching the original. It never overwrites an unrelated existing destination. Publishing a different name uses a same-directory hard link followed by unlinking the temporary name, preventing a concurrent destination from being overwritten. This requires hard-link support on the media filesystem.

With Delete original enabled, Scopearr rechecks Arr's original path and size, then deletes through `moviefile`/`episodefile`; Arr's configured recycle bin is respected. With the same name, deletion precedes publishing the verified replacement. If deletion fails, the original is preserved as `<original>.scopearr-backup-<jobID>` and the job needs attention. Without deletion, the same-name workflow always preserves a backup. Delete backup requires confirmation. Backups are never removed by job retention or tool removal. With a different output name and deletion off, both files remain; Arr chooses what to import, especially for duplicate episodes.

After publishing, Scopearr issues RescanMovie (`movieId`) or RescanSeries (`seriesId`), waits for completion and queues an internal delta sync even when webhooks are disabled. Existing tag reconciliation follows this sync. Optional notifications go only to media servers using the source Arr instance, through `/Library/Media/Updated`; existing media path mappings translate the source path. Radarr/Sonarr automatic renaming may subsequently change your chosen filename.

## Recovery and limits

Rescan or notification failures keep the output and mark the job as needing attention. Retry rescan repeats these finishing steps. A crash during muxing discards incomplete output. A crash during replacement preserves verified temporary output; restore/publish it locally before retrying the rescan if a partial file remains. Do not remove such a file until you have recovered the media. Keep Appdata database backups when updating; schema 16 cannot be opened by 1.1.x.

Check directory permissions for access errors, mount options for `noexec`, Appdata space for installation failures, and media space for job failures. Jobs require source-size free space plus 1 GiB reserve. If a file changed, synchronize Arr and identify it again. Diagnostic install output is local to `/data/tools/mkvtoolnix/install.log` (bounded); paths and raw process diagnostics are not returned to browsers. A 15-minute no-progress watchdog terminates a stalled mux. Linux readers holding an old inode can finish playing while replacement occurs; their storage is reclaimed when they close it.

There is no transcoding, external-track import, track reordering, scheduled execution or parallel muxing in this release. Successful jobs without backups are removed after seven days by default; set zero to retain them indefinitely.
