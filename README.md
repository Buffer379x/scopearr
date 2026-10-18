# Scopearr

Explore and filter your Radarr and Sonarr libraries using existing filenames and API metadata. A lightweight, self-hosted web app with a local SQLite cache — no media scans, media mounts or external database server.

> [!TIP]
> **Scopearr highlights**
> - **Your libraries, together:** Radarr movies and Sonarr series, grouped seasons, specials and multi-episode files.
> - **Find exactly what matters:** filename/title search, technical and language filters, include/exclude logic, saved presets and CSV export.
> - **Understand your metadata:** filename-first recognition, editable rules, source evidence, conflicts and season outliers.
> - **Go deeper with Emby & Jellyfin:** optional video enrichment, aligned audio/language/channel tracks and direct media-server links.
> - **See the big picture:** clickable dashboard distributions, metadata-quality summaries and configurable storage widgets.
> - **Keep tags in sync:** custom tags, external tag import and optional outbound synchronization with removal previews and confirmation.
> - **Make it yours:** configurable columns, icons and tag colors; 18 palettes, dark/light modes, mobile layouts and four interface languages.
> - **Stay up to date:** manual or scheduled sync, authenticated webhooks, durable retries and release notices.
> - **Keep it local:** one Go process, embedded UI, SQLite/FTS5 cache, local backups, encrypted API keys, protected sessions and AMD64/ARM64 Docker images. No media scans or mounts.

![Scopearr 1.0.0 movie library](docs/screenshots/library-1.0.0-en.jpg)

<details>
<summary>Current screenshots: dashboard, filters, TV series, audio details, light theme and mobile</summary>

### Dashboard

![Scopearr 1.0.0 dashboard](docs/screenshots/dashboard-1.0.0-en.jpg)

### Filters and metadata quality

![Scopearr 1.0.0 filters](docs/screenshots/filters-1.0.0-en.jpg)

### TV series and season outliers

![Scopearr 1.0.0 TV library](docs/screenshots/series-1.0.0-en.jpg)

### Audio tracks and metadata evidence

![Scopearr 1.0.0 audio details](docs/screenshots/audio-details-1.0.0-en.jpg)

### Light theme

![Scopearr 1.0.0 light theme](docs/screenshots/light-1.0.0-en.jpg)

### Mobile

<img src="docs/screenshots/mobile-1.0.0-en.jpg" alt="Scopearr 1.0.0 mobile TV library" width="390">

</details>

Screenshots show the Scopearr 1.0.0 interface in English, using a separate instance with synthetic demo data. They contain no private library data or service credentials.

## Features

- Separate movie and TV libraries, a default dashboard, responsive layouts, dark and light modes with 18 saved interface palettes, including Default, Nordic and Catppuccin.
- English, German, Spanish and Italian interfaces, with a browser-specific language preference and straightforward [translation contributions](docs/TRANSLATING.md).
- Filename-first resolution, codec/encoder and source detection, supplemented by existing API metadata. Inspect provenance and conflicting values in each file’s details.
- Combined resolution, codec family, source, processing, year, size, HDR, bit depth, audio codec, channels and audio language filters. Search titles and filenames; select unknown and incomplete metadata.
- Include/exclude filters and “contains all” / “does not contain all” for audio, HDR and language. Saved presets and CSV use the same filter logic.
- Indexed [technical and language season-outlier filters](docs/MEDIA-SERVERS.md) with strict majorities, explanations, highlights and CSV flags.
- Grouped TV seasons, specials and multi-episode files. Show only matching files or complete matching seasons with highlighted matches.
- Dashboard counts and distributions by resolution, codec, source, audio codecs and language. Click a tag to select its value in the existing library filters. Selections remain unsaved unless you explicitly save a preset.
- Optional [Emby and Jellyfin enrichment](docs/MEDIA-SERVERS.md) reads existing video and audio stream metadata, with independently enabled connections and explicit conflicts. Verified video resolution, codec and bit depth fill gaps after filename/Arr values. Local SVG language flags have translated tooltips and remain associated with each track’s codec. Multiple audio codecs and HDR profiles use separate tags.
- Persistent configurable columns and an Info action column with new-tab Radarr/Sonarr and matched Emby/Jellyfin links, file details and warning icons. Saved icon visibility/order, column order, tag backgrounds and black/white/automatic text colors. Temporary “All columns” view; clickable movie headers and Info icon-count sorting in both libraries.
- Indexed SQLite queries and FTS5 search, atomic sync snapshots, cached dashboard aggregates and a global sync queue.
- Optional clock-anchored synchronization and [authenticated realtime webhooks](docs/WEBHOOKS.md) for affected media, with durable retries and atomic scoped updates.
- [Selected/shared storage widgets](docs/WIDGETS.md) with individual-area Used/Free charts and no summed overlapping shares; automatic release notices in System.
- One local admin account, encrypted API keys, HttpOnly sessions, CSRF protection and limited login attempts.
- A single Go process and embedded Preact frontend; AMD64 and ARM64 Docker images.
- Optional [tag synchronization](docs/TAG-SYNC.md) for Radarr movies and Sonarr series, configurable per trait group and disabled by default. Choose whether to preserve and append to existing assignments, or replace them; choose Keep/Delete when disabling groups. A read-only removal preview shows provenance, affected titles and definition cleanup before confirmation; newly encountered foreign assignments pause for review.

## Install

See [Unraid installation](docs/UNRAID.md). For other Docker hosts:

```sh
cp .env.example .env
# Set SCOPEARR_APPDATA, SCOPEARR_PORT and UID/GID in .env.
mkdir -p /local/pool/appdata/scopearr
sudo chown 99:100 /local/pool/appdata/scopearr
sudo chmod 700 /local/pool/appdata/scopearr
docker compose pull
docker compose up -d
```

Adapt the local path and UID/GID to your host. The public image is `ghcr.io/buffer379x/scopearr:stable`. Open port 8080, obtain the one-time setup code with `docker exec scopearr cat /data/setup-token`, and enter it with your new credentials directly in the web interface. Under Settings → Services, enter the service URLs and API keys, test, enable and save. The initial sync starts automatically.

Connect exactly one instance per service. URL subpaths are supported, for example `http://radarr:7878/radarr`; do not append `/api/v3` or put credentials/query parameters in the URL. TLS certificates are verified and redirects are rejected. Sync intervals: manual only, 15, 30, 60 (default), 360 or 1440 minutes. Enabled media servers follow the corresponding Radarr/Sonarr sync.

## Filters and metadata

Different fields use AND; multiple values of one ordinary field use OR. For example, choose `1080p`, `x265`, and Source **is not** `BluRay` and `WEB-DL`. None of the excluded sources may occur. Unknown values remain included unless explicitly excluded.

Audio, HDR and language also support **contains all** and **does not contain all**. With HDR10 and Dolby Vision selected, “does not contain all” finds files missing at least one **reported attribute**; it does not prove physical absence in a file. Generic HDR does not imply HDR10, and Dolby Vision alone does not imply an HDR10 fallback. `4K` maps to `2160p`; `x264` remains distinct from `AVC` while both share the `H.264/AVC` family.

Movie titles and years come from Radarr. Episode titles, seasons and first-air years come from Sonarr. One file containing multiple episodes appears once. A dashboard movie count refers to distinct movies, so it may differ from the movie file count. Source and Processing are separate sortable columns; both can be reordered or hidden under Settings → Display. The shared page size is configurable under Settings → Display (1–1000, default 100); CSV exports every actual match, excluding extra season context.

Emby and Jellyfin use exact basename plus identical positive byte size and require a unique match on both sides. Optional path mappings add a full-path check. Matching respects MediaSources for multiple versions. External audio and subtitle streams are excluded. Missing or ambiguous identity is shown rather than guessed. Without a media server, multiple filename tokens can be recognized, but a reliable language-to-codec mapping is unavailable. The Channels column aligns each verified track’s layout or reported channel count with its Audio row, retaining duplicates; without verified tracks it falls back to filename/Arr values; file details show each verified track’s own channels and each provider’s video dimensions. The matching widget groups files into Matched, Not found, Needs review and Not checked. A successful file match does not imply complete metadata.

Flags are representative language symbols, not claims about a file’s country or dialect. English uses the UK flag; an unrecognized language uses a neutral icon and its original label. Text-based filters retain original stored values across interface languages.

## Storage and security

Mount only `/data` on a local SSD/pool filesystem; SQLite WAL must not be placed on SMB/NFS. Back up the entire Appdata directory including `secret.key`. Database backups alone cannot restore encrypted keys without the matching local key. The last three consistent database snapshots are retained; migrations create a backup first. See [operations and rollback](docs/OPERATIONS.md).

Scopearr reads allowlisted API-v3 endpoints using GET: `system/status`, `movie`, `moviefile`, `series`, `episode`, `episodefile` and, when tag synchronization is enabled, `tag` and tag usage details. Optional incoming checks also read `autotagging` for referenced rules. Optional outbound synchronization can create/delete affected tag definitions and add/remove movie/series tag assignments through the editor endpoints; see [tag synchronization](docs/TAG-SYNC.md). Emby and Jellyfin read `System/Info` and paginated `Items` using `X-Emby-Token`. No scan, playback, probe, download or rename requests are made. Independent tasks performed by those services remain outside Scopearr’s control.

Designed for LAN/VPN use. If using an HTTPS reverse proxy, set `SCOPEARR_HTTPS=true` for Secure session cookies. Arbitrary forwarded headers are not trusted; login limiting behind a proxy applies to the proxy address. A failed or inconsistent sync keeps the previous complete cache. Upstream requests cannot provide a single transactional snapshot across a changing remote library.

## Filename recognition

Manage rules in **Settings → Tag rules**. Preview a draft before saving. Direct rules, missing-value fallbacks and explicit overrides run by priority; contradictory recognition and metadata disagreements have separate warning icons and colors. Saving reprocesses the existing cache atomically without scans or upstream requests. See [recognition guide](docs/RECOGNITION.md).

The **Audio** column combines verified media-server language/codec pairs. Without track attribution, languages and codecs remain separate. Language flags and a full ISO 639-1/2/3 code registry are bundled locally; [language metadata](docs/LANGUAGES.md) uses readable names and known flag mappings, with neutral icons for unmapped languages. Language and audio-codec filters keep their original semantics. Dashboard language distribution counts each movie and episode once per language and supports clickable temporary filters.

## Development

Use the Go version in `go.mod`, Node 24 and pnpm 11.25.0:

```sh
pnpm --dir web install --frozen-lockfile
node scripts/check-version.mjs
pnpm --dir web test
pnpm --dir web build
pnpm --dir web audit --audit-level=moderate
go test -race ./...
go vet ./...
go build -o work/scopearr ./cmd/scopearr
SCOPEARR_DATA_DIR=./work/appdata ./work/scopearr
```

Build `web/dist` before compiling Go. For a separate synthetic demo, set `SCOPEARR_DEMO=true` and a fresh `SCOPEARR_DATA_DIR=./work/demo`. Demo credentials: `demo` / `Scopearr-demo-2026`. Existing real accounts are rejected; upstream connections are locked. Never enable demo mode for a production installation.

`VERSION` is the project version. Local Go builds embed it; package and Docker defaults must agree. Changes after a published release require a higher version, an English changelog entry and `docs/releases/<version>.md`. See [release workflow](docs/RELEASING.md) and [validation](docs/VALIDATION.md).

Pull requests and `main` changes run tests and container checks. Only the manually approved release workflow promotes `stable`. Unraid updates are user-triggered; Scopearr does not access a Docker socket or run an updater.

## Contributing

[Add or improve translations](docs/TRANSLATING.md), report an issue, or open a pull request. Write public issue/PR descriptions, release notes and documentation in English. Keep credentials, Appdata and private library data out of contributions. [Architecture and API](docs/ARCHITECTURE.md).

The generated Scopearr PNG icon, favicons and Apple touch icon are included under `web/public`. UI icons are Lucide (ISC); dependencies retain their own licenses. Project license: [MIT](LICENSE). [Changelog](CHANGELOG.md).

## Custom tags

Optional incoming checks add ordinary Radarr/Sonarr tags and protected automatic-rule tags to the catalog. Rule tags show a gear and rule information; their colors remain editable. Checks can run separately from file sync. Ordinary edits can be sent back through the outbound Custom group. See [tag synchronization](docs/TAG-SYNC.md).

Create tags with Add, set a local display name with Enter or by leaving the field, and confirm deletion under Settings → Custom tags. These actions save immediately. In Movies or TV series, a tag icon in each Custom cell edits that single file; empty cells show no placeholder dash. Use Set tags beside CSV to assign or remove tags for every actual filtered file, including other pages. A partial checkbox means only some matching files have that tag. Apply commits changes together; additional full-season context rows are excluded. Tags are displayed alphabetically and are included in CSV exports.

Custom filters support OR, exclusion, contains-all and does-not-contain-all. Filters list values in use. Color administration retains recognized values and overrides after rule removal, until you explicitly delete an unused entry. Count columns show linked file entries across both libraries; linked custom and presentation tags cannot be deleted. External auto-rule references continue to protect definition deletion at zero file count. Filename rules can select Custom and an existing tag. All matching Custom rules add their tags; multiple tags are not conflicts. Manual additions survive synchronization and rule edits. Removed automatic tags may reappear after the next successful service sync.

## Upgrading existing installations

Keep the existing appdata mount and `secret.key`. Database upgrades create a consistent backup and preserve accounts, encrypted API keys, presets, recognition rules and cached media. Use `ghcr.io/buffer379x/scopearr:stable` and `deploy/scopearr.xml`; see [operations](docs/OPERATIONS.md).

Current documentation screenshots use isolated synthetic demo data with `SCOPEARR_DEMO=true`. The optional `SCOPEARR_DEMO_DISCS=true` fixture used for older screenshots presents BluRay, DVD and UHD sources consistent with displayed resolutions. Neither fixture changes production recognition defaults.

## Settings and dashboard

Settings Save actions sit beside the section heading. Language, colors and display preferences remain drafts until saved; leaving a section warns about unsaved edits. Rule additions/deletions save after their individual confirmation; checkbox edits are batched until Save settings. Tests, backups and manual synchronization are separate explicit actions. Find manual synchronization and media-server matching under Settings → System.

Settings → Widgets lets you enable and reorder the six graphical widgets (resolution, codec, source, audio, language and storage). Reset restores their default order and visibility without changing storage selections or colors. Summary counters and metadata-quality cards remain fixed. Dashboard distribution widgets show the top five entries. More/Less expands or collapses the remaining values without changing totals or percentages. Clicking an entry selects the existing library filters without saving a preset. Feedback appears as automatically dismissed bottom-right toasts. Opening Movies or TV series collapses the filters while retaining search and selected criteria.

Settings → Display → Additional settings groups known resolutions below 720p as **SD** in the dashboard by default. Optional list/filter grouping depends on that setting. Configure SD under resolution tag colors; saved colors are retained while grouping is disabled. Filter menus sort their displayed labels alphabetically, with Unknown last. Original details, exact presets and synchronized values remain intact. Fixed recognition-rule results also retain their configured display spelling (for example, `VP9`) without changing canonical filter keys.
