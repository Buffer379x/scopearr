import { useState } from "preact/hooks";
import { api } from "../api";
import {
  readSessionPreference,
  writeSessionPreference,
} from "../browser-storage";
import { SYSTEM_TAB_KEY } from "../event-log";
import type { syncSummary } from "../frame-status";
import { t } from "../i18n";
import { notify } from "../notifications";
import type { Settings, Status } from "../types";
import { useManualSync } from "../hooks/useManualSync";
import { EventLogViewer } from "./EventLogViewer";
import { PasswordCard } from "./PasswordCard";
import type { TableSort } from "../table-sort";
import { SystemInfo } from "./SystemInfo";

// The System tab follows the route; without a tab in it, the tab chosen
// last in this browser tab survives section changes. Choosing writes both.
export function useSystemTab(
  routeTab: string,
  setRouteTab: (tab: string) => void,
): [string, (tab: string) => void] {
  const [systemTab, setSystemTab] = useState(
    () => readSessionPreference(SYSTEM_TAB_KEY) || "info",
  );
  return [
    routeTab === "info" || routeTab === "log" ? routeTab : systemTab,
    (tab: string) => {
      setSystemTab(tab);
      writeSessionPreference(SYSTEM_TAB_KEY, tab);
      setRouteTab(tab);
    },
  ];
}

// Info stays inside the settings form; the log renders outside it. The
// segment of both is on the area's band (SettingsPage).
export function SystemSettingsInfo({
  active,
  status,
  settings,
  summary,
  demo,
  refresh,
  reviewTags,
}: {
  active: boolean;
  status: Status;
  settings: Settings;
  summary: ReturnType<typeof syncSummary>;
  demo: boolean;
  refresh: () => Promise<void>;
  reviewTags: (service: string) => void;
}) {
  const { syncing, sync } = useManualSync(refresh);
  return (
    <div
      id="system-panel-info"
      role="tabpanel"
      aria-labelledby="system-tab-info"
      hidden={!active}
    >
      <SystemInfo
        password={<PasswordCard demo={demo} />}
        status={status}
        settings={settings}
        summary={summary}
        demo={demo}
        syncing={syncing}
        manualSync={sync}
        reviewTags={reviewTags}
        backup={async () => {
          await api("backup", "POST");
          notify(t("Consistent backup created in the Appdata directory."));
        }}
      />
    </div>
  );
}

// The log filters live in the route query of System → Log. A link (new
// revision) starts the viewer again from it; the sort stays while the Log
// tab is open, as in 1.7.0.
export function SystemSettingsLog({
  status,
  demo,
  query,
  setQuery,
  revision,
}: {
  status: Status;
  demo: boolean;
  query: string;
  setQuery: (query: string) => void;
  revision: number;
}) {
  const [sort, setSort] = useState<TableSort>(null);
  return (
    <div
      class="v2-set"
      id="system-panel-log"
      role="tabpanel"
      aria-labelledby="system-tab-log"
    >
      <EventLogViewer
        key={revision}
        status={status}
        demo={demo}
        query={query}
        setQuery={setQuery}
        sort={sort}
        setSort={setSort}
      />
    </div>
  );
}
