import { useEffect, useState } from "preact/hooks";
import { Scissors, LoaderCircle } from "lucide-preact";
import type {
  MuxSettings,
  MuxToolStatus,
  Settings,
  MuxPathChecks,
  MuxRootFolders,
  MuxRootFolder,
} from "../types";
import { api } from "../api";
import { t, useI18n } from "../i18n";
import { notify } from "../notifications";
import { MuxPathDialog, pathAttention } from "./MuxPathDialog";
import { defaultMuxSettings, importMuxRoots } from "../mux-spec";
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
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [missing, setMissing] = useState<MuxRootFolder[]>([]);
  const [pathAvailable, setPathAvailable] = useState(true);
  const check = async () => {
    setChecking(true);
    try {
      const c = await api<MuxPathChecks>("mux/check-paths", "POST", {
        mappings: m.mappings,
        workDir: m.workDir,
      });
      setChecks(c);
      const count = pathAttention(c);
      notify(
        t(
          count ? "{count} path checks need attention" : "All paths are ready",
          { count },
        ),
        count ? "warning" : "success",
      );
    } catch {
      if (!m.enabled) setPathAvailable(false);
    } finally {
      setChecking(false);
    }
  };
  const importRoots = async () => {
    setImporting(true);
    try {
      const roots = await api<MuxRootFolders>("mux/root-folders", "POST", {
        mappings: m.mappings,
      });
      const next = importMuxRoots(m.mappings, roots.rootFolders);
      change({ ...m, mappings: next.mappings, pathMappings: undefined });
      setMissing(next.missing);
      notify(
        t("{added} root folders added. {missing} need a manual mapping.", {
          added: next.added,
          missing: next.missing.length,
        }),
        next.missing.length || roots.errors.length ? "warning" : "success",
      );
      for (const error of roots.errors)
        notify(error.instance + ": " + t(error.error), "warning");
    } catch {
    } finally {
      setImporting(false);
    }
  };
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
      <section class="settings-card mux-tool-card settings-section">
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
            "Save service settings before installing. Path checks use your current input. Requires at least 850 MB free Appdata space.",
          )}
        </small>
      </section>
      <section class="outbound-tag-settings">
        <h4>{t("Path mappings")}</h4>
        <div class="settings-section">
          <label class="path-mapping-field">
            {t("Arr path => Scopearr path · all Radarr and Sonarr services")}
            <textarea
              rows={4}
              disabled={demo}
              placeholder={
                "/movies => /media/movies\n/documentaries => /media/documentaries"
              }
              value={m.mappings || ""}
              onInput={(e) => {
                setMissing([]);
                change({
                  ...m,
                  mappings: e.currentTarget.value,
                  pathMappings: undefined,
                });
              }}
            />
          </label>
          {!!missing.length && (
            <div>
              {missing.map((root) => (
                <div>
                  <small class="quiet">
                    {root.arrPath} · {root.instances.join(", ")}
                  </small>
                </div>
              ))}
            </div>
          )}
          <small class="quiet">
            {t(
              "With /mnt/user mounted as /media, shares appear as /media/movies, /media/shows.",
            )}
          </small>
          <div class="row-actions">
            <button
              type="button"
              class="button"
              disabled={demo || importing}
              onClick={importRoots}
            >
              {importing && <LoaderCircle class="spin" size={14} />}{" "}
              {t("Import root folders")}
            </button>
            {pathAvailable && (
              <button
                type="button"
                class="button"
                disabled={demo || checking}
                onClick={check}
              >
                {checking && <LoaderCircle class="spin" size={14} />}{" "}
                {t("Check paths")}
              </button>
            )}
          </div>
          {checks && (
            <MuxPathDialog checks={checks} close={() => setChecks(undefined)} />
          )}
        </div>
      </section>
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
