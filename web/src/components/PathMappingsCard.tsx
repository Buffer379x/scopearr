import { ICON } from "../ui";
import { useState } from "preact/hooks";
import { FolderCheck, FolderInput, LoaderCircle } from "lucide-preact";
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
import { ServiceSection } from "./settings/ServiceCard";
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
  // A button's icon place holds the spinner while it runs, so it keeps its
  // width.
  const icon = (busy: boolean, Icon: typeof FolderCheck) => (
    <span class="v2-btn-icon" aria-hidden="true">
      {busy ? (
        <LoaderCircle class="v2-spin" size={ICON.button} />
      ) : (
        <Icon size={ICON.button} />
      )}
    </span>
  );
  return (
    <ServiceSection
      title={t("Path mappings")}
      actions={
        <>
          <button
            type="button"
            class="v2-btn v2-btn--sm"
            disabled={demo || importing}
            onClick={importRoots}
          >
            {icon(importing, FolderInput)}
            {t("Import root folders")}
          </button>
          {pathAvailable && (
            <button
              type="button"
              class="v2-btn v2-btn--sm"
              disabled={demo || checking}
              onClick={check}
            >
              {icon(checking, FolderCheck)}
              {t("Check paths")}
            </button>
          )}
        </>
      }
    >
      <small>{t("Shared with MKVToolNix and renaming.")}</small>
      <div class="v2-field">
        <label for="path-mappings">
          {t("Arr path => Scopearr path · all Radarr and Sonarr services")}
        </label>
        <textarea
          id="path-mappings"
          class="v2-textarea"
          rows={4}
          disabled={demo}
          aria-describedby="path-mappings-hint"
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
        {missing.map((root) => (
          <small>
            {root.arrPath} · {root.instances.join(", ")}
          </small>
        ))}
        <small id="path-mappings-hint">
          {t(
            "With /mnt/user mounted as /media, shares appear as /media/movies, /media/shows, /media/documentaries, for example.",
          )}
        </small>
      </div>
      {checks && (
        <MuxPathDialog checks={checks} close={() => setChecks(undefined)} />
      )}
    </ServiceSection>
  );
}
