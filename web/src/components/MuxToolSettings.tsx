import { useEffect, useState } from "preact/hooks";
import type { MuxSettings, MuxToolStatus, Settings, MuxCheck } from "../types";
import { api } from "../api";
import { t } from "../i18n";
import { instancesOf, instanceLabel } from "../instances";
import { defaultMuxSettings } from "../mux-spec";
import { confirmDeletion } from "../confirmation";
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
  const [tool, setTool] = useState<MuxToolStatus>();
  const [checks, setChecks] = useState<Record<string, MuxCheck[]>>({});
  const refresh = () =>
    api<MuxToolStatus>("mux/tool")
      .then(setTool)
      .catch(() => {});
  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, []);
  const act = async (action: string) => {
    if (
      action === "remove" &&
      !(await confirmDeletion(
        t(
          "Remove the downloaded MKVToolNix tools? Media files and jobs are kept.",
        ),
      ))
    )
      return;
    await api("mux/tool?action=" + action, "POST");
    await refresh();
  };
  return (
    <section class="connection mux-settings">
      <h3>MKVToolNix</h3>
      <p class="quiet">
        {t(
          "Edit tracks with a local tool downloaded into Appdata. Save service settings before installing or checking paths.",
        )}
      </p>
      <label class="check">
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
        />
        {t("Enabled")}
      </label>
      <p>
        {tool?.installed ? t("Installed") : t("Not installed")} {tool?.version}{" "}
        {tool?.busy && " · " + t("Working…")}
      </p>
      {tool?.updateAvailable && (
        <p class="notice">
          {t("Update available")}: {tool.available}
        </p>
      )}
      {tool?.upstream && (
        <p>
          {t("Upstream version")}: {tool.upstream}
        </p>
      )}
      {tool?.error && (
        <p role="alert" class="notice">
          {t(tool.error)}
        </p>
      )}
      <label>
        {t("Package channel")}
        <select
          value={m.channel}
          disabled={demo}
          onChange={(e) =>
            change({
              ...m,
              channel: e.currentTarget.value as MuxSettings["channel"],
            })
          }
        >
          <option value="stable">{t("Stable")}</option>
          <option value="edge">{t("Current (edge)")}</option>
        </select>
      </label>
      <div class="row-actions">
        {[
          tool?.installed ? "update" : "install",
          "check",
          ...(tool?.installed ? ["remove"] : []),
        ].map((action) => (
          <button
            type="button"
            class="button"
            disabled={demo || !!tool?.busy || !m.enabled}
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
        ))}
      </div>
      {instancesOf(cfg)
        .filter((c) => c.type === "radarr" || c.type === "sonarr")
        .map((c) => (
          <label class="path-mapping-field">
            {instanceLabel(c)} · {t("Arr path => Scopearr path")}
            <textarea
              rows={3}
              disabled={demo}
              placeholder="/data/media/movies => /media/movies"
              value={m.pathMappings[c.id] || ""}
              onInput={(e) =>
                change({
                  ...m,
                  pathMappings: {
                    ...m.pathMappings,
                    [c.id]: e.currentTarget.value,
                  },
                })
              }
            />
            {checks[c.id] && (
              <small>
                {checks[c.id].length
                  ? checks[c.id]
                      .map((v) =>
                        v.exists && v.readable && v.writable
                          ? t("Ready")
                          : t("Media file checks failed"),
                      )
                      .join(" · ")
                  : t("No cached files")}
              </small>
            )}
          </label>
        ))}
      <button
        type="button"
        class="button"
        disabled={demo || !m.enabled}
        onClick={() =>
          api<Record<string, MuxCheck[]>>("mux/check-paths", "POST")
            .then(setChecks)
            .catch(() => {})
        }
      >
        {t("Check paths")}
      </button>
      <label class="check">
        <input
          type="checkbox"
          checked={m.deleteOriginal}
          onChange={(e) =>
            change({ ...m, deleteOriginal: e.currentTarget.checked })
          }
        />
        {t("Delete original after success")}
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={m.notifyMedia}
          onChange={(e) =>
            change({ ...m, notifyMedia: e.currentTarget.checked })
          }
        />
        {t("Notify media servers")}
      </label>
      <label>
        {t("Remove successful jobs after days (0 = never)")}
        <input
          type="number"
          min={0}
          max={3650}
          value={m.keepFinished}
          onInput={(e) =>
            change({ ...m, keepFinished: Number(e.currentTarget.value) })
          }
        />
      </label>
      <p class="quiet">
        {t(
          "Mount media read-write outside /data. Allow UID 99 / GID 100 to write. Use a 512 MiB container limit and at least 800 MiB free Appdata space.",
        )}
      </p>
    </section>
  );
}
