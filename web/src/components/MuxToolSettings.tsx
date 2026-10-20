import { useEffect, useState } from "preact/hooks";
import { Scissors } from "lucide-preact";
import type {
  MuxSettings,
  MuxToolStatus,
  Settings,
  MuxPathChecks,
} from "../types";
import { api } from "../api";
import { t, useI18n } from "../i18n";
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
  const { locale } = useI18n();
  const m = cfg.mux || defaultMuxSettings();
  const [tool, setTool] = useState<MuxToolStatus>();
  const [separate, setSeparate] = useState(!!m.workDir);
  const [checks, setChecks] = useState<MuxPathChecks>();
  const refresh = () =>
    api<MuxToolStatus>("mux/tool")
      .then(setTool)
      .catch(() => {});
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (!document.hidden) refresh();
      },
      tool?.busy ? 2000 : 30000,
    );
    return () => clearInterval(timer);
  }, [!!tool?.busy]);
  // Results describe saved settings; editing a path invalidates the displayed result.
  useEffect(() => {
    setChecks(undefined);
  }, [m.workDir, m.pathMappings]);
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
    <section
      class="connection mux-settings"
      role="tabpanel"
      id="service-settings-mux"
    >
      <header class="connection-heading">
        <h3 class="card-title">
          <Scissors size={16} />
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
      <section class="settings-card mux-tool-card">
        <h4>{t("Tool and updates")}</h4>
        <dl class="system-details">
          <dt>{t("Installed version")}</dt>
          <dd>
            {tool?.version || "—"} ·{" "}
            {tool?.busy
              ? t("Working…")
              : tool?.installed
                ? t("Installed")
                : t("Not installed")}
          </dd>
          <dt>{t("Available version")}</dt>
          <dd>
            {tool?.available || "—"}
            {tool?.updateAvailable && " · " + t("Update available")}
          </dd>
          <dt>{t("Upstream version")}</dt>
          <dd>{tool?.upstream || "—"}</dd>
          <dt>
            <label for="mux-channel">{t("Package channel")}</label>
          </dt>
          <dd>
            <select
              id="mux-channel"
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
          </dd>
          <dt>{t("Last check")}</dt>
          <dd>
            {tool?.checkedAt
              ? new Date(tool.checkedAt).toLocaleString(locale)
              : t("Not checked yet")}
          </dd>
        </dl>
        {tool?.error && (
          <p role="status" class="notice">
            {t(tool.error)}
          </p>
        )}
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
        <small class="quiet">
          {t(
            "Save service settings before installing or checking paths. Requires at least 800 MiB free Appdata space.",
          )}
        </small>
      </section>
      <section class="outbound-tag-settings">
        <h4>{t("Path mappings")}</h4>
        <div class="connection-grid">
          {instancesOf(cfg)
            .filter((c) => c.type === "radarr" || c.type === "sonarr")
            .sort(
              (a, b) =>
                instanceLabel(a).localeCompare(instanceLabel(b), locale, {
                  sensitivity: "base",
                  numeric: true,
                }) || a.id.localeCompare(b.id),
            )
            .map((c) => (
              <label class="path-mapping-field" key={c.id}>
                {instanceLabel(c)} · {t("Arr path => Scopearr path")}
                <textarea
                  rows={3}
                  disabled={demo}
                  placeholder="/movies => /media/movies"
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
                {checks?.instances[c.id] && (
                  <small>
                    {checks.instances[c.id].length
                      ? checks.instances[c.id]
                          .map((v) =>
                            Object.values(v).every(Boolean)
                              ? t("Ready")
                              : t("Media file checks failed"),
                          )
                          .join(" · ")
                      : t("No cached files")}
                  </small>
                )}
              </label>
            ))}
        </div>
        <small class="quiet">
          {t(
            "With /mnt/user mounted as /media, shares appear as /media/movies, /media/shows.",
          )}
        </small>
        <div class="row-actions">
          <button
            type="button"
            class="button"
            disabled={demo || !m.enabled}
            onClick={() =>
              api<MuxPathChecks>("mux/check-paths", "POST")
                .then(setChecks)
                .catch(() => {})
            }
          >
            {t("Check paths")}
          </button>
        </div>
        {checks && (
          <p role="status" class="quiet">
            {t("Muxing directory")}:{" "}
            {checks.workDir.configured ? (
              <>
                {checks.workDir.exists && checks.workDir.writable
                  ? t("Ready")
                  : t("Media file checks failed")}{" "}
                · {t("Free space")}:{" "}
                {(checks.workDir.freeBytes / 1073741824).toLocaleString(
                  locale,
                  { maximumFractionDigits: 1 },
                )}{" "}
                GiB
              </>
            ) : (
              t("Same folder as the media file")
            )}
          </p>
        )}
      </section>
      <section class="outbound-tag-settings">
        <h4>{t("Processing")}</h4>
        <fieldset class="mux-work-options">
          <legend>{t("Muxing directory")}</legend>
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
          <input
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
          <small class="quiet">
            {t(
              "A separate directory avoids partial files next to your media but requires copying the result back, which needs additional time and free space on both sides.",
            )}
          </small>
        </fieldset>
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
        <small class="quiet">
          {t(
            "Mount media read-write outside /data. Allow UID 99 / GID 100 to write. Use a 512 MiB container limit and at least 800 MiB free Appdata space.",
          )}
        </small>
      </section>
    </section>
  );
}
