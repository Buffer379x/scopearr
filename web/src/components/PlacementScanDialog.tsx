import { useState } from "preact/hooks";
import { LoaderCircle, Pencil, ScanSearch } from "lucide-preact";
import { instanceLabel } from "../instances";
import { t, useI18n } from "../i18n";
import { ICON } from "../ui";
import type { ServiceInstance, UnraidSettings, UnraidStatus } from "../types";
import { Modal } from "./Modal";

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
      wide
      fitViewport
      title={t("Scan disk placement")}
      close={close}
      closeDisabled={busy}
      className="scan-dialog"
    >
      <div class="scan-dialog-body">
        <div class="scan-dialog-grid">
          <div class="scan-dialog-column">
            <section class="scan-dialog-section">
              <h3 class="card-title">{t("Services")}</h3>
              <div class="placement-options">
                {libraries.map((library) => (
                  <label class="check-field" key={library.id}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={options.libraries.includes(library.id)}
                      onChange={(event) =>
                        update({
                          libraries: event.currentTarget.checked
                            ? [...options.libraries, library.id]
                            : options.libraries.filter(
                                (id) => id !== library.id,
                              ),
                        })
                      }
                    />
                    {instanceLabel(library)}
                  </label>
                ))}
                {!libraries.length && (
                  <p class="quiet">{t("No enabled libraries")}</p>
                )}
              </div>
            </section>
            <section class="scan-dialog-section">
              <h3 class="card-title">{t("TV series")}</h3>
              <div class="placement-options">
                {(
                  [
                    ["series", "Group by series"],
                    ["season", "Group by season folder"],
                  ] as const
                ).map(([value, label]) => (
                  <label class="check-field" key={value}>
                    <input
                      type="radio"
                      name="placement-series-grouping"
                      disabled={busy}
                      checked={options.seriesGrouping === value}
                      onChange={() => update({ seriesGrouping: value })}
                    />
                    {t(label)}
                  </label>
                ))}
              </div>
            </section>
          </div>
          <div class="scan-dialog-column">
            <section class="scan-dialog-section">
              <h3 class="card-title">{t("Target disks")}</h3>
              <div class="placement-disk-summary">
                <div class="tag-list">
                  {includedDisks.map((disk) => (
                    <span
                      class="tag placement-disk-tag placement-disk-target"
                      key={disk.name}
                    >
                      {disk.name}
                    </span>
                  ))}
                  {!includedDisks.length && (
                    <span class="quiet">{t("No target disks")}</span>
                  )}
                </div>
                {arrayDisks.length > includedDisks.length && (
                  <small class="quiet">
                    {t("{count} excluded", {
                      count: arrayDisks.length - includedDisks.length,
                    })}
                  </small>
                )}
                <button
                  type="button"
                  class="icon-button"
                  aria-label={t("Edit target disks")}
                  title={t("Edit target disks")}
                  disabled={busy || !service?.disks.length}
                  onClick={editDisks}
                >
                  <Pencil size={ICON.button} />
                </button>
              </div>
              <div class="scan-dialog-fields">
                <label>
                  {t("Free space to keep on the target disk (GB)")}
                  <input
                    type="number"
                    min="0"
                    max="10240"
                    step="1"
                    disabled={busy}
                    value={
                      Number.isFinite(options.reserveGB)
                        ? options.reserveGB
                        : ""
                    }
                    onInput={(event) =>
                      update({ reserveGB: event.currentTarget.valueAsNumber })
                    }
                  />
                </label>
              </div>
            </section>
          </div>
        </div>
        {error && (
          <p class="notice" role="alert">
            {error}
          </p>
        )}
      </div>
      <div class="modal-actions">
        {disabledReason && (
          <p class="quiet scan-dialog-reason">{disabledReason}</p>
        )}

        <button type="button" class="button" disabled={busy} onClick={close}>
          {t("Cancel")}
        </button>
        <button
          type="button"
          class="button primary"
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
      </div>
    </Modal>
  );
}
