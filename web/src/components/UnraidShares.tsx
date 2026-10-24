import { LoaderCircle, RefreshCw } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { t, useI18n } from "../i18n";
import type { PlacementRootFolder, UnraidSettings } from "../types";
import { CardHeading, ICON } from "../ui";

type ShareRoots = {
  rootFolders: PlacementRootFolder[];
  choices: string[];
  error?: string;
};

// Shows only root folders reported by enabled Radarr/Sonarr services. Choosing a
// share folder associates an existing root; it never adds scan scope.
export function UnraidShares({
  value,
  mappings,
  demo,
  change,
}: {
  value: UnraidSettings;
  mappings: string;
  demo: boolean;
  change: (shareDirs: Record<string, string>) => void;
}) {
  useI18n();
  const [roots, setRoots] = useState<ShareRoots>();
  const [busy, setBusy] = useState(false);
  const [children, setChildren] = useState<Record<string, string[]>>({});
  const [nested, setNested] = useState<Record<string, boolean>>({});
  const request = useRef(0);
  const load = async () => {
    if (demo) return;
    const id = ++request.current;
    setBusy(true);
    try {
      const next = await api<ShareRoots>("unraid/shares", "POST", {
        unraid: value,
        mappings,
      });
      if (id === request.current) setRoots(next);
    } catch {
      // api() reports the error; keep the previous table.
    } finally {
      if (id === request.current) setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, [JSON.stringify(value.shareDirs || {}), value.diskRoot, mappings]);
  const choose = (arrPath: string, choice: string) => {
    const next = { ...(value.shareDirs || {}) };
    if (choice) next[arrPath] = choice;
    else delete next[arrPath];
    change(next);
  };
  const loadChildren = async (parent: string) => {
    if (!parent || children[parent]) return;
    try {
      const out = await api<{ directories: string[] }>(
        "unraid/share-dirs",
        "POST",
        { parent },
      );
      setChildren((current) => ({ ...current, [parent]: out.directories }));
    } catch {}
  };
  const status = (root: PlacementRootFolder) =>
    root.status === "resolved"
      ? ["status-ok", t("Resolved")]
      : root.status === "disabled"
        ? ["status-neutral", t("Not scanned")]
        : ["status-warn", t("Not resolved")];
  return (
    <section class="settings-card unraid-shares">
      <CardHeading
        title={t("Shares")}
        description={t(
          "Disk placement scans the share folders of these Radarr/Sonarr root folders directly on the disks. Other shares are never scanned.",
        )}
        actions={
          <button
            type="button"
            class="icon-button"
            disabled={demo || busy}
            aria-label={t("Refresh shares")}
            title={t("Refresh shares")}
            onClick={() => void load()}
          >
            {busy ? (
              <LoaderCircle size={ICON.button} class="spin" />
            ) : (
              <RefreshCw size={ICON.button} />
            )}
          </button>
        }
      />
      {roots?.error && <p class="notice">{t(roots.error)}</p>}
      {roots && !roots.rootFolders.length ? (
        <p class="quiet">
          {t("No root folders reported by enabled services.")}
        </p>
      ) : (
        <div class="table-wrap">
          <table class="detail-table stack-mobile">
            <thead>
              <tr>
                {["Root folder", "Instances", "Share folder", "Status"].map(
                  (label) => (
                    <th scope="col">{t(label)}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {(roots?.rootFolders || []).map((root) => {
                const selection = value.shareDirs?.[root.arrPath] || "";
                const top = selection.includes("/")
                  ? selection.split("/")[0]
                  : selection;
                const [tone, label] = status(root);
                const showNested =
                  nested[root.arrPath] || selection.includes("/");
                return (
                  <tr key={root.arrPath}>
                    <td data-label={t("Root folder")}>
                      <code>{root.arrPath}</code>
                    </td>
                    <td data-label={t("Instances")}>
                      {root.instances.join(", ")}
                    </td>
                    <td data-label={t("Share folder")}>
                      <div class="unraid-share-choice">
                        <select
                          aria-label={t("Share folder for {path}", {
                            path: root.arrPath,
                          })}
                          disabled={demo}
                          value={top}
                          onChange={(e) =>
                            choose(root.arrPath, e.currentTarget.value)
                          }
                        >
                          <option value="">
                            {t("Automatic ({detected})", {
                              detected: root.automaticShareDir || "—",
                            })}
                          </option>
                          <option value="-">{t("Do not scan")}</option>
                          {(roots?.choices || []).map((choice) => (
                            <option value={choice}>{choice}</option>
                          ))}
                        </select>
                        {top && top !== "-" && !showNested && (
                          <button
                            type="button"
                            class="text-button"
                            disabled={demo}
                            onClick={() => {
                              setNested((current) => ({
                                ...current,
                                [root.arrPath]: true,
                              }));
                              void loadChildren(top);
                            }}
                          >
                            {t("Choose subfolder …")}
                          </button>
                        )}
                        {top && top !== "-" && showNested && (
                          <select
                            aria-label={t("Subfolder for {path}", {
                              path: root.arrPath,
                            })}
                            disabled={demo}
                            value={selection.includes("/") ? selection : ""}
                            onFocus={() => void loadChildren(top)}
                            onChange={(e) =>
                              choose(root.arrPath, e.currentTarget.value || top)
                            }
                          >
                            <option value="">{top}</option>
                            {(
                              children[top] ||
                              (selection.includes("/") ? [selection] : [])
                            ).map((child) => (
                              <option value={child}>{child}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </td>
                    <td data-label={t("Status")}>
                      <span class={"tag " + tone}>{label}</span>
                      {root.status === "resolved" && (
                        <small class="cell-sub">{root.shareDir}</small>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
