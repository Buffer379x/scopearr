import { LoaderCircle, RefreshCw } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useTableOverflow } from "../hooks/useTableOverflow";
import { api } from "../api";
import { t, useI18n } from "../i18n";
import type { ToolStatusView } from "../tool-status";
import type { PlacementRootFolder, UnraidSettings } from "../types";
import { ICON } from "../ui";
import { ServiceSection } from "./settings/ServiceCard";
import { StatusTag } from "./tools/StatusTag";

type ShareRoots = {
  rootFolders: PlacementRootFolder[];
  choices: string[];
  error?: string;
};

// Shows only root folders reported by enabled Radarr/Sonarr services. Choosing a
// share folder associates an existing root; it never adds scan scope. The
// Shares section of the Unraid card (docs/STYLEGUIDE.md, Part 1, 10.11): a
// v2 table in an inset card, whose rows become cards on narrow cards
// (10.10); it scrolls sideways only while it is wider than its card.
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
  const scroll = useRef<HTMLDivElement>(null);
  const overflow = useTableOverflow(scroll);
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
  const status = (root: PlacementRootFolder): ToolStatusView => {
    const [tone, text]: [ToolStatusView["tone"], string] =
      root.status === "resolved"
        ? ["ok", t("Resolved")]
        : root.status === "disabled"
          ? ["neutral", t("Not scanned")]
          : ["warn", t("Not resolved")];
    return { tone, text, long: text };
  };
  return (
    <ServiceSection
      title={t("Shares")}
      actions={
        <button
          type="button"
          class="v2-icon-btn v2-icon-btn--sm"
          disabled={demo || busy}
          aria-label={t("Refresh shares")}
          title={t("Refresh shares")}
          onClick={() => void load()}
        >
          {busy ? (
            <LoaderCircle size={ICON.button} class="v2-spin" />
          ) : (
            <RefreshCw size={ICON.button} />
          )}
        </button>
      }
    >
      <small>
        {t(
          "Disk placement scans the share folders of these Radarr/Sonarr root folders directly on the disks. Other shares are never scanned.",
        )}
      </small>
      {roots?.error && (
        <p class="v2-notice v2-notice--error">{t(roots.error)}</p>
      )}
      {roots && !roots.rootFolders.length ? (
        <small>{t("No root folders reported by enabled services.")}</small>
      ) : (
        <div class="v2-table-card v2-card--inset">
          <div
            ref={scroll}
            class="v2-table-scroll"
            data-overflow={overflow ? "" : undefined}
            tabIndex={overflow ? 0 : undefined}
            role={overflow ? "region" : undefined}
            aria-label={overflow ? t("Shares") : undefined}
          >
            <table class="v2-table">
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
                  const showNested =
                    nested[root.arrPath] || selection.includes("/");
                  return (
                    <tr key={root.arrPath} class="v2-row">
                      <td data-label={t("Root folder")}>
                        <span class="v2-table-mono">{root.arrPath}</span>
                      </td>
                      <td data-label={t("Instances")}>
                        {root.instances.join(", ")}
                      </td>
                      <td data-label={t("Share folder")}>
                        <div class="v2-table-items">
                          <select
                            class="v2-select"
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
                              class="v2-text-btn"
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
                              class="v2-select"
                              aria-label={t("Subfolder for {path}", {
                                path: root.arrPath,
                              })}
                              disabled={demo}
                              value={selection.includes("/") ? selection : ""}
                              onFocus={() => void loadChildren(top)}
                              onChange={(e) =>
                                choose(
                                  root.arrPath,
                                  e.currentTarget.value || top,
                                )
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
                        <div class="v2-table-items">
                          <StatusTag view={status(root)} />
                          {root.status === "resolved" && (
                            <span class="v2-table-sub">{root.shareDir}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ServiceSection>
  );
}
