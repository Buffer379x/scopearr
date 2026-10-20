# Scopearr 1.2.0 validation

## Phase 0: signed Appdata installation

Tested the published Scopearr 1.1.1 Alpine 3.23 runtime with UID 99/GID 100, read-only root, all capabilities dropped, no-new-privileges and a noexec/nosuid/nodev 32 MiB `/tmp`. Appdata and synthetic media were explicit read-write mounts. amd64 ran under emulation on an arm64 OrbStack host. The initial amd64 Stable install succeeded at 256 MiB; the remaining matrix and remux tests used 512 MiB with swap disabled.

Verified command (the real apk-tools is 3.0.8):

```
apk add --root <new-root> --initdb --usermode --no-scripts --no-interactive \
  --keys-dir /etc/apk/keys \
  --repository https://dl-cdn.alpinelinux.org/alpine/<branch>/main \
  --repository https://dl-cdn.alpinelinux.org/alpine/<branch>/community \
  --cache-dir /data/tools/mkvtoolnix/cache mkvtoolnix
```

No untrusted-package override, root privileges, scripts, FUSE or base-image change was needed. Each installed tree's musl loader successfully ran `mkvmerge --version`, JSON identification and real remuxing. A separate empty existing root also successfully supports signed `apk search -x mkvtoolnix` update checks before installation.

| Architecture | Channel / package | Tree size (`du -sk`, KiB) | Version self-test |
| --- | --- | ---: | --- |
| amd64 | Stable / 96.0-r0 | 346088 | mkvmerge v96.0 |
| arm64 | Stable / 96.0-r0 | 322428 | mkvmerge v96.0 |
| amd64 | Edge / 103.0-r0 | 59948 | mkvmerge v103.0 |
| arm64 | Edge / 102.0-r1 | 61024 | mkvmerge v102.0 |

Stable unexpectedly includes GUI dependencies, unlike the smaller Edge package dependency graph. The application therefore checks for 800 MiB free Appdata before installing instead of the proposal's insufficient 300 MiB. Package versions are architecture-specific; upstream version information does not imply that an Alpine package is already available.

The large fixture is a valid 2,201,017,515-byte Matroska container built from two synthetic PCM audio tracks. Removing one audio track produced approximately 1,100,564,522 bytes. Identification confirmed two tracks becoming one with identical duration (5,729,166,664,032 ns). All four architecture/channel combinations completed. Native arm64 remuxing took about one second; emulated amd64 about eight seconds. Cgroup `memory.peak` reached 512 MiB due to accounted filesystem cache; there were no OOM kills. A separate `/proc/<pid>/status` sampler measured peak RSS of 55,676 KiB (arm64 Stable), 46,820 KiB (arm64 Edge), 70,688 KiB (emulated amd64 Stable) and 71,408 KiB (emulated amd64 Edge). These synthetic timings do not predict production storage throughput.

## Automated validation

- Full Go test suite, `go vet ./...`, and `go test -race ./...` passed locally in Go 1.27.2 containers. Race tests require temporary GCC/musl build dependencies; the released binary remains CGO-free.
- Staticcheck v0.8.2 (`all,-ST*`) passed.
- Real MKVToolNix integration: 15,852-byte two-track MKV → 10,592-byte one-track MKV using the application's loader/process adapter and duration/track verification.
- Real queue integration verifies original deletion through a mock Arr endpoint, same-name replacement, rescan polling and cache replacement through an internal delta job with incoming webhooks disabled.
- Mux regression tests cover output names, track arguments and defaults, invalid language/names, longest-prefix mappings, escaping symlinks, forbidden roots, size/access/space checks, same/different names, preserved backups, failed Arr deletion, upstream identity mismatch, existing destinations, failed mux, cancellation and restart recovery, schema-15 backup/migration, uniqueness, revisions, CSRF, disabled endpoints and path/log redaction.
- Media notification tests verify translated paths and source-instance filtering; the Arr writer rejects unrelated endpoints and command names.
- Frontend TypeScript, all 48 Node tests, translation parity and the production build passed. The existing language-registry chunk-size advisory remains informational.
- Version consistency check passed for VERSION, package, both Docker arguments and English release notes.
- Full runtime image built successfully. Optional CI smoke installs signed Stable packages and remuxes a bundled 4.8 KiB WAV fixture in the actual runtime image under 512 MiB.

## Scope and differences

The runtime retains the original Alpine base and opt-in behavior. Source paths are persisted in an internal cache column because 1.1.1 did not retain `File.SourcePath` across cache serialization. They remain excluded from API responses. Same-directory hard-link publication prevents an unrelated destination from being overwritten in a rename race; media filesystems must support hard links. During interrupted replacement, verified temporary output is conservatively preserved for local recovery, instead of discarded.

The current Radarr and Sonarr command sources confirm `movieId` and `seriesId` respectively: [Radarr](https://github.com/Radarr/Radarr/blob/develop/src/NzbDrone.Core/MediaFiles/Commands/RescanMovieCommand.cs), [Sonarr](https://github.com/Sonarr/Sonarr/blob/develop/src/NzbDrone.Core/MediaFiles/Commands/RescanSeriesCommand.cs). Options were checked against [mkvmerge documentation](https://mkvtoolnix.download/doc/mkvmerge.html) and exercised with the installed versions.

No production library or real Unraid media was modified. A live Unraid/Radarr/Sonarr/Emby acceptance run requires the operator's deployment and is not represented by the local fixtures. GitHub CI adds dependency/vulnerability scans, the 50k-query gate, image security checks and the existing 100k-file resource check before publication.
