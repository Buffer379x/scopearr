import { usePolling } from "../hooks/usePolling";
import { useEffect, useRef, useState } from "preact/hooks";
import type { MuxToolStatus, MuxSettings } from "../types";
import type { ToolStatusView } from "../tool-status";
import { api } from "../api";
import { t, useI18n } from "../i18n";
import { bytes } from "../ui";
import { confirmDeletion } from "../confirmation";
import { toolPackageActions } from "../tool-package";
import { toolHead } from "../settings-model";
import { ServiceSection } from "./settings/ServiceCard";
import { ServiceStatus, StatusValue } from "./settings/ServiceStatus";

// The section "Tool and updates" of the MKVToolNix and MediaInfo cards
// (docs/STYLEGUIDE.md, Part 1, 10.11, ruling R-K): the package actions in
// its heading line, the tool's status rows ("—" until the first answer; an
// error stands in Status, in the error tone), the package channel and the
// 1.7.0 hints. It polls the tool as in 1.7.0 and reports the card's head
// tag (`head`).
export function ToolPackageCard({
  endpoint,
  label,
  status,
  enabled,
  channel,
  changeChannel,
  demo,
  head,
}: {
  endpoint: string;
  label: "MKVToolNix" | "MediaInfo";
  status?: MuxToolStatus;
  enabled: boolean;
  channel: MuxSettings["channel"];
  changeChannel: (channel: MuxSettings["channel"]) => void;
  demo: boolean;
  head?: (status: ToolStatusView) => void;
}) {
  const { locale } = useI18n();
  const [tool, setTool] = useState<MuxToolStatus | undefined>(status);
  const channelId = endpoint.split("/")[0] + "-channel";
  const refresh = (signal?: AbortSignal) =>
    api<MuxToolStatus>(endpoint, "GET", undefined, signal).then((next) => {
      if (!signal?.aborted) setTool(next);
      return next;
    });
  const pollEndpoint = useRef<string>();
  const pollDelay = tool?.busy ? 2000 : 30000;
  // A cadence change replaces the waiting timer, while a new endpoint loads now.
  const startDelay = pollEndpoint.current === endpoint ? pollDelay : 0;
  pollEndpoint.current = endpoint;
  usePolling(
    refresh,
    (next) => ((next || tool)?.busy ? 2000 : 30000),
    [endpoint, !!tool?.busy],
    { startDelay },
  );
  const view = toolHead(tool, t);
  useEffect(() => {
    head?.(view);
  }, [tool, locale]);
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
    <ServiceSection
      title={t("Tool and updates")}
      actions={toolPackageActions(tool, enabled, demo).map(
        ({ action, disabled }) => (
          <button
            type="button"
            class="v2-btn v2-btn--sm"
            disabled={disabled}
            onClick={() => act(action).catch(() => {})}
          >
            {action === "install" || action === "update" ? (
              // One place for both labels (10.3): as wide as the longer, so
              // the line wraps the same before and after an install.
              <>
                <span>{t(action === "install" ? "Download" : "Update")}</span>
                <span class="v2-btn-alt" aria-hidden="true">
                  {t(action === "install" ? "Update" : "Download")}
                </span>
              </>
            ) : (
              t(action === "check" ? "Check for updates" : "Remove")
            )}
          </button>
        ),
      )}
    >
      <ServiceStatus
        kind={label === "MKVToolNix" ? "mux" : "mediainfo"}
        values={
          tool
            ? {
                status: <StatusValue view={view} />,
                installed:
                  (tool.version ? tool.version + " · " : "") +
                  (tool.busy
                    ? t("Working…")
                    : tool.installed
                      ? t("Installed")
                      : t("Not installed")),
                available:
                  tool.available &&
                  tool.available +
                    (tool.updateAvailable ? " · " + t("Update available") : ""),
                upstream: tool.upstream,
                checked: tool.checkedAt
                  ? new Date(tool.checkedAt).toLocaleString(locale)
                  : t("Not checked yet"),
                size: tool.sizeBytes ? bytes(tool.sizeBytes) : "",
              }
            : {}
        }
      />
      <div class="v2-form">
        <div class="v2-field">
          <label for={channelId}>{t("Package channel")}</label>
          <select
            id={channelId}
            class="v2-select"
            value={channel}
            disabled={demo}
            onChange={(e) =>
              changeChannel(e.currentTarget.value as MuxSettings["channel"])
            }
          >
            <option value="stable">{t("Stable")}</option>
            <option value="edge">{t("Current (edge)")}</option>
          </select>
        </div>
      </div>
      <small>
        {t(
          label === "MKVToolNix"
            ? "Edit tracks with a local tool downloaded into Appdata."
            : "Read media metadata locally when you choose Read file in file details.",
        )}
      </small>
      <small>
        {t(
          label === "MKVToolNix"
            ? "Save service settings before installing. Path checks use your current input. Requires at least 850 MB free Appdata space."
            : "Save service settings before installing. Requires at least 150 MB free Appdata space.",
        )}
      </small>
    </ServiceSection>
  );
}
