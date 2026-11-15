import type { JSX } from "preact";
import { t } from "../../i18n";
import type { UnraidDisk } from "../../types";
import { compactBytes as bytes } from "../../ui";
import { check } from "../settings/Check";
import { Modal, ModalFoot } from "./Modal";

// Target disks (Phase 5d, Task 9; E20): a v2 modal (md) with one row per
// disk: an array disk with its checkbox (checked = a target), a pool as a
// plain line, then its usage bar (named by its disk, as in 1.7.0) and what
// is used and free.
export function TargetDisksDialog({
  disks,
  excluded,
  busy,
  change,
  close,
}: {
  disks: UnraidDisk[];
  excluded: string[];
  busy: boolean;
  change(excluded: string[]): void;
  close(): void;
}): JSX.Element {
  return (
    <Modal
      id="targetDisks"
      title={t("Target disks")}
      close={close}
      foot={
        <ModalFoot>
          <button type="button" class="v2-btn" onClick={close}>
            {t("Done")}
          </button>
        </ModalFoot>
      }
    >
      <ul class="v2-modal-list v2-modal-disks">
        {disks.map((d) => (
          <li key={d.name}>
            {d.kind === "array" ? (
              check(
                d.name,
                !excluded.includes(d.name),
                (on) =>
                  change(
                    on
                      ? excluded.filter((name) => name !== d.name)
                      : [...excluded, d.name],
                  ),
                busy,
              )
            ) : (
              <span class="v2-modal-hint">
                {d.name} · {t("Pool (not a target)")}
              </span>
            )}
            <div
              class="v2-disk-bar"
              role="img"
              aria-label={t("Used space on {disk}", { disk: d.name })}
              style={{
                "--v": String(
                  Math.round(((d.total - d.free) / (d.total || 1)) * 100),
                ),
              }}
            >
              <span />
            </div>
            <small class="v2-modal-hint">
              {bytes(d.total - d.free)} / {bytes(d.total)} ·{" "}
              {t("{space} free", { space: bytes(d.free) })}
            </small>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
