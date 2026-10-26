# MediaInfo file inspection

MediaInfo is an optional local service in Scopearr 1.6.0. It reads a file only when you choose **Read with MediaInfo** or **Read again** in the **File & metadata** action row, after the mux actions. The button is shown only while MediaInfo is enabled and installed. Library synchronization, webhooks and mux jobs do not start MediaInfo reads automatically. The read does not change the media file or request a service rescan.

## Setup

1. Add **MediaInfo** under **Settings → Services → Add service**, enable it and save.
2. Mount the media folder outside Appdata and configure **Path mappings** in the MediaInfo service tab. The left side is the path reported by Radarr/Sonarr; the right side is the path inside Scopearr, for example `/movies => /media/movies`. MediaInfo, MKVToolNix and file renaming share this one mapping list. Saving a change in either service tab changes the same settings.
3. Choose **Stable** or **Current (edge)** and install the tool. The package card shows installed, available and upstream versions, size, and install/update/check/remove actions.
4. Open a cached movie or episode and choose **Read with MediaInfo** in the action row, from either Overview or MediaInfo. Its mapped path must be reachable, regular and the same byte size as the Arr file. Paths and resolved symlinks must stay within the mapped media root; system directories and Appdata are rejected.

A read-only media mount is sufficient for MediaInfo. MKVToolNix and renaming also need directory write access. Keep Appdata executable for the installed tool, retain the supported **512 MiB memory limit without additional swap**, and allow at least **150 MB free Appdata space** for MediaInfo installation or update. Actual package size depends on channel and architecture.

## Installation and updates

The shared tool installer downloads signed Alpine packages into `/data/tools/mediainfo/root-<timestamp>`, using the image's trusted signing keys without root permissions, package scripts or an untrusted-package override. It runs the downloaded binary through that tree's musl loader. A successful version self-test activates the `current` symlink; a failed update retains the previously active tree. The bounded installation log is `/data/tools/mediainfo/install.log`.

Stable follows the image's Alpine release; Current uses Alpine edge. **Check** reads package availability; upstream release information is informational and does not select the package version. Install, update, check and removal are blocked while a file is being read. Removing the tool does not require deleting saved file results. MKVToolNix uses the same installer implementation with its own package tree and service settings.

## Reading a file

Scopearr runs `mediainfo --Output=JSON --Full` on one explicitly selected file. Only one read can run at a time. A read has a 120-second timeout and a 4 MiB output limit; cancellation or timeout terminates its process group. Failed or oversized output does not replace a saved result. Demo mode does not permit reads or tool installation.

A sleeping disk or slow network mount can take time to respond. The action button shows the read in progress. Success selects **MediaInfo → Result** and shows a saved-values toast. A failure leaves the current tab selected and shows a toast plus a notice in MediaInfo; it also appears in the event log. Check the mapping, file size, mount access or installed version before retrying.

## Results and comparison

The 1060px File & metadata dialog has Overview and MediaInfo tabs. MediaInfo shows the read date and tool version beside a second tab bar (below it on phones): **Result | General | Video | Audio | Subtitles**. Only sections with data appear; Result is the initial selection. Single tracks use an Attribute | Value table. Multiple tracks appear side by side, with attributes as rows and language, default and forced hints in the column headings. The first column stays visible while wide track comparisons scroll horizontally. The selected section is remembered for the session; a new read without that section returns to Result. Scopearr stores a compact result of at most 64 KiB rather than the raw JSON. Track details remain local and do not expose absolute media paths in the result.

The Overview evidence table adds a MediaInfo column when a saved result exists. Known filename values retain priority. When the filename omits a measured value, the order is **MediaInfo → media server → Radarr/Sonarr**. MediaInfo audio tracks replace media-server tracks for audio, language and channel presentation. Source and processing retain their filename/Arr rules because MediaInfo does not establish an import source.

A metadata disagreement compares a known filename value with MediaInfo when available, otherwise with the media server. If MediaInfo agrees with the filename, a differing media-server value becomes muted information rather than a metadata warning. Recognition-rule conflicts remain separate. Unrecognized formats stay empty; multiple video tracks without a unique default are treated as ambiguous.

In the **Used** column, choose an available evidence source to confirm its current value for that field. A confirmation suppresses disagreements and rule conflicts for that field only; choose **Automatic** to restore normal resolution. See [filename recognition](RECOGNITION.md).

The library's **MediaInfo read** state filter selects files with a current saved result. Use **is not** for files without one. It appears when MediaInfo is enabled or that filter is active, including presets loaded after disabling the service. Both it and **Manually confirmed** include explanatory help and retain their yes/no choice in saved presets.

## Result lifetime and rollback

Results belong to a service instance and Arr file ID, source path and byte size. They remain available through ordinary syncs and rule reprocessing while those facts match. A missing file, changed source path or changed size invalidates the saved result during synchronization. A rename through Scopearr updates its saved path. If Arr replaces the file with a new ID, read the new file again.

Saved results and manual confirmations use additive tables with no database schema-version increase. Scopearr 1.5.1 can open the same database and ignores these tables; those features are unavailable there. Keep the complete Appdata directory, including `secret.key`, when updating or rolling back. See [the 1.6.0 release notes](releases/1.6.0.md) and [validation report](VALIDATION-1.6.0.md).
