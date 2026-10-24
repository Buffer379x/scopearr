import { ICON } from "../ui";
import { placementMessage } from "../placement-messages";
import { HardDrive, LoaderCircle } from "lucide-preact";
import { useState } from "preact/hooks";
import { api } from "../api";
import { t, useI18n } from "../i18n";
import { defaultUnraidSettings } from "../placement";
import type {
  Settings,
  UnraidPathChecks,
  UnraidSettings as UnraidConfig,
} from "../types";
import { compactBytes as bytes } from "../ui";
import { HelpPopover } from "./HelpPopover";
import { Modal } from "./Modal";
import { PathCheckRow } from "./MuxPathDialog";
import { UnraidShares } from "./UnraidShares";
export function UnraidSettings({
  cfg,
  demo,
  change,
}: {
  cfg: Settings;
  demo: boolean;
  change: (next: UnraidConfig) => void;
}) {
  useI18n();
  const value = cfg.unraid || defaultUnraidSettings;
  const [busy, setBusy] = useState(false),
    [checks, setChecks] = useState<UnraidPathChecks>();
  const edit = (patch: Partial<UnraidConfig>) => change({ ...value, ...patch });
  const missing = !cfg.mux?.enabled || !cfg.mux?.mappings.trim();
  return (
    <section
      class="connection unraid-settings"
      id="service-settings-panel-unraid"
      aria-labelledby="service-settings-tab-unraid"
      role="tabpanel"
    >
      <header class="connection-heading card-heading">
        <h3 class="card-title">
          <HardDrive size={ICON.button} />
          {t("Unraid")}
        </h3>
        <div class="card-actions">
          <button
            type="button"
            class="button"
            disabled={demo || busy || missing}
            onClick={async () => {
              setBusy(true);
              try {
                setChecks(
                  await api<UnraidPathChecks>("unraid/check", "POST", value),
                );
              } catch {
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <LoaderCircle size={ICON.label} class="spin" />}
            {t("Check paths")}
          </button>
        </div>
      </header>
      <p class="quiet">
        {t("Inspect disk placement and bring split media folders together.")}
      </p>
      <label class="check-field">
        <input
          type="checkbox"
          disabled={demo}
          checked={value.enabled}
          onChange={(e) => edit({ enabled: e.currentTarget.checked })}
        />
        {t("Enable Unraid disk placement")}
      </label>
      {missing && (
        <p class="notice">
          {t("Enable the MKVToolNix service and configure path mappings first")}
        </p>
      )}
      <div class="unraid-path-fields">
        {(
          [
            [
              "diskRoot",
              "Disk root",
              "/unraid",
              "Mount host /mnt to /unraid. Scanning needs read access; moving and same-disk mux output need write access for UID 99 / GID 100.",
            ],
            [
              "shareRoot",
              "User share root",
              "/media",
              "Use the existing /mnt/user mount. Copy and link operations always use physical disks exclusively.",
            ],
            [
              "stateDir",
              "Unraid state directory (optional)",
              "/unraid-state",
              "Optionally mount /var/local/emhttp read-only to /unraid-state. Never mount /var/run. State updates can be delayed.",
            ],
          ] as const
        ).map(([key, label, placeholder, help]) => (
          <label key={key}>
            <span class="field-label">
              {t(label)} <HelpPopover label={label} text={help} />
            </span>
            <input
              disabled={demo}
              value={value[key]}
              placeholder={placeholder}
              onInput={(e) => edit({ [key]: e.currentTarget.value })}
            />
          </label>
        ))}
      </div>
      <label class="check-field">
        <input
          type="checkbox"
          disabled={demo}
          checked={value.muxSameDisk}
          onChange={(e) => edit({ muxSameDisk: e.currentTarget.checked })}
        />
        {t("Write mux output to the original's disk")}
      </label>
      <UnraidShares
        value={value}
        mappings={cfg.mux?.mappings || ""}
        demo={demo}
        change={(shareDirs) => edit({ shareDirs })}
      />

      {checks && (
        <Modal
          wide
          title={t("Unraid path check")}
          close={() => setChecks(undefined)}
        >
          <div class="mux-check-list">
            <PathCheckRow
              ok={checks.root}
              label={t("Unraid disks reachable")}
              detail={t("{arrays} array disks · {pools} pools", {
                arrays: checks.disks.filter((d) => d.kind === "array").length,
                pools: checks.disks.filter((d) => d.kind === "pool").length,
              })}
            />
            <PathCheckRow ok={checks.share} label={t("User share reachable")} />
            <PathCheckRow
              ok={checks.checked > 0 && checks.found === checks.checked}
              warning={checks.checked === 0}
              label={t("Share and disk sample")}
              detail={t("{found}/{checked} found on a disk", {
                found: checks.found,
                checked: checks.checked,
              })}
            />
            {checks.disks.map((d) => (
              <PathCheckRow
                key={d.name}
                ok={d.writable}
                warning
                label={d.name}
                detail={t("{space} free", { space: bytes(d.free) })}
              />
            ))}
            <PathCheckRow
              ok={checks.state.known}
              warning
              label={t("Mover / parity state")}
              detail={t(
                checks.state.mover
                  ? "Mover is running"
                  : checks.state.parity
                    ? "Parity operation in progress"
                    : checks.state.known
                      ? "Idle"
                      : "Mover/parity state unknown",
              )}
            />
          </div>
          {checks.error && (
            <p class="notice" role="alert">
              {t(checks.error)}
            </p>
          )}
          {checks.warnings.map((v) => (
            <p class="quiet">{placementMessage(v, t)}</p>
          ))}
          <div class="row-actions">
            <button class="button" onClick={() => setChecks(undefined)}>
              {t("Close")}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
