import { Check, AlertTriangle, X } from "lucide-preact";
import { t } from "../i18n";
import { bytes } from "../ui";
import type { MuxPathChecks } from "../types";
import { Modal } from "./Modal";
export function PathCheckRow({
  ok,
  label,
  detail,
  warning = false,
}: {
  ok: boolean;
  label: string;
  detail?: string;
  warning?: boolean;
}) {
  return (
    <div class="path-check-row">
      <span class={ok ? "check-ok" : warning ? "check-warning" : "check-error"}>
        {ok ? (
          <Check size={16} />
        ) : warning ? (
          <AlertTriangle size={16} />
        ) : (
          <X size={16} />
        )}
      </span>
      <span>{label}</span>
      <small>{detail || t(ok ? "Ready" : "Needs attention")}</small>
    </div>
  );
}
export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div class="path-check-row detail-row">
      <span />
      <span>{label}</span>
      <small>{value}</small>
    </div>
  );
}
export function pathAttention(c: MuxPathChecks) {
  return (
    Number(!c.syntax.ok) +
    Number(!!c.timedOut) +
    c.errors.length +
    c.mappings.filter((v) => !(v.exists && v.isDir && v.readable && v.writable))
      .length +
    c.rootFolders.filter((v) => !v.mapped || !v.localExists).length +
    c.samples.filter(
      (v) =>
        !v.checked || v.checked !== v.reachable || v.checked !== v.sizeMatches,
    ).length +
    Number(c.workDir.configured && !(c.workDir.exists && c.workDir.writable))
  );
}
export function MuxPathDialog({
  checks: c,
  close,
}: {
  checks: MuxPathChecks;
  close: () => void;
}) {
  return (
    <Modal
      wide
      className="mux-path-dialog"
      title={t("Path check")}
      close={close}
    >
      <h4>{t("Mappings")}</h4>
      <PathCheckRow
        ok={c.syntax.ok}
        label={t("Mapping syntax")}
        detail={
          c.syntax.ok
            ? t("Ready")
            : t("Line {line}: {error}", {
                line: c.syntax.line || 1,
                error: t(c.syntax.error || ""),
              })
        }
      />
      {c.mappings.map((v) => (
        <PathCheckRow
          ok={v.exists && v.isDir && v.readable && v.writable}
          label={v.arrPath + " → " + v.localPath}
          detail={
            v.error
              ? t(v.error)
              : !v.exists
                ? t("Directory not found")
                : !v.isDir
                  ? t("Not a directory")
                  : !v.readable
                    ? t("Not readable")
                    : !v.writable
                      ? t("Not writable for UID 99")
                      : t("{space} free", { space: bytes(v.freeBytes) })
          }
        />
      ))}
      {!c.mappings.length && (
        <p class="quiet">{t("No path mappings configured")}</p>
      )}
      <h4>{t("Root folders in Radarr/Sonarr")}</h4>
      {c.rootFolders.map((v) => (
        <PathCheckRow
          ok={v.mapped && v.localExists}
          warning
          label={v.arrPath + " · " + v.instances.join(", ")}
          detail={t(
            !v.mapped
              ? "Not mapped"
              : v.localExists
                ? "Ready"
                : "Directory not found",
          )}
        />
      ))}
      {c.errors.map((v) => (
        <PathCheckRow
          ok={false}
          warning
          label={v.instance}
          detail={t(v.error)}
        />
      ))}
      <h4>{t("Sample files")}</h4>
      {c.samples.map((v) => (
        <PathCheckRow
          ok={
            v.checked > 0 &&
            v.checked === v.reachable &&
            v.checked === v.sizeMatches
          }
          warning
          label={v.instance}
          detail={
            v.checked
              ? t(
                  "{reachable} / {checked} reachable · {matches} size matches",
                  {
                    reachable: v.reachable,
                    checked: v.checked,
                    matches: v.sizeMatches,
                  },
                )
              : t("No cached files")
          }
        />
      ))}
      <h4>{t("Muxing directory")}</h4>
      <PathCheckRow
        ok={!c.workDir.configured || (c.workDir.exists && c.workDir.writable)}
        label={t(
          c.workDir.configured
            ? "Separate directory"
            : "Same folder as the media file",
        )}
        detail={
          !c.workDir.configured
            ? t("Checked with the media mappings")
            : !c.workDir.exists
              ? t("Directory not found")
              : !c.workDir.writable
                ? t("Not writable for UID 99")
                : t("{space} free", { space: bytes(c.workDir.freeBytes) })
        }
      />
      {c.timedOut && (
        <p class="notice">{t("Path check timed out. Try again.")}</p>
      )}
      <div class="row-actions">
        <button class="button" onClick={close}>
          {t("Close")}
        </button>
      </div>
    </Modal>
  );
}
