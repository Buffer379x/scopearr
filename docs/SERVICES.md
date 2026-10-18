# Named service instances

Scopearr 1.1 supports multiple Radarr, Sonarr, Emby and Jellyfin instances. Open **Settings → Services**. The synchronization timezone stays above the instance tabs. **Add service** creates a Radarr, Sonarr or media-player connection; select Emby or Jellyfin for a media player. An optional display name distinguishes connections such as `Movies HD` and `Movies 4K`.

Save connection changes explicitly. A blank API-key input retains that instance's saved key. Renaming or changing the order of instances never moves credentials. Deactivated connections remain available through the service-management dialog and can be enabled again.

## Identity and library views

Every connection has an immutable instance ID. Remote numeric IDs are meaningful only within that instance. Movie and TV views combine their corresponding instances, with an instance filter to narrow the results. Two instances managing the same title retain their separate files. Counters count managed entries per instance, rather than guessing that equal names identify the same edition. Seasons, outlier detection, manual tags, presets, links, schedules, storage and webhook queues retain the instance identity.

The original four connection IDs remain compatible with existing webhook URLs and cached records. Existing API keys, presets, recognition rules, colors and tag ownership are retained during migration. Version 1.1 upgrades the database to schema 15 with a consistent backup first. Keep the matching `secret.key` with Appdata. Rolling back to 1.0.x requires the matching pre-upgrade database backup; the older app refuses schema 15.

When upgrading a legacy configuration with an enabled media player, Scopearr queues one read-only library synchronization to establish verified movie/episode write targets. Outbound tag groups remain disabled unless you explicitly enable them. Existing series navigation links are not reused as episode write IDs.

## Media-player sources

Choose the Arr instances contributing metadata and tags to each media player. An empty source selection means all enabled Arr instances. Existing enrichment still requires an unambiguous matching file with the same positive byte size; optional path mappings add a full-path requirement. Ambiguous files are not used as write targets.

One media-player item may contain multiple file versions. Desired tags are combined from all matching selected sources before the item is updated. For example, a movie containing both HD and 4K versions can receive both `1080p` and `2160p`. Removing one source's contribution does not remove a tag still required by another source.

## Outbound tags

Media-player tag synchronization is optional and off by default. It is **Scopearr → Emby/Jellyfin only**; media-player tags are not imported as Scopearr custom tags. Select the desired trait groups independently for each connection. Movie tags target matched movie items. TV tags target matched **episodes**, preserving their individual technical properties; Scopearr does not write those tags to series or seasons.

The existing preserve/replace and keep/delete choices apply to assignments. Destructive changes require a fresh preview and confirmation. Names and assignment ownership are tracked per target instance and item. Media players do not expose the same global tag-definition cleanup model as Radarr/Sonarr. Scopearr tag colors remain local interface settings.

Emby has dedicated item tag Add/Delete operations. Jellyfin uses a broader item-metadata update: Scopearr reads current metadata, preserves unrelated editable fields and verifies the result. An unsupported or incomplete item response is a synchronization error, not permission to submit an incomplete metadata document. Tag writes do not call scan, refresh, playback or file-operation endpoints. External NFO importers and plugins can independently change tags later.

The global heavy-sync queue remains bounded to one snapshot or tag-reconciliation task at a time. Increasing the number of connections therefore increases total synchronization time rather than allowing every library to allocate a full snapshot concurrently.

Tag previews read item metadata in bounded batches. Automatic reconciliation processes resumable sections, yielding between sections so a large tag update does not monopolize the library queue. Each changed item is read again immediately before writing and checked afterward. Interrupted work remains pending and continues automatically; an incomplete reconciliation is not reported as complete.

API references: [Emby Add tags](https://dev.emby.media/reference/RestAPI/TagService/postItemsByIdTagsAdd.html), [Emby Remove tags](https://dev.emby.media/reference/RestAPI/TagService/postItemsByIdTagsDelete.html), [Jellyfin item updates](https://github.com/jellyfin/jellyfin/blob/v10.11.0/Jellyfin.Api/Controllers/ItemUpdateController.cs).
