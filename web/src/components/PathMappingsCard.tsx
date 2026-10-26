import { ICON } from "../ui";
import { useState } from "preact/hooks";
import { LoaderCircle } from "lucide-preact";
import type {
  MuxSettings,
  Settings,
  MuxPathChecks,
  MuxRootFolders,
  MuxRootFolder,
} from "../types";
import { api } from "../api";
import { t } from "../i18n";
import { notify } from "../notifications";
import { MuxPathDialog, pathAttention } from "./MuxPathDialog";
import { defaultMuxSettings, importMuxRoots } from "../mux-spec";
export function pathCheckRequest(
  settings: Pick<MuxSettings, "mappings" | "workDir">,
  readOnly: boolean,
) {
  return {
    endpoint: readOnly ? "mediainfo/check-paths" : "mux/check-paths",
    body: readOnly
      ? { mappings: settings.mappings }
      : { mappings: settings.mappings, workDir: settings.workDir },
  };
}
export function PathMappingsCard({
  cfg,
  change,
  demo,
  readOnly = false,
}: {
  cfg: Settings;
  change: (value: MuxSettings) => void;
  demo: boolean;
  readOnly?: boolean;
}) {
  const m = cfg.mux || defaultMuxSettings();
  const [checks, setChecks] = useState<MuxPathChecks>();
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [missing, setMissing] = useState<MuxRootFolder[]>([]);
  const [pathAvailable, setPathAvailable] = useState(true);
  const check = async () => {
    setChecking(true);
    try {
      const request = pathCheckRequest(m, readOnly);
      const c = await api<MuxPathChecks>(
        request.endpoint,
        "POST",
        request.body,
      );
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
  return (
    <section class="outbound-tag-settings">
      <div class="card-heading">
        <h3 class="card-title">{t("Path mappings")}</h3>
        <div class="card-actions">
          <button
            type="button"
            class="button"
            disabled={demo || importing}
            onClick={importRoots}
          >
            {importing && <LoaderCircle class="spin" size={ICON.label} />}{" "}
            {t("Import root folders")}
          </button>
          {pathAvailable && (
            <button
              type="button"
              class="button"
              disabled={demo || checking}
              onClick={check}
            >
              {checking && <LoaderCircle class="spin" size={ICON.label} />}{" "}
              {t("Check paths")}
            </button>
          )}
        </div>
      </div>
      <small class="quiet">{t("Shared with MKVToolNix and renaming.")}</small>
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
            "With /mnt/user mounted as /media, shares appear as /media/movies, /media/shows, /media/documentaries, for example.",
          )}
        </small>

        {checks && (
          <MuxPathDialog checks={checks} close={() => setChecks(undefined)} />
        )}
      </div>
    </section>
  );
}
