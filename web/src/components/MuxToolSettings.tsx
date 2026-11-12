import { ICON } from "../ui";
import { useState } from "preact/hooks";
import { Scissors } from "lucide-preact";
import type { MuxSettings, Settings } from "../types";
import { t } from "../i18n";
import { defaultMuxSettings } from "../mux-spec";
import { confirmDeletion } from "../confirmation";
import { toolHead } from "../settings-model";
import { ToolPackageCard } from "./ToolPackageCard";
import { PathMappingsCard } from "./PathMappingsCard";
import { ServiceCard, ServiceSection } from "./settings/ServiceCard";
import { field } from "./settings/Field";
import { check } from "./settings/Check";
import type { ToolStatusView } from "../tool-status";

// The MKVToolNix card (docs/STYLEGUIDE.md, Part 1, 10.11): Tool and updates
// (its status first), Path mappings and Processing; switching it off asks
// first, as in 1.7.0. Its polled head goes to the tab's dot (report).
export function MuxToolSettings({
  cfg,
  change,
  demo,
  report,
}: {
  cfg: Settings;
  change: (value: MuxSettings) => void;
  demo: boolean;
  report?: (head: ToolStatusView) => void;
}) {
  const m = cfg.mux || defaultMuxSettings();
  const [separate, setSeparate] = useState(!!m.workDir);
  const [head, setHead] = useState(() => toolHead(undefined, t));
  return (
    <ServiceCard
      id="mux"
      icon={<Scissors size={ICON.button} />}
      name="MKVToolNix"
      status={head}
      active={{
        label: t("Enable service"),
        checked: m.enabled,
        disabled: demo,
        change: async (enabled) => {
          if (
            !enabled &&
            !(await confirmDeletion(
              t("Disable MKVToolNix and cancel the running job?"),
            ))
          )
            return;
          change({ ...m, enabled });
        },
      }}
    >
      <ToolPackageCard
        endpoint="mux/tool"
        label="MKVToolNix"
        enabled={m.enabled}
        channel={m.channel}
        changeChannel={(channel) => change({ ...m, channel })}
        demo={demo}
        head={(next) => {
          setHead(next);
          report?.(next);
        }}
      />
      <PathMappingsCard cfg={cfg} change={change} demo={demo} />
      <ServiceSection title={t("Processing")}>
        <div
          class="v2-mode"
          role="radiogroup"
          aria-labelledby="mux-directory-label"
        >
          <span id="mux-directory-label">{t("Muxing directory")}</span>
          <div>
            <label class="v2-ff-check">
              <input
                type="radio"
                class="v2-check"
                name="mux-directory"
                disabled={demo}
                checked={!separate}
                onChange={() => {
                  setSeparate(false);
                  change({ ...m, workDir: "" });
                }}
              />
              {t("Same folder as the media file")}
            </label>
            <label class="v2-ff-check">
              <input
                type="radio"
                class="v2-check"
                name="mux-directory"
                disabled={demo}
                checked={separate}
                onChange={() => {
                  setSeparate(true);
                  change({ ...m, workDir: m.workDir || "/mux-work" });
                }}
              />
              {t("Separate directory")}
            </label>
          </div>
          {separate && (
            <input
              class="v2-input"
              aria-label={t("Separate directory")}
              placeholder="/mux-work"
              value={m.workDir || ""}
              disabled={demo || !separate}
              onBlur={() => {
                if (separate && !m.workDir)
                  change({ ...m, workDir: "/mux-work" });
              }}
              onInput={(e) => change({ ...m, workDir: e.currentTarget.value })}
            />
          )}
          <small>
            {t(
              "A separate directory avoids partial files next to your media but requires copying the result back, which needs additional time and free space on both sides.",
            )}
          </small>
        </div>
        {check(
          t("Delete original after success"),
          m.deleteOriginal,
          (deleteOriginal) => change({ ...m, deleteOriginal }),
          demo,
        )}
        {!m.deleteOriginal && (
          <small>
            {t(
              "A matching filename creates a preserved backup. A different filename keeps both media files; Arr chooses which file to import.",
            )}
          </small>
        )}
        {check(
          t("Notify media servers"),
          m.notifyMedia,
          (notifyMedia) => change({ ...m, notifyMedia }),
          demo,
        )}
        <div class="v2-form">
          {field(
            "mux-keep-finished",
            t("Remove successful jobs after days (0 = never)"),
            (a) => (
              <input
                {...a}
                class="v2-input"
                type="number"
                min={0}
                max={3650}
                disabled={demo}
                value={m.keepFinished}
                onInput={(e) =>
                  change({ ...m, keepFinished: Number(e.currentTarget.value) })
                }
              />
            ),
          )}
        </div>
        <small>
          {t(
            "Mount media read-write outside /data. Allow UID 99 / GID 100 to write. Use a 512 MB (--memory=512m) container limit and at least 850 MB free Appdata space.",
          )}
        </small>
      </ServiceSection>
    </ServiceCard>
  );
}
