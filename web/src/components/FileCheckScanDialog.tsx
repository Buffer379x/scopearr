import { useState } from "preact/hooks";
import { ScanSearch, LoaderCircle } from "lucide-preact";
import { t, useI18n } from "../i18n";
import { ICON } from "../ui";
import {
  defaultFileCheckSettings,
  fileCheckKinds,
  fileCheckKindLabels,
  fileCheckModePresets,
} from "../filecheck";
import { instancesOf, instanceLabel } from "../instances";
import type { FileCheckSettings, Settings } from "../types";
import { HelpPopover } from "./HelpPopover";
import { Modal } from "./Modal";

export function FileCheckScanDialog({
  settings,
  options,
  physical,
  fixesActive,
  scanning,
  start,
  openNames,
  close,
}: {
  settings: Settings | null;
  options: FileCheckSettings;
  physical: boolean;
  fixesActive: boolean;
  scanning: boolean;
  start: (next: FileCheckSettings) => Promise<void>;
  openNames: () => void;
  close: () => void;
}) {
  useI18n();
  const [draft, setDraft] = useState<FileCheckSettings>({
    ...options,
    libraries: options.libraries.length
      ? options.libraries
      : settings
        ? instancesOf(settings)
            .filter(
              (c) => c.enabled && (c.type === "radarr" || c.type === "sonarr"),
            )
            .map((c) => c.id)
        : [],
  });
  const [preset, setPreset] = useState<string>(
    () =>
      fileCheckModePresets.find(
        (p) => p.file === options.fileMode && p.dir === options.dirMode,
      )?.key || "custom",
  );
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const libraries = settings
    ? instancesOf(settings).filter(
        (c) => c.enabled && (c.type === "radarr" || c.type === "sonarr"),
      )
    : [];
  const ownerUid =
    settings?.unraid?.ownerUid ?? defaultFileCheckSettings.ownerUid;
  const ownerGid =
    settings?.unraid?.ownerGid ?? defaultFileCheckSettings.ownerGid;
  const customOwner =
    draft.ownerUid !== ownerUid || draft.ownerGid !== ownerGid;
  const edit = (patch: Partial<FileCheckSettings>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const toggle = <T,>(values: T[], value: T, checked: boolean) =>
    checked ? [...values, value] : values.filter((v) => v !== value);
  const selectedLibraries = libraries.filter((c) =>
    draft.libraries.includes(c.id),
  );
  const submit = async () => {
    setAttempted(true);
    setError("");
    if (!selectedLibraries.length || !draft.kinds.length) return;
    setBusy(true);
    try {
      await start({
        ...draft,
        libraries: libraries.every((c) => draft.libraries.includes(c.id))
          ? []
          : selectedLibraries.map((c) => c.id),
        allowed:
          settings?.fileCheck?.allowed || defaultFileCheckSettings.allowed,
        ignore: settings?.fileCheck?.ignore || defaultFileCheckSettings.ignore,
      });
    } catch (error) {
      setError(error instanceof Error ? t(error.message) : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      wide
      className="scan-dialog"
      title={t("Scan files & permissions")}
      close={close}
      closeDisabled={busy}
    >
      <div class="scan-dialog-body">
        <div class="scan-dialog-grid">
          <div class="scan-dialog-column">
            <section class="scan-dialog-section">
              <h3 class="card-title">{t("Services")}</h3>
              <div class="scan-dialog-checks">
                {libraries.map((c) => (
                  <label class="check-field" key={c.id}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={draft.libraries.includes(c.id)}
                      onChange={(e) =>
                        edit({
                          libraries: toggle(
                            draft.libraries,
                            c.id,
                            e.currentTarget.checked,
                          ),
                        })
                      }
                    />
                    {instanceLabel(c)}
                  </label>
                ))}
              </div>
              {!libraries.length && (
                <p class="quiet">{t("No enabled libraries")}</p>
              )}
              {attempted && !selectedLibraries.length && (
                <p class="notice" role="alert">
                  {t("Select at least one library")}
                </p>
              )}
            </section>
            <section class="scan-dialog-section">
              <h3 class="card-title">{t("Checks")}</h3>
              <div class="scan-dialog-checks">
                {fileCheckKinds.map((kind) => (
                  <label class="check-field" key={kind}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={draft.kinds.includes(kind)}
                      onChange={(e) =>
                        edit({
                          kinds: toggle(
                            draft.kinds,
                            kind,
                            e.currentTarget.checked,
                          ),
                        })
                      }
                    />
                    {t(fileCheckKindLabels[kind])}
                  </label>
                ))}
              </div>
              {attempted && !draft.kinds.length && (
                <p class="notice" role="alert">
                  {t("Select at least one check")}
                </p>
              )}
              <button
                type="button"
                class="text-button"
                disabled={busy}
                onClick={openNames}
              >
                {t("Allowed and ignored names in Settings")}
              </button>
            </section>
          </div>
          <div class="scan-dialog-column">
            <section class="scan-dialog-section">
              <h3 class="card-title">{t("Target owner")}</h3>
              <div class="scan-dialog-fields">
                {(
                  [
                    ["ownerUid", "Owner UID"],
                    ["ownerGid", "Owner GID"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    <span>{t(label)}</span>
                    <input
                      type="number"
                      min={0}
                      max={65535}
                      step={1}
                      disabled={busy}
                      value={draft[key]}
                      onInput={(e) =>
                        edit({ [key]: e.currentTarget.valueAsNumber })
                      }
                    />
                  </label>
                ))}
              </div>
              <em class="cell-hint">
                {t("Default from Settings")}: {ownerUid}:{ownerGid}
              </em>
              {customOwner && (
                <button
                  type="button"
                  class="text-button"
                  disabled={busy}
                  onClick={() => edit({ ownerUid, ownerGid })}
                >
                  {t("Reset to default")}
                </button>
              )}
            </section>
            <section class="scan-dialog-section">
              <h3 class="card-title">{t("Target permissions")}</h3>
              <div
                class="scan-dialog-radios"
                role="radiogroup"
                aria-label={t("Target permissions")}
              >
                {[
                  ...fileCheckModePresets,
                  { key: "custom", label: "Custom values" },
                ].map((p) => (
                  <label class="check-field" key={p.key}>
                    <input
                      type="radio"
                      name="filecheck-mode-preset"
                      disabled={busy}
                      checked={preset === p.key}
                      onChange={() => {
                        setPreset(p.key);
                        if ("file" in p)
                          edit({ fileMode: p.file, dirMode: p.dir });
                      }}
                    />
                    {t(p.label)}
                  </label>
                ))}
              </div>
              {preset === "custom" && (
                <div class="scan-dialog-fields">
                  {(
                    [
                      ["fileMode", "File mode", "0664"],
                      ["dirMode", "Folder mode", "0775"],
                    ] as const
                  ).map(([key, label, placeholder]) => (
                    <label key={key}>
                      <span>{t(label)}</span>
                      <input
                        disabled={busy}
                        value={draft[key]}
                        placeholder={placeholder}
                        inputMode="numeric"
                        pattern="0?[0-7]{3}"
                        onInput={(e) =>
                          edit({ [key]: e.currentTarget.value.trim() })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
              <label class="check-field">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={draft.strict}
                  aria-label={t(
                    "Report any deviation from the target permissions",
                  )}
                  onChange={(e) => edit({ strict: e.currentTarget.checked })}
                />
                <span>
                  {t("Report any deviation from the target permissions")}{" "}
                  <HelpPopover
                    label="Report any deviation from the target permissions"
                    text="Without this option, permissions only count as a finding when Scopearr cannot read or write the file. The target permissions are always used when fixing."
                  />
                </span>
              </label>
            </section>
            <section class="scan-dialog-section">
              <h3 class="card-title">{t("Fixing")}</h3>
              <label class="check-field">
                <input
                  type="checkbox"
                  disabled={busy || !physical}
                  checked={draft.takeOwnership && physical}
                  onChange={(e) =>
                    edit({ takeOwnership: e.currentTarget.checked })
                  }
                />
                {t("Take ownership of files by copying them on the same disk")}
              </label>
              <label class="check-field">
                <input
                  type="checkbox"
                  disabled={busy || !physical || !draft.takeOwnership}
                  checked={draft.includeVideo}
                  onChange={(e) =>
                    edit({ includeVideo: e.currentTarget.checked })
                  }
                />
                {t("Include video files (slower)")}
              </label>
              {!physical && (
                <p class="quiet">
                  {t(
                    "Taking ownership needs the Unraid disk placement service.",
                  )}
                </p>
              )}
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
        {fixesActive && (
          <p class="quiet scan-dialog-reason">
            {t("Finish or cancel fixes first")}
          </p>
        )}

        <button type="button" class="button" disabled={busy} onClick={close}>
          {t("Cancel")}
        </button>
        <button
          type="button"
          class="button primary"
          disabled={busy || fixesActive || scanning}
          title={fixesActive ? t("Finish or cancel fixes first") : undefined}
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
