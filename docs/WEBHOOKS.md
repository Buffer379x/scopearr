# Radarr and Sonarr realtime webhooks

Webhooks are optional and disabled by default. Full scheduled sync remains available and should remain enabled to recover missed events.

## Configure each service

1. In Scopearr → Settings → Services, select the named Radarr/Sonarr instance tab, enable Webhook and save.
2. Click Show webhook connection. A dedicated random secret is encrypted in Appdata. It is separate from your Arr API key and local login. It is shown only through an authenticated, CSRF-protected action.
3. In the corresponding Arr service → Settings → Connect → Webhook, use Method POST and the displayed URL, Username and Password (Basic authentication). Replace the browser hostname with an address reachable from the Arr container if necessary. URL subpaths on the Arr service remain supported.
4. Enable On Import, On Upgrade and On File Delete. Optional rename and media-deletion events are also supported. Test and Save. A Test request does not modify the cache.

Example legacy endpoint: `http://scopearr:8080/api/webhooks/arr?service=radarr`. New instances use their immutable ID in the displayed connection URL, for example `service=radarr-…`. Each instance has separate credentials and queue identity; renaming it does not change that URL. Existing webhook URLs continue to work after migration. Never put a key in the URL. Advanced custom-header authentication is also supported using `X-Scopearr-Webhook-Key` with the dedicated secret. Use HTTPS whenever the connection traverses an untrusted network.

## Processing and limits

Import/upgrade payloads use `eventType: Download` in the official implementations. Radarr refreshes the affected movie and its file data. In Keep and only add mode, the ensuing tag reconciliation also removes outdated technical tags managed by Scopearr once the new file is cached; unrelated and protected assignments remain preserved. Sonarr reads the affected series, changed episode-file IDs and their episode mappings; an ordinary import/delete does not fetch all series episodes. Parent deletion is verified via API before cached removal. Rename events refresh the affected movie/series because multiple files may change.

A persistent queue coalesces events for two seconds, with at most 256 pending media entries and 512 changed file IDs per media entry. Queue saturation returns HTTP 503 for a retry. A worker shares the global sync gate, validates API responses and commits a scoped SQLite transaction. A failed/invalid read keeps the previous cache, retries with bounded exponential backoff (up to 30 minutes), and surfaces its status in System. Pending jobs survive restart. Disabling the webhook stops acceptance/processing; changed service endpoints invalidate old jobs. New events arriving during processing remain queued.

The browser polls cache revisions while webhooks are enabled and refreshes list/facet/dashboard queries without clearing your filters. Unchanged file identities preserve existing Emby tracks. Imported/replaced files show Awaiting Emby enrichment until the next full sync, avoiding a whole Emby catalog query for each event. Optional outbound tags reconcile the affected movie/series and retain the existing removal-approval protections.

The webhook route accepts POST only, requires its per-service secret before reading the payload, caps bodies at 256 KiB and never invokes scan commands. Other HTTP API mutations retain session/CSRF checks. No keys or webhook bodies are logged. Disable the option to stop webhook requests; Appdata and its encryption key must be protected and backed up.

Primary implementations: [Radarr webhook payloads](https://github.com/Radarr/Radarr/blob/develop/src/NzbDrone.Core/Notifications/Webhook/WebhookBase.cs), [Sonarr webhook payloads](https://github.com/Sonarr/Sonarr/blob/v4.0.20.3014/src/NzbDrone.Core/Notifications/Webhook/WebhookBase.cs).
