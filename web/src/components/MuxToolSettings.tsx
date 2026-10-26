import { ICON } from "../ui";
import { useState } from "preact/hooks";
import { Scissors } from "lucide-preact";
import type { MuxSettings, Settings } from "../types";
import { t } from "../i18n";
import { defaultMuxSettings } from "../mux-spec";
import { confirmDeletion } from "../confirmation";
import { ToolPackageCard } from "./ToolPackageCard";
import { PathMappingsCard } from "./PathMappingsCard";
export function MuxToolSettings({
  cfg,
  change,
  demo,
}: {
  cfg: Settings;
  change: (value: MuxSettings) => void;
  demo: boolean;
}) {
  const m = cfg.mux || defaultMuxSettings();
  const [separate, setSeparate] = useState(!!m.workDir);
  return (
    <section
      class="connection mux-settings"
      id="service-settings-panel-mux"
      aria-labelledby="service-settings-tab-mux"
      role="tabpanel"
    >
      <header class="connection-heading card-heading">
        <h3 class="card-title">
          <Scissors size={ICON.button} />
          MKVToolNix
        </h3>
      </header>
      <p class="quiet">
        {t("Edit tracks with a local tool downloaded into Appdata.")}
      </p>
      <label class="check-field">
        <input
          type="checkbox"
          checked={m.enabled}
          disabled={demo}
          onChange={async (e) => {
            const enabled = e.currentTarget.checked;
            if (
              !enabled &&
              !(await confirmDeletion(
                t("Disable MKVToolNix and cancel the running job?"),
              ))
            )
              return;
            change({ ...m, enabled });
          }}
        />{" "}
        {t("Enable service")}
      </label>
      <ToolPackageCard
        endpoint="mux/tool"
        label="MKVToolNix"
        enabled={m.enabled}
        channel={m.channel}
        changeChannel={(channel) => change({ ...m, channel })}
        demo={demo}
      />
      <PathMappingsCard cfg={cfg} change={change} demo={demo} />
      <section class="outbound-tag-settings">
        <h4>{t("Processing")}</h4>
        <div class="settings-section">
          <div
            class="mux-directory-options"
            role="radiogroup"
            aria-labelledby="mux-directory-label"
          >
            <div class="field-label" id="mux-directory-label">
              {t("Muxing directory")}
            </div>
            <label class="check-field">
              <input
                type="radio"
                name="mux-directory"
                disabled={demo}
                checked={!separate}
                onChange={() => {
                  setSeparate(false);
                  change({ ...m, workDir: "" });
                }}
              />{" "}
              {t("Same folder as the media file")}
            </label>
            <label class="check-field">
              <input
                type="radio"
                name="mux-directory"
                disabled={demo}
                checked={separate}
                onChange={() => {
                  setSeparate(true);
                  change({ ...m, workDir: m.workDir || "/mux-work" });
                }}
              />{" "}
              {t("Separate directory")}
            </label>
            {separate && (
              <div class="connection-grid">
                <input
                  aria-label={t("Separate directory")}
                  placeholder="/mux-work"
                  value={m.workDir || ""}
                  disabled={demo || !separate}
                  onBlur={() => {
                    if (separate && !m.workDir)
                      change({ ...m, workDir: "/mux-work" });
                  }}
                  onInput={(e) =>
                    change({ ...m, workDir: e.currentTarget.value })
                  }
                />
              </div>
            )}
            <small class="quiet">
              {t(
                "A separate directory avoids partial files next to your media but requires copying the result back, which needs additional time and free space on both sides.",
              )}
            </small>
          </div>
          <label class="check-field">
            <input
              type="checkbox"
              disabled={demo}
              checked={m.deleteOriginal}
              onChange={(e) =>
                change({ ...m, deleteOriginal: e.currentTarget.checked })
              }
            />{" "}
            {t("Delete original after success")}
          </label>
          {!m.deleteOriginal && (
            <small class="quiet">
              {t(
                "A matching filename creates a preserved backup. A different filename keeps both media files; Arr chooses which file to import.",
              )}
            </small>
          )}
          <label class="check-field">
            <input
              type="checkbox"
              disabled={demo}
              checked={m.notifyMedia}
              onChange={(e) =>
                change({ ...m, notifyMedia: e.currentTarget.checked })
              }
            />{" "}
            {t("Notify media servers")}
          </label>
          <div class="connection-grid">
            <label>
              {t("Remove successful jobs after days (0 = never)")}
              <input
                type="number"
                min={0}
                max={3650}
                disabled={demo}
                value={m.keepFinished}
                onInput={(e) =>
                  change({ ...m, keepFinished: Number(e.currentTarget.value) })
                }
              />
            </label>
          </div>
          <small class="quiet">
            {t(
              "Mount media read-write outside /data. Allow UID 99 / GID 100 to write. Use a 512 MB (--memory=512m) container limit and at least 850 MB free Appdata space.",
            )}
          </small>
        </div>
      </section>
    </section>
  );
}
