import type { JSX } from "preact";
import { t, useI18n } from "../../i18n";
import { placementMessage } from "../../placement-messages";
import type { UnraidPathChecks } from "../../types";
import { compactBytes as bytes } from "../../ui";
import { CheckRow } from "./CheckRow";
import { Modal, ModalFoot } from "./Modal";

// Unraid path check (Phase 5d, Task 11, E22; moved out of UnraidSettings):
// a v2 modal (md) of check rows (disks, user share, the share and disk
// sample, each disk, the mover and parity state), the error as an alert
// notice and the warnings as hints; the foot holds Close.
export function UnraidPathCheckDialog({
  checks,
  close,
  returnFocus,
}: {
  checks: UnraidPathChecks;
  close(): void;
  // Check paths, locked while it ran (R-D).
  returnFocus?(): HTMLElement | null;
}): JSX.Element {
  useI18n();
  const { state } = checks;
  return (
    <Modal
      id="unraidPathCheck"
      title={t("Unraid path check")}
      close={close}
      returnFocus={returnFocus}
      foot={
        <ModalFoot>
          <button type="button" class="v2-btn" onClick={close}>
            {t("Close")}
          </button>
        </ModalFoot>
      }
    >
      <div class="v2-modal-stack">
        <div class="v2-modal-sec">
          <CheckRow
            ok={checks.root}
            label={t("Unraid disks reachable")}
            detail={t("{arrays} array disks · {pools} pools", {
              arrays: checks.disks.filter((d) => d.kind === "array").length,
              pools: checks.disks.filter((d) => d.kind === "pool").length,
            })}
          />
          <CheckRow ok={checks.share} label={t("User share reachable")} />
          <CheckRow
            ok={checks.checked > 0 && checks.found === checks.checked}
            warning={checks.checked === 0}
            label={t("Share and disk sample")}
            detail={t("{found}/{checked} found on a disk", {
              found: checks.found,
              checked: checks.checked,
            })}
          />
          {checks.disks.map((d) => (
            <CheckRow
              key={d.name}
              ok={d.writable}
              warning
              label={d.name}
              detail={t("{space} free", { space: bytes(d.free) })}
            />
          ))}
          <CheckRow
            ok={state.known}
            warning
            label={t("Mover / parity state")}
            detail={t(
              state.mover
                ? "Mover is running"
                : state.parity
                  ? "Parity operation in progress"
                  : state.known
                    ? "Idle"
                    : "Mover/parity state unknown",
            )}
          />
        </div>
        {checks.error && (
          <p class="v2-notice v2-notice--error" role="alert">
            {t(checks.error)}
          </p>
        )}
        {checks.warnings.map((v, i) => (
          <p class="v2-modal-hint" key={i}>
            {placementMessage(v, t)}
          </p>
        ))}
      </div>
    </Modal>
  );
}
