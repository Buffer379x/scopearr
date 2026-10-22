# Files & permissions

Tools → **Files & permissions** lists items in Radarr movie and Sonarr series folders that Scopearr cannot edit, that belong to another owner, or that do not belong next to the media. It is available when the MKVToolNix service is enabled with path mappings, the same prerequisite as renaming; installing mkvmerge is not required.

## Scan

Choose libraries and checks in the scan panel and click **Scan**. Folder paths come from Radarr/Sonarr. The scan lists directories and reads `lstat` metadata only; it never opens files and never follows symlinks. Disks may still spin up if their directory data is not cached; the Unraid plugin *Dynamix Cache Directories* avoids that. Scans run only on demand and not while fixes are queued.

| Check | Reported when |
| --- | --- |
| Permissions | Scopearr (UID 99) cannot read and write a file, or read, write and enter a folder. With *Report any deviation*, every mode other than the target is reported. |
| Owner | UID or GID differ from the configured owner (default `99:100`, `nobody:users`). |
| Hidden | The name starts with a dot, except allowed names such as `.actors/`. Scopearr's own `.scopearr-*` leftovers are marked. |
| Junk | `.DS_Store`, `._*`, `Thumbs.db`, `desktop.ini`, `@eaDir/`, `.AppleDouble/`, `.@__thumb/`, `__MACOSX/`. |
| Orphaned | A subtitle, `.nfo`/`.xml`, image, `.bif` or `*.trickplay/` whose name does not start with the name of a managed video in the same folder (followed by the end, `.`, `-`, `_` or a space). |
| Untracked video | A video file that Radarr/Sonarr does not manage, including samples. |
| Other file | Anything else, for example `.txt`, `.url`, `.nzb`, `.par2`; symlinks and special files. |
| Empty folder | A subfolder without content (never the item folder itself). |

Never reported: extras folders (`Extras`, `Featurettes`, `Behind The Scenes`, `Deleted Scenes`, `Interviews`, `Scenes`, `Shorts`, `Trailers`, `Other`), extras suffixes (`-trailer`, `-featurette`, `-behindthescenes`, `-deleted`, `-interview`, `-scene`, `-short`, `-other`) and the **allowed names** (folder artwork and metadata such as `poster.*`, `fanart.*`, `tvshow.nfo`, `season01-poster.jpg`, `extrafanart/`). Edit the allowed and **ignored** lists with one pattern per line; `*` and `?` work as wildcards, and a trailing `/` matches folders only.

Target permissions default to the Unraid standard `0666` for files and `0777` for folders; *Group only* uses `0664`/`0775`, or enter custom octal modes.

## Fixes

Each finding has one fix:

- **chmod**: sets the target mode. Possible only for items Scopearr owns.
- **Delete**: removes the file or folder (junk and hidden folders recursively, never following symlinks). Needs write access to the parent folder.
- **Take ownership**: available with the Unraid service and the read-write `/unraid` mount. Scopearr copies the file to a hidden `.partial` next to it on the same physical disk, verifies size (and SHA-256 when *Verify copies with checksums* is enabled in Disk placement), keeps the timestamps and atomically replaces the original. The copy belongs to 99:100 with the target mode. Video files are included only with *Include video files*.
- **Manual**: everything the non-root container cannot do, for example foreign-owned folders. Use **Terminal commands** for the selected rows: Scopearr writes `chown`, `chmod`, `rm` and `rmdir` lines with quoted host paths (`/mnt/user/…` with the Unraid service, container paths otherwise). Review them and run them in the Unraid terminal yourself; Scopearr never runs them. For whole shares, use Unraid Tools → *Docker Safe New Permissions*.

Fix one row, the selected rows or **Fix all** open findings matching the current kind and search. **Fix all** never includes untracked videos. Deletions require a confirmation and cannot be undone. Fixes run one after another and never at the same time as mux jobs or disk placement moves. Before each fix Scopearr reads the item again; a changed type, mode, owner, size or modification time, a path outside the item folder, a file Radarr/Sonarr manages again, or a Scopearr temporary file of a running job stops the fix with **Review**. A permission error turns the row into **Manual**. After a restart, an interrupted ownership copy is removed and the row can be fixed again.

Sorting the table changes the display only; fixes run in the order title, path, kind.
