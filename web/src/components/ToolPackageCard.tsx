import { usePolling } from "../hooks/usePolling";
import { useState } from "preact/hooks";
import type { MuxToolStatus, MuxSettings } from "../types";
import { api } from "../api";
import { t, useI18n } from "../i18n";
import { bytes } from "../ui";
import { confirmDeletion } from "../confirmation";
import { toolPackageActions } from "../tool-package";
export function ToolPackageCard({
  endpoint,
  label,
  status,
  enabled,
  channel,
  changeChannel,
  demo,
}: {
  endpoint: string;
  label: "MKVToolNix" | "MediaInfo";
  status?: MuxToolStatus;
  enabled: boolean;
  channel: MuxSettings["channel"];
  changeChannel: (channel: MuxSettings["channel"]) => void;
  demo: boolean;
}) {
  const { locale } = useI18n();
  const [tool, setTool] = useState<MuxToolStatus | undefined>(status);
  const channelId = endpoint.split("/")[0] + "-channel";
  const refresh = (signal?: AbortSignal) =>
    api<MuxToolStatus>(endpoint, "GET", undefined, signal).then((next) => {
      if (!signal?.aborted) setTool(next);
      return next;
    });
  usePolling(refresh, (next) => ((next || tool)?.busy ? 2000 : 30000), [
    endpoint,
  ]);
  const act = async (action: string) => {
    if (
      action === "remove" &&
      !(await confirmDeletion(
        t(
          label === "MKVToolNix"
            ? "Remove the downloaded MKVToolNix tools? Media files and jobs are kept."
            : "Remove the downloaded MediaInfo tools? Saved results are kept.",
        ),
      ))
    )
      return;
    await api(endpoint + "?action=" + action, "POST");
    await refresh();
  };
  return (
    <section class="mux-tool-card tool-package-card settings-section">
      <div class="card-heading">
        <h3 class="card-title">{t("Tool and updates")}</h3>
        <div class="card-actions">
          {toolPackageActions(tool, enabled, demo).map(
            ({ action, disabled }) => (
              <button
                type="button"
                class="button"
                disabled={disabled}
                onClick={() => act(action).catch(() => {})}
              >
                {t(
                  {
                    install: "Download",
                    update: "Update",
                    check: "Check for updates",
                    remove: "Remove",
                  }[action]!,
                )}
              </button>
            ),
          )}
        </div>
      </div>
      <dl class="key-values">
        <div>
          <dt>{t("Installed version")}</dt>
          <dd>
            {tool?.version ? tool.version + " · " : ""}
            {tool?.busy
              ? t("Working…")
              : tool?.installed
                ? t("Installed")
                : t("Not installed")}
          </dd>
        </div>
        <div>
          <dt>{t("Available version")}</dt>
          <dd>
            {tool?.available || "—"}
            {tool?.updateAvailable && " · " + t("Update available")}
          </dd>
        </div>
        <div>
          <dt>{t("Upstream version")}</dt>
          <dd>{tool?.upstream || "—"}</dd>
        </div>

        <div>
          <dt>{t("Last check")}</dt>
          <dd>
            {tool?.checkedAt
              ? new Date(tool.checkedAt).toLocaleString(locale)
              : t("Not checked yet")}
          </dd>
        </div>
        <div>
          <dt>{t("Size")}</dt>
          <dd>{tool?.sizeBytes ? bytes(tool.sizeBytes) : "—"}</dd>
        </div>
      </dl>
      <div class="connection-grid">
        <label for={channelId}>
          {t("Package channel")}
          <select
            id={channelId}
            value={channel}
            disabled={demo}
            onChange={(e) =>
              changeChannel(e.currentTarget.value as MuxSettings["channel"])
            }
          >
            <option value="stable">{t("Stable")}</option>
            <option value="edge">{t("Current (edge)")}</option>
          </select>
        </label>
      </div>
      {tool?.error && (
        <p role="status" class="notice">
          {t(tool.error)}
        </p>
      )}

      <small class="quiet">
        {t(
          label === "MKVToolNix"
            ? "Save service settings before installing. Path checks use your current input. Requires at least 850 MB free Appdata space."
            : "Save service settings before installing. Requires at least 150 MB free Appdata space.",
        )}
      </small>
    </section>
  );
}
