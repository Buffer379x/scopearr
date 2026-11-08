import { useState } from "preact/hooks";
import { api } from "../api";
import { t } from "../i18n";
import { notify } from "../notifications";
import type { ConnectionService } from "../ui";

// The manual sync of one instance, as System → Info and the frame's sync
// popover start it: the request, a status refresh and the notice. The
// instance stays locked (syncing) until the request has finished; a failed
// request shows its error through api and refreshes nothing.
export function useManualSync(refresh: () => Promise<void>): {
  syncing: Record<string, boolean>;
  sync(service: ConnectionService): Promise<void>;
} {
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const sync = async (service: ConnectionService) => {
    setSyncing((current) => ({ ...current, [service]: true }));
    try {
      await api("sync", "POST", { service });
      await refresh();
      notify(
        t("Sync queued. Services run one at a time; you can keep filtering."),
      );
    } catch {
    } finally {
      setSyncing((current) => ({ ...current, [service]: false }));
    }
  };
  return { syncing, sync };
}
