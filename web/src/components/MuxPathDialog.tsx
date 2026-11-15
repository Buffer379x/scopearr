import type { ComponentChildren } from "preact";
import { ICON } from "../ui";
import { Check, TriangleAlert, X } from "lucide-preact";
import { t } from "../i18n";
import { bytes } from "../ui";
import type { MuxPathChecks } from "../types";
import { CheckRow } from "./dialog/CheckRow";
import { Modal, ModalFoot } from "./dialog/Modal";
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
          <Check size={ICON.button} />
        ) : warning ? (
          <TriangleAlert size={ICON.button} />
        ) : (
          <X size={ICON.button} />
        )}
      </span>
      <span>{label}</span>
      <small>{detail || t(ok ? "Ready" : "Needs attention")}</small>
    </div>
  );
}
export function DetailRow({
  label,
  value,
}: {
  label: string;
  value: ComponentChildren;
}) {
  return (
    <dl class="key-values">
      <div>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    </dl>
  );
}
export function pathAttention(c: MuxPathChecks) {
  return (
    Number(!c.syntax.ok) +
    Number(!!c.timedOut) +
    c.errors.length +
    c.mappings.filter(
      (v) => !(v.exists && v.isDir && v.readable && (c.readOnly || v.writable)),
    ).length +
    c.rootFolders.filter((v) => !v.mapped || !v.localExists).length +
    c.samples.filter(
      (v) =>
        !v.checked || v.checked !== v.reachable || v.checked !== v.sizeMatches,
    ).length +
    Number(
      !c.readOnly &&
        c.workDir.configured &&
        !(c.workDir.exists && c.workDir.writable),
    )
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
      id="pathCheck"
      title={t("Path check")}
      close={close}
      foot={
        <ModalFoot>
          <button type="button" class="v2-btn" onClick={close}>
            {t("Close")}
          </button>
        </ModalFoot>
      }
    >
      <section class="v2-modal-sec">
        <h3 class="v2-modal-h">{t("Mappings")}</h3>
        <CheckRow
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
          <CheckRow
            ok={
              v.exists && v.isDir && v.readable && (!!c.readOnly || v.writable)
            }
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
                      : c.readOnly
                        ? t("Ready")
                        : !v.writable
                          ? t("Not writable for UID 99")
                          : t("{space} free", { space: bytes(v.freeBytes) })
            }
          />
        ))}
        {!c.mappings.length && (
          <p class="v2-modal-hint">{t("No path mappings configured")}</p>
        )}
      </section>
      <section class="v2-modal-sec">
        <h3 class="v2-modal-h">{t("Root folders in Radarr/Sonarr")}</h3>
        {c.rootFolders.map((v) => (
          <CheckRow
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
          <CheckRow ok={false} warning label={v.instance} detail={t(v.error)} />
        ))}
      </section>
      <section class="v2-modal-sec">
        <h3 class="v2-modal-h">{t("Sample files")}</h3>
        {c.samples.map((v) => (
          <CheckRow
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
      </section>
      {!c.readOnly && (
        <section class="v2-modal-sec">
          <h3 class="v2-modal-h">{t("Muxing directory")}</h3>
          <CheckRow
            ok={
              !c.workDir.configured || (c.workDir.exists && c.workDir.writable)
            }
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
        </section>
      )}
      {c.timedOut && (
        <p class="v2-notice">{t("Path check timed out. Try again.")}</p>
      )}
    </Modal>
  );
}
