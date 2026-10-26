import { ScanSearch } from "lucide-preact";
import type { MuxSettings, Settings } from "../types";
import { ICON } from "../ui";
import { t } from "../i18n";
import { ToolPackageCard } from "./ToolPackageCard";
import { PathMappingsCard } from "./PathMappingsCard";

export function MediaInfoSettings({
  cfg,
  change,
  changeMux,
  demo,
}: {
  cfg: Settings;
  change: (value: NonNullable<Settings["mediaInfo"]>) => void;
  changeMux: (value: MuxSettings) => void;
  demo: boolean;
}) {
  const m = cfg.mediaInfo || { enabled: false, channel: "stable" as const };
  return (
    <section
      class="connection mediainfo-settings"
      id="service-settings-panel-mediainfo"
      aria-labelledby="service-settings-tab-mediainfo"
      role="tabpanel"
    >
      <header class="connection-heading card-heading">
        <h3 class="card-title">
          <ScanSearch size={ICON.button} />
          MediaInfo
        </h3>
      </header>
      <p class="quiet">
        {t(
          "Read media metadata locally when you choose Read file in file details.",
        )}
      </p>
      <label class="check-field">
        <input
          type="checkbox"
          checked={m.enabled}
          disabled={demo}
          onChange={(e) => change({ ...m, enabled: e.currentTarget.checked })}
        />{" "}
        {t("Enable service")}
      </label>
      <ToolPackageCard
        endpoint="mediainfo/tool"
        label="MediaInfo"
        enabled={m.enabled}
        channel={m.channel}
        changeChannel={(channel) => change({ ...m, channel })}
        demo={demo}
      />
      <PathMappingsCard cfg={cfg} change={changeMux} demo={demo} readOnly />
    </section>
  );
}
