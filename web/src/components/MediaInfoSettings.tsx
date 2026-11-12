import { ScanSearch } from "lucide-preact";
import { useState } from "preact/hooks";
import type { MuxSettings, Settings } from "../types";
import { ICON } from "../ui";
import { t } from "../i18n";
import { toolHead } from "../settings-model";
import { ToolPackageCard } from "./ToolPackageCard";
import { PathMappingsCard } from "./PathMappingsCard";
import { ServiceCard } from "./settings/ServiceCard";

// The MediaInfo card (docs/STYLEGUIDE.md, Part 1, 10.11): Tool and updates
// (its status first) and the shared path mappings, read only.
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
  const [head, setHead] = useState(() => toolHead(undefined, t));
  return (
    <ServiceCard
      id="mediainfo"
      icon={<ScanSearch size={ICON.button} />}
      name="MediaInfo"
      status={head}
      active={{
        label: t("Enable service"),
        checked: m.enabled,
        disabled: demo,
        change: (enabled) => change({ ...m, enabled }),
      }}
    >
      <ToolPackageCard
        endpoint="mediainfo/tool"
        label="MediaInfo"
        enabled={m.enabled}
        channel={m.channel}
        changeChannel={(channel) => change({ ...m, channel })}
        demo={demo}
        head={setHead}
      />
      <PathMappingsCard cfg={cfg} change={changeMux} demo={demo} readOnly />
    </ServiceCard>
  );
}
