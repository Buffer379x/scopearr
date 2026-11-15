import { useState } from "preact/hooks";
import { LoaderCircle, Pencil, ScanSearch } from "lucide-preact";
import { instanceLabel } from "../instances";
import { t, useI18n } from "../i18n";
import { ICON } from "../ui";
import type { ServiceInstance, UnraidSettings, UnraidStatus } from "../types";
import { Modal, ModalFoot } from "./dialog/Modal";
import { RowButton } from "./list/RowButton";
import { check } from "./settings/Check";
import { field } from "./settings/Field";

// Scan disk placement (Phase 5d, Task 9; E20, R-O): a v2 modal (lg) in two
// columns (the services and the TV series grouping | the target disks, as the
// accent disk tag, and the free space to keep). The foot sticks: on its left the reason the scan
// cannot start, else the mover or parity note (one line, always there, so
// nothing moves when the status polls), on its right Cancel and Scan.

export function PlacementScanDialog({
  libraries,
  options,
  service,
  busy,
  active,
  update,
  editDisks,
  start,
  close,
}: {
  libraries: ServiceInstance[];
  options: UnraidSettings;
  service?: UnraidStatus;
  busy: boolean;
  active: boolean;
  update: (patch: Partial<UnraidSettings>) => void;
  editDisks: () => void;
  start: () => Promise<void>;
  close: () => void;
}) {
  useI18n();
  const [error, setError] = useState("");
  const arrayDisks = (service?.disks || []).filter(
    (disk) => disk.kind === "array",
  );
  const includedDisks = arrayDisks.filter(
    (disk) => !options.excludedDisks.includes(disk.name),
  );
  const disabledReason = active
    ? t("Finish or cancel moves first")
    : !service?.ready
      ? t(
          service?.error ||
            "Enable the MKVToolNix service and configure path mappings first",
        )
      : "";
  // Why a scan waits for the mover or a parity operation (Design 9).
  const note = disabledReason
    ? ""
    : service?.state?.mover
      ? t("Mover is running")
      : service?.state?.parity
        ? t("Parity operation in progress")
        : "";
  const reason = disabledReason || note;
  const submit = async () => {
    setError("");
    try {
      await start();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Modal
      id="placementScan"
      title={t("Scan disk placement")}
      close={close}
      closeDisabled={busy}
      fitViewport
      foot={
        <ModalFoot
          lead={
            <span title={reason || undefined} data-reason="">
              {reason}
            </span>
          }
        >
          <button type="button" class="v2-btn" disabled={busy} onClick={close}>
            {t("Cancel")}
          </button>
          <button
            type="button"
            class="v2-btn v2-btn--primary"
            disabled={busy || !!disabledReason}
            title={disabledReason || undefined}
            onClick={submit}
          >
            {busy ? (
              <LoaderCircle class="spin" size={ICON.label} />
            ) : (
              <ScanSearch size={ICON.label} />
            )}
            {t("Scan")}
          </button>
        </ModalFoot>
      }
    >
      <div class="v2-modal-cols">
        <div class="v2-modal-col">
          <section class="v2-modal-sec">
            <h3 class="v2-modal-h">{t("Services")}</h3>
            {libraries.map((library) =>
              check(
                instanceLabel(library),
                options.libraries.includes(library.id),
                (on) =>
                  update({
                    libraries: on
                      ? [...options.libraries, library.id]
                      : options.libraries.filter((id) => id !== library.id),
                  }),
                busy,
                library.id,
              ),
            )}
            {!libraries.length && (
              <p class="v2-modal-hint">{t("No enabled libraries")}</p>
            )}
          </section>
          <section class="v2-modal-sec">
            <h3 class="v2-modal-h">{t("TV series")}</h3>
            {(
              [
                ["series", "Group by series"],
                ["season", "Group by season folder"],
              ] as const
            ).map(([value, label]) => (
              <label class="v2-ff-check" key={value}>
                <input
                  type="radio"
                  class="v2-check"
                  name="placement-series-grouping"
                  disabled={busy}
                  checked={options.seriesGrouping === value}
                  onChange={() => update({ seriesGrouping: value })}
                />
                {t(label)}
              </label>
            ))}
          </section>
        </div>
        <div class="v2-modal-col">
          <section class="v2-modal-sec">
            <h3 class="v2-modal-h">{t("Target disks")}</h3>
            <div class="v2-modal-row v2-modal-disk-row">
              <div class="v2-modal-tags">
                {includedDisks.map((disk) => (
                  <span
                    class="v2-tag v2-tag--disk"
                    data-disk=""
                    key={disk.name}
                  >
                    {disk.name}
                  </span>
                ))}
                {!includedDisks.length && (
                  <span class="v2-modal-hint">{t("No target disks")}</span>
                )}
              </div>
              {arrayDisks.length > includedDisks.length && (
                <small class="v2-modal-hint">
                  {t("{count} excluded", {
                    count: arrayDisks.length - includedDisks.length,
                  })}
                </small>
              )}
              <RowButton
                label={t("Edit target disks")}
                icon={<Pencil size={ICON.button} />}
                disabled={busy || !service?.disks.length}
                onClick={editDisks}
              />
            </div>
            {field(
              "placement-reserve",
              t("Free space to keep on the target disk (GB)"),
              (a) => (
                <input
                  {...a}
                  class="v2-input"
                  type="number"
                  min="0"
                  max="10240"
                  step="1"
                  disabled={busy}
                  value={
                    Number.isFinite(options.reserveGB) ? options.reserveGB : ""
                  }
                  onInput={(event) =>
                    update({ reserveGB: event.currentTarget.valueAsNumber })
                  }
                />
              ),
            )}
          </section>
        </div>
      </div>
      {error && (
        <p class="v2-notice v2-notice--error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
