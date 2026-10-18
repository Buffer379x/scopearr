# Tag synchronization

Under **Settings → Services**, select outbound groups independently for each named Radarr, Sonarr, Emby or Jellyfin instance. All groups are off by default. Changes remain drafts until Save. When groups are enabled, disabled or the active handling mode changes, a confirmation dialog gathers the decisions separately for each instance. The following sections describe Arr behavior; [media-player tag synchronization](SERVICES.md#outbound-tags) uses matched movie and individual episode targets, without media-player tag import or Arr-style global definition deletion.

## Review before removal

The tag-handling decision popup appears when saving synchronization configuration changes. There is no separate handling dropdown or edit icon.

After choosing removal/overwrite, a fresh read-only preview lists each affected tag, origin, assignment count, paginated title list and whether the definition can be deleted or must remain referenced. Confirming the preview binds consent to the current service, settings, recognition result and remote usage. Changed relevant data requires a refreshed preview. No writes occur while confirmation is pending.

Origins distinguish confirmed creations by Scopearr, definitions already present before its first interaction, and older definitions whose origin was never recorded. The Arr APIs do not identify the creator. Reusing a definition for selected output values brings it under Scopearr's control without falsely claiming it was created by Scopearr.

Previously controlled assignments and adopted/created definitions continue normal automatic updates. Newly encountered foreign assignments or unrelated definition removals pause the tag job for review under **Settings → System**; file synchronization continues. Consent is consumed after a successful job. IDs and labels are both checked, and definitions are protected by fresh usage checks at deletion time. Targeted removal/addition avoids erasing a concurrent foreign addition.

## Existing assignments

**Keep and only add** preserves existing unrelated tags and appends the currently recognized values. Resolution/source changes can therefore accumulate values over time. Scopearr uses the API's add operation, preserving tags added concurrently by another client. Explicit removal of a previously synchronized custom assignment, or disabling a group with Delete, uses targeted remove operations.

**Overwrite assignments** defines the complete desired set for each movie/series. Existing assignments, including manual tags, are removed unless desired by the selected groups, imported as external custom tags, protected by an external auto-tag rule, or explicitly protected by a later Keep decision for a disabled group. A newly confirmed Overwrite decision removes those earlier protections as well. This mode reconciles changing traits on every successful file sync.

Sonarr tags series rather than individual files. Scopearr unions every existing episode-file value: mixed 1080p/x264 and 2160p/x265 episodes produce all four tags. Source includes processing such as Remux. Missing traits produce stable, category-scoped English tags such as `resolution-unknown`, `codec-unknown`, `source-unknown`, `hdr-unknown`, `bit-depth-unknown`, `audio-codec-unknown`, `channels-unknown` and `language-unknown`. They follow the selected outbound groups. Known and missing values can both occur in a series union. An empty custom-tag list produces no unknown tag. Interface language changes do not rename outgoing tags.

Labels use lowercase ASCII letters, digits and hyphens. Punctuation/whitespace become separators; non-ASCII characters have deterministic code-point encodings. Equivalent normalized labels share one definition, reused case-insensitively. Interface language does not change outgoing values.

## Disabling groups

**Keep** freezes existing assignments for the disabled groups; later syncs of other groups do not erase them. No new values are assigned for the kept groups. Fully stopping tag synchronization with Keep cancels outstanding cleanup, leaving all current upstream assignments and definitions unchanged.

**Delete** removes the disabled groups' assignments. A label still required by another selected group remains assigned where needed. A previously synchronized custom tag removed in Scopearr is also removed from its controlled remote assignments. In additive mode, pre-existing custom assignments that Scopearr never controlled are preserved.

After verified assignment updates, Scopearr deletes affected definitions only when no references remain. Current tag-detail endpoints identify references to media, lists, indexers, notifications, profiles, download clients and automatic-tag rules. Missing, malformed or unknown usage details stop deletion. Radarr/Sonarr also reject an in-use tag at DELETE time, covering concurrent new references.

Definitions still used elsewhere remain intact and their count appears in **Settings → System**. Cleanup intent persists and is checked again after a later file sync. Unrelated unused definitions are not swept globally. Shared labels cannot have separate upstream definitions for each originating group.

Keep the service enabled and reachable until Delete finishes. Turning off the connection pauses jobs rather than undoing tags. The app rejects simultaneous group deletion and server-address changes; clean the original service first. Earlier assignments on a different URL are not modified using the new server's IDs.

## Reconciliation and recovery

Jobs wait for a completed file snapshot for the configured URL and share the file-sync gate. Verified editor updates use bounded batches. Group decisions, label history, definition origin/control, assignment ownership, reviewed removal grants and cleanup intent are durable. Failed or ambiguous requests retry without invalidating the last complete file cache; successful operations remain recoverable on restart. Remote systems cannot provide one atomic transaction across all requests.

Successful file syncs, relevant saved settings, recognition rules and custom-tag edits queue reconciliation. System displays activity, errors and retained-definition counts. Other upstream automation can subsequently reapply tags; Scopearr reconciles on the next applicable job.

## API boundaries

Catalog reads stay allowlisted GET requests. Tag synchronization additionally reads `tag`, `tag/detail`, `tag/detail/<id>` and, for external rule references, `autotagging`, creates definitions with POST `tag`, edits assignments with PUT `movie/editor` or `series/editor`, and deletes unused definitions with DELETE `tag/<id>`. Numeric paths must contain a canonical positive ID.

Editor payloads contain only resource IDs, tag IDs, `applyTags: add|remove`, and `moveFiles: false`. Overwrite is implemented using targeted removals and additions; a concurrent foreign addition is preserved. No scan, download, rename, profile or path-change requests are sent. API keys remain server-side; redirects are rejected.

See the official [Radarr tag controller](https://github.com/Radarr/Radarr/blob/develop/src/Radarr.Api.V3/Tags/TagController.cs), [Radarr usage/deletion guard](https://github.com/Radarr/Radarr/blob/develop/src/NzbDrone.Core/Tags/TagService.cs), [Sonarr usage/deletion guard](https://github.com/Sonarr/Sonarr/blob/develop/src/NzbDrone.Core/Tags/TagService.cs), [Radarr movie editor](https://github.com/Radarr/Radarr/blob/develop/src/Radarr.Api.V3/Movies/MovieEditorController.cs) and [Sonarr series editor](https://github.com/Sonarr/Sonarr/blob/develop/src/Sonarr.Api.V3/Series/SeriesEditorController.cs).

## Incoming custom tags and auto-tag rules

Imports are optional per service under **Settings → Services**. Choose manual checks, every 5/15/30 minutes, or with library sync. Enabling imports proposes 5 minutes. Local edits queue an immediate check; every outbound job reads external state first. Sending ordinary custom-tag changes back also requires the outbound **Custom** group. System shows last check, pending changes, conflicts and Check tags now.

Import-only checks read `tag/detail` and, if referenced, `autotagging`. They do not request movie/episode files, Emby metadata or scans. Connect webhooks do not announce ordinary tag edits. Technical labels recognized by Scopearr are excluded from new ordinary custom imports; rule-controlled labels are imported even when technical or unused. The combined catalog retains its existing 128-tag limit; exceeding it rejects the complete import rather than applying a partial snapshot.

Ordinary tags match by their normalized outgoing label. Radarr assignments apply to movie files; Sonarr assignments apply to all series files. Tags assigned to individual Scopearr files keep their granularity when their union is read back from Sonarr. Snapshots and queued edits survive restart. Pulling cannot undo a pending local removal; externally removed ordinary assignments are not immediately recreated. Imported assignments and independent local assignments remain separate layers.

A changed external name or deleted definition during a pending edit pauses writes. **Settings → System** offers Keep local change or Use service state. A fresh read verifies the decision; pending removal requires confirmation. Failed/incomplete responses keep the previous complete imported state and prevent writes. The APIs cannot provide an atomic transaction across services; concurrent edits after the final read are observed on the next check.

Tags referenced by external automatic-tag rules appear in **Settings → Custom tags**, including unused rule tags. A gear opens service and rule names. Canonical upstream names, global deletion and service-controlled assignments stay protected in both UI and backend; local display names and colors remain editable. Custom and Display share color settings, saved explicitly. Creation, local display-name changes and confirmed unused-tag deletion remain immediate. A display name is stored separately from the canonical synchronization name, shown in lists/filters/CSV, and survives external removal or readdition without renaming the Arr definition. Counts show linked Scopearr file entries; any linked tag cannot be deleted, and external rule references keep auto-tag deletion protected even at zero.

A rule reference means a tag is used by a rule, not proof of historical assignment origin. Scopearr does not change external rules or fight their assignments. Remove the rule reference in Radarr/Sonarr to unlock the tag on the next check; existing assignments remain. If the same name is automatic in one service and manual in the other, central name/deletion remain protected while ordinary assignments in the other service stay editable.

Disabling imports stops checks and retains the snapshot; upstream tags are not deleted. Changing the service URL detaches its imported identities and pending edits so old server IDs cannot affect the new server. Local definitions and independent assignments remain.

Official implementations: [Radarr tag details](https://github.com/Radarr/Radarr/blob/v6.4.4.10685/src/Radarr.Api.V3/Tags/TagDetailsController.cs), [Sonarr tag details](https://github.com/Sonarr/Sonarr/blob/v4.0.20.3014/src/Sonarr.Api.V3/Tags/TagDetailsController.cs), [Radarr automatic tagging](https://github.com/Radarr/Radarr/blob/v6.4.4.10685/src/NzbDrone.Core/AutoTagging/AutoTaggingService.cs).

## Rollback

Database rollback does not undo changes already sent upstream. If cleanup is wanted, disable groups with Delete and wait for successful reconciliation before rolling back. Restore the prior image and its matching database snapshot while retaining the encryption key; see [operations](OPERATIONS.md).
