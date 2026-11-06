import { removePreference } from "../browser-storage";
removePreference("scopearr-log-seen");

import { useI18n } from "../i18n";
import type { Status } from "../types";

import { useAppNavigation } from "../hooks/useAppNavigation";
import { AppDataProvider } from "./AppDataProvider";
import { AppShell } from "./AppShell";
export function Library({
  status,
  refresh,
}: {
  status: Status;
  refresh: () => Promise<void>;
}) {
  useI18n();
  const navigation = useAppNavigation(status);
  return (
    <AppDataProvider
      status={status}
      refresh={refresh}
      customTagsLoaded={navigation.pruneCustomFilters}
    >
      <AppShell status={status} refresh={refresh} navigation={navigation} />
    </AppDataProvider>
  );
}
