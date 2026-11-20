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
import { Modal, ModalFoot } from "./dialog/Modal";
import { HelpTip } from "./list/HelpTip";
import { check } from "./settings/Check";
import { field } from "./settings/Field";

// Scan files & permissions (Phase 5d, Task 10; E21): a v2 modal (lg) in two
// columns (the services and checks | the target owner and permissions and
// fixing). The foot sticks: on its left the reason the scan cannot start
// (one line, always there, so nothing moves), on its right Cancel and Scan.

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
      id="fileCheckScan"
      title={t("Scan files & permissions")}
      close={close}
      closeDisabled={busy}
      fitViewport
      foot={
        <ModalFoot
          lead={
            <span
              title={
                fixesActive ? t("Finish or cancel fixes first") : undefined
              }
              data-reason=""
            >
              {fixesActive ? t("Finish or cancel fixes first") : ""}
            </span>
          }
        >
          <button type="button" class="v2-btn" disabled={busy} onClick={close}>
            {t("Cancel")}
          </button>
          <button
            type="button"
            class="v2-btn v2-btn--primary"
            disabled={busy || fixesActive || scanning}
            title={fixesActive ? t("Finish or cancel fixes first") : undefined}
            onClick={submit}
          >
            {busy ? (
              <LoaderCircle class="v2-spin" size={ICON.label} />
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
            {libraries.map((c) =>
              check(
                instanceLabel(c),
                draft.libraries.includes(c.id),
                (on) => edit({ libraries: toggle(draft.libraries, c.id, on) }),
                busy,
                c.id,
              ),
            )}
            {!libraries.length && (
              <p class="v2-modal-hint">{t("No enabled libraries")}</p>
            )}
            {attempted && !selectedLibraries.length && (
              <p class="v2-notice v2-notice--warn" role="alert">
                {t("Select at least one library")}
              </p>
            )}
          </section>
          <section class="v2-modal-sec">
            <h3 class="v2-modal-h">{t("Checks")}</h3>
            {fileCheckKinds.map((kind) =>
              check(
                t(fileCheckKindLabels[kind]),
                draft.kinds.includes(kind),
                (on) => edit({ kinds: toggle(draft.kinds, kind, on) }),
                busy,
                kind,
              ),
            )}
            {attempted && !draft.kinds.length && (
              <p class="v2-notice v2-notice--warn" role="alert">
                {t("Select at least one check")}
              </p>
            )}
            <button
              type="button"
              class="v2-text-btn"
              disabled={busy}
              onClick={openNames}
            >
              {t("Allowed and ignored names in Settings")}
            </button>
          </section>
        </div>
        <div class="v2-modal-col">
          <section class="v2-modal-sec">
            <h3 class="v2-modal-h">{t("Target owner")}</h3>
            <div class="v2-modal-pair">
              {(
                [
                  ["ownerUid", "Owner UID", "filecheck-owner-uid"],
                  ["ownerGid", "Owner GID", "filecheck-owner-gid"],
                ] as const
              ).map(([key, label, id]) =>
                field(
                  id,
                  t(label),
                  (a) => (
                    <input
                      {...a}
                      class="v2-input"
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
                  ),
                  { key },
                ),
              )}
            </div>
            <small class="v2-modal-hint">
              {t("Default from Settings")}: {ownerUid}:{ownerGid}
            </small>
            {customOwner && (
              <button
                type="button"
                class="v2-text-btn"
                disabled={busy}
                onClick={() => edit({ ownerUid, ownerGid })}
              >
                {t("Reset to default")}
              </button>
            )}
          </section>
          <section class="v2-modal-sec">
            <h3 class="v2-modal-h">{t("Target permissions")}</h3>
            <div
              class="v2-modal-sec"
              role="radiogroup"
              aria-label={t("Target permissions")}
            >
              {[
                ...fileCheckModePresets,
                { key: "custom", label: "Custom values" },
              ].map((p) => (
                <label class="v2-ff-check" key={p.key}>
                  <input
                    type="radio"
                    class="v2-check"
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
              <div class="v2-modal-pair">
                {(
                  [
                    ["fileMode", "File mode", "0664", "filecheck-file-mode"],
                    ["dirMode", "Folder mode", "0775", "filecheck-dir-mode"],
                  ] as const
                ).map(([key, label, placeholder, id]) =>
                  field(
                    id,
                    t(label),
                    (a) => (
                      <input
                        {...a}
                        class="v2-input"
                        disabled={busy}
                        value={draft[key]}
                        placeholder={placeholder}
                        inputMode="numeric"
                        pattern="0?[0-7]{3}"
                        onInput={(e) =>
                          edit({ [key]: e.currentTarget.value.trim() })
                        }
                      />
                    ),
                    { key },
                  ),
                )}
              </div>
            )}
            <div class="v2-modal-line">
              {check(
                t("Report any deviation from the target permissions"),
                draft.strict,
                (on) => edit({ strict: on }),
                busy,
              )}
              <HelpTip
                label="Report any deviation from the target permissions"
                text="Without this option, permissions only count as a finding when Scopearr cannot read or write the file. The target permissions are always used when fixing."
              />
            </div>
          </section>
          <section class="v2-modal-sec">
            <h3 class="v2-modal-h">{t("Fixing")}</h3>
            {check(
              t("Take ownership of files by copying them on the same disk"),
              draft.takeOwnership && physical,
              (on) => edit({ takeOwnership: on }),
              busy || !physical,
            )}
            {check(
              t("Include video files (slower)"),
              draft.includeVideo,
              (on) => edit({ includeVideo: on }),
              busy || !physical || !draft.takeOwnership,
            )}
            {!physical && (
              <p class="v2-modal-hint">
                {t("Taking ownership needs the Unraid disk placement service.")}
              </p>
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
