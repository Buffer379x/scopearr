# Operations, backups and rollback

## Files and resource limits

`SCOPEARR_DATA_DIR` defaults to `/data`. `scopearr.db` and `secret.key` are created with mode 0600; new directories use 0700. An existing mounted directory must be accessible to the configured UID/GID. Never replace the local key: existing API keys cannot be decrypted without the matching `secret.key`.

The container sets `GOMAXPROCS=2` and a soft Go memory target `GOMEMLIMIT=64MiB`. The runtime also clamps this target to at most one quarter of a detected container memory limit, leaving room for page cache and other process allocations. This protects existing Unraid templates with a higher target without requiring a configuration change. Docker separately limits RAM to 256 MB and requests an equal RAM-plus-swap limit to prohibit additional swap. Host kernel support is required for enforcing the swap limit. Large API responses and metadata can require more memory; monitor the target host before tightening limits.

The `/tmp` tmpfs is limited to 32 MB (`size=32m`). `SQLITE_TMPDIR=/data` allows large SQLite sorts to spill onto local Appdata storage. CSV exports also use protected temporary files there. Keep enough free local disk space; do not use SMB/NFS for SQLite WAL.

`SCOPEARR_LISTEN` defaults to `:8080`, and the container healthcheck reads `127.0.0.1:8080/healthz`. Set `SCOPEARR_HTTPS=true` when browser access uses HTTPS, so cookies require secure transport. Use `SCOPEARR_DEMO=true` only for a separate fresh synthetic dataset.

## Backup

Settings → System → Back up cache uses SQLite `VACUUM INTO` to create a consistent copy under `/data/backups/`. The last three snapshots remain. Required schema migrations create a snapshot automatically.

For a complete backup:

1. Create a cache backup.
2. Stop Scopearr.
3. Back up the entire Appdata directory, including database, `secret.key`, WAL/SHM files and snapshots.
4. Start Scopearr.

A database snapshot alone is insufficient for recovering encrypted keys. Other library/account information is stored locally in SQLite.

## Restore or rollback

Scopearr 1.1 upgrades to schema 15 for named service identities and media-player tag ownership. Preserve a pre-upgrade database snapshot when rolling back to 1.0.x; an older image rejects the new schema. Upgrading a legacy configuration with enabled enrichment queues one read-only full library sync to establish exact movie/episode targets. It does not enable outbound tag groups.

1. Stop Scopearr and separately preserve the complete current Appdata directory.
2. Select the required versioned image, for example `ghcr.io/buffer379x/scopearr:0.1.0`.
3. Restore matching complete Appdata, or restore a consistent database snapshot of the matching schema as `scopearr.db` while retaining its corresponding key. After separately backing them up, remove stale target WAL/SHM files while the app remains stopped.
4. Verify UID/GID and permissions, then start. Check login, connections and cache.

An older application rejects a newer unknown database schema; changing only the image may be insufficient after migrations. Upstream API compatibility still applies. Version 0.3.0 upgrades schema 4 to schema 5, with a pre-migration database snapshot. Rolling back to 0.2.3 requires restoring the matching schema-4 snapshot. Recognition rule edits create a backup and atomically reprocess the cache; custom rules remain in SQLite across updates. Language preferences are stored per browser; server presets and connection settings remain in SQLite.

## Forgotten password

Pass the new password on stdin to `scopearr reset-password`. It must contain 12–72 UTF-8 bytes. Use hidden terminal input, never a command-line argument or a chat message:

```sh
stty -echo
IFS= read -r scopearr_password
stty echo
printf '\n'
printf '%s\n' "$scopearr_password" | scopearr reset-password
unset scopearr_password
```

The account remains and existing sessions are revoked. New credentials are entered by the operator.

## Connections and failures

An empty API-key input keeps the saved key. To remove it, select **Delete saved API key on save** and save; the service is disabled. Optional Emby mappings use one absolute prefix mapping per line: `/movies => /library/movies`. With mappings configured, the full mapped path must also match. Different subfolders or missing mappings prevent enrichment. Paths come from metadata; no media files are accessed. Changed service settings queue new snapshots for enabled Arr services.

Invalid credentials, timeouts, invalid responses, inconsistent identities and database failures preserve the last complete service cache. The UI shows the last successful sync and any current error. A global queue processes service snapshots one at a time. Configuration changes cancel old generations and prevent stale commits. SIGTERM cancels HTTP requests and waits for completion; SQLite commits remain atomic.

Optional MKVToolNix tools under `/data/tools` can be excluded from backups and downloaded again. Preserve the database, `secret.key` and any media-directory `.scopearr-backup-<jobID>` files needed for recovery. See [MUX.md](MUX.md).


## Version 1.3.0 / schema 17 recovery

Before migrating schema 16 → 17, Scopearr creates a consistent SQLite backup in `/data/backups/`. Keep a separate copy of the pre-upgrade backup and the existing `/data/secret.key`; automatic backup retention is limited to three snapshots. The migration adds disk-placement tables and preserves existing mux jobs.

**Rollback to 1.2.6 requires the pre-migration schema-16 backup.** Stop the container, preserve current Appdata separately, restore that snapshot as `/data/scopearr.db`, remove stale WAL/SHM sidecars only while stopped, retain the matching secret key and UID 99/GID 100 permissions, then select image `1.2.6`. Do not start 1.2.6 against schema 17. Completed physical file moves survive a database rollback; verify affected folders manually before creating new plans.

On interruption, retain source, published and partial copies until Scopearr's status explains the result. A differing source/target pair is never automatically reconciled. Logs use relative paths; CSV exports intentionally include `/mnt/user/...` paths and should be treated as library inventory. Keep the 512 MB container limit. State-file waiting is best effort because Unraid updates snapshots asynchronously; check mover/parity state before a maintenance session.

## Version 1.3.1 / schema 18 recovery

Before migrating schema 17 → 18, Scopearr creates a consistent SQLite backup in `/data/backups/`. Keep a separate copy of that backup and the existing `/data/secret.key`. The migration adds the Files & permissions tables and preserves mux jobs and disk placement plans. Rolling back to 1.3.0 requires restoring the schema-17 snapshot; 1.3.0 rejects schema 18.

Interrupted file fixes are marked failed after a restart; an unfinished ownership copy (`.<name>.scopearr-own-<id>.partial` next to the file on its physical disk) is removed and the original stays untouched. Terminal commands generated by Files & permissions are never executed by Scopearr.

