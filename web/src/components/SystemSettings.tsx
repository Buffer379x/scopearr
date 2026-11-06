import { useState } from "preact/hooks";
import { api } from "../api";
import {
  readSessionPreference,
  writeSessionPreference,
} from "../browser-storage";
import { logRequested, SYSTEM_TAB_KEY } from "../event-log";
import { t } from "../i18n";
import { notify } from "../notifications";
import type { Settings, Status } from "../types";
import { SegmentedTabs, type ConnectionService } from "../ui";
import { EventLogViewer } from "./EventLogViewer";
import { PasswordCard } from "./PasswordCard";
import { SystemInfo } from "./SystemInfo";

// The System tab survives section changes per browser tab; a log deep link wins.
export function useSystemTab(): [string, (tab: string) => void] {
  const [systemTab, setSystemTab] = useState(
    () =>
      (logRequested() ? "log" : readSessionPreference(SYSTEM_TAB_KEY)) ||
      "info",
  );
  return [
    systemTab,
    (tab: string) => {
      setSystemTab(tab);
      writeSessionPreference(SYSTEM_TAB_KEY, tab);
    },
  ];
}

// Info stays inside the settings form; the log renders outside it.
export function SystemSettingsInfo({
  active,
  tab,
  setTab,
  status,
  settings,
  demo,
  refresh,
  reviewTags,
}: {
  active: boolean;
  tab: string;
  setTab: (tab: string) => void;
  status: Status;
  settings: Settings;
  demo: boolean;
  refresh: () => Promise<void>;
  reviewTags: (service: string) => void;
}) {
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const manualSync = async (service: ConnectionService) => {
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
  return (
    <>
      {active && (
        <SegmentedTabs
          id="system"
          label={t("System sections")}
          value={tab}
          change={setTab}
          items={[
            { value: "info", label: t("Info") },
            {
              value: "log",
              label: t("Log"),
            },
          ]}
        />
      )}
      <div
        class="settings-section"
        id="system-panel-info"
        role="tabpanel"
        aria-labelledby="system-tab-info"
        hidden={!active || tab !== "info"}
      >
        <SystemInfo
          password={<PasswordCard demo={demo} />}
          status={status}
          settings={settings}
          demo={demo}
          syncing={syncing}
          manualSync={manualSync}
          reviewTags={reviewTags}
          backup={async () => {
            await api("backup", "POST");
            notify(t("Consistent backup created in the Appdata directory."));
          }}
        />
      </div>
    </>
  );
}

export function SystemSettingsLog({
  status,
  demo,
}: {
  status: Status;
  demo: boolean;
}) {
  return (
    <div
      class="settings-section"
      id="system-panel-log"
      role="tabpanel"
      aria-labelledby="system-tab-log"
    >
      <EventLogViewer status={status} demo={demo} />
    </div>
  );
}
