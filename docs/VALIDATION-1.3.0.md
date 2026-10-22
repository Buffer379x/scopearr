# Validation for 1.3.0

## Automated checks

- Web: TypeScript and production build; 73 Node tests including catalog parity, dynamic translations, queue order, eligibility, columns and summary completion.
- Go: full package race run, vet and Staticcheck; focused placement, migration, auth/CSRF and physical mux integration tests.
- Metadata scan: synthetic 20,000 items / 150,000 files / eight disks, 5% split. Sampled Go heap peak 43.41 MiB with GOMEMLIMIT=64MiB; 19,000 OK items discarded and 1,000 split items retained. Excessive per-item plans fail at the 500,000-entry cap.
- Safety: source changes before/during copy, pre-existing destinations, checksum mismatch, mid-second-file cancellation, falling free space, partial cleanup, identical/divergent restart recovery, queue ordering/idempotence, mover wait and both directions of the mux/placement lock.
- Mux: same/new name with and without a work directory, forced EXDEV staging, pool original, no-match fallback, multiple matches, changed device before replacement, physical capacity checks and private-path redaction.
- Schema: schema-16 backup retains version 16; migration reaches 17 and preserves mux jobs; version 18 rejected.
- Version metadata and seven Python release-policy tests pass.

## Real Unraid prerequisite spike

Performed on Unraid 7.3.3, kernel 6.18.54-Unraid, Docker 29.8.2. Ten XFS array disks and four XFS pools were discovered with distinct device IDs. Btrfs/ZFS were unavailable on this host and remain untested filesystem variants.

An isolated UID 99/GID 100 container used recursively read-only `/mnt` plus only newly created writable test folders on disk3, disk6 and cache_nvme. A small disk3→disk6 copy, fsync, hardlink publication, source unlink, empty-folder cleanup and merged-share visibility passed. All temporary files and containers were removed.

Unbounded buffered 5,000-MiB writes OOMed at both 128 and 512 MiB. Synchronizing at most every 16 MiB succeeded under 512 MiB: disk6 120 s (~43.7 MB/s), cache_nvme 43 s (~121.9 MB/s). The production Go copier uses a 1-MiB buffer and this synchronization interval. These are test-host measurements, not throughput guarantees.

Metadata find/stat tests left all ten disks and parity asleep with Cache Directories running and stopped. This was a warm-cache observation and does not establish cold-cache spin-up behavior. The original plugin state and disk state were restored.

Actual mover start/stop confirmed `shareMoverActive=yes/no`. A non-correcting parity check confirmed positive `mdResync` and `mdResyncPos`; the idle snapshot can retain `mdResyncAction=check P`. The operation was cancelled with zero errors. State snapshots lag transitions, so waiting is best effort. The server was restored to idle and temporary scripts/logs were removed. Local evidence is retained in ignored `work/spike-130/`.

## Browser checks

A local UID 99/GID 100 container with distinct disk/pool mounts exercised service setup, 5/5 share/disk path sampling, scan, automatic summary, target filter, selection and sequential small-file moves. Dark/light desktop and 375-pixel layouts were inspected; the mobile page remains 375 pixels wide and checkbox/text rows retain at least 24 pixels of height. Evidence is in ignored `work/ui130/`.

## Remaining environment-specific acceptance

Moving existing personal library items, playback in the actual Radarr/Emby installation, and real mkvmerge jobs against each live disk/cache layout require access to the candidate application with the physical media mounts. The isolated spike and synthetic integration tests do not establish these playback checks. Validate three small-file items and one media-file item, cancel/restart, and the four live mux scenarios before considering live-library acceptance complete.
