import { FileCheckNamesDialog } from "./FileCheckNamesDialog";
import { defaultFileCheckSettings } from "../filecheck";
import { HardDrive, LoaderCircle, Pencil } from "lucide-preact";
import { ICON } from "../ui";
import { placementMessage } from "../placement-messages";
import { useState, useEffect } from "preact/hooks";
import { api } from "../api";
import { t, useI18n } from "../i18n";
import { defaultUnraidSettings } from "../placement";
import type {
  Settings,
  FileCheckSettings,
  Status,
  UnraidPathChecks,
  UnraidSettings as UnraidConfig,
  UnraidStatus,
} from "../types";
import { compactBytes as bytes } from "../ui";
import { moverKey, unraidHead } from "../settings-model";
import { Modal } from "./Modal";
import { PathCheckRow } from "./MuxPathDialog";
import { UnraidShares } from "./UnraidShares";
import { ServiceCard, ServiceSection } from "./settings/ServiceCard";
import { ServiceStatus, StatusValue } from "./settings/ServiceStatus";
import type { ToolStatusView } from "../tool-status";

// The Unraid card (docs/STYLEGUIDE.md, Part 1, 10.11): its status first,
// read once per opening (ruling R-J: unraid/status, which reads var.ini
// and the disks' fill and wakes no disk; it reports the saved settings,
// ruling M10), then Paths, Files & permissions and Shares; Check paths in
// its head opens the 1.7.0 dialog. Its head goes to the tab's dot
// (report), from the same read.
export function UnraidSettings({
  cfg,
  demo,
  change,
  changeFileCheck,
  report,
}: {
  cfg: Settings;
  demo: boolean;
  change: (next: UnraidConfig) => void;
  changeFileCheck: (next: FileCheckSettings) => void;
  report?: (head: ToolStatusView) => void;
}) {
  useI18n();
  const value = cfg.unraid || defaultUnraidSettings;
  const [busy, setBusy] = useState(false),
    [checks, setChecks] = useState<UnraidPathChecks>();
  const [namesOpen, setNamesOpen] = useState(false);
  const fileCheck = cfg.fileCheck || defaultFileCheckSettings;
  const [status, setStatus] = useState<Status>();
  const [unraid, setUnraid] = useState<UnraidStatus | null>(null);
  useEffect(() => {
    api<Status>("status")
      .then(setStatus)
      .catch(() => {});
    const controller = new AbortController();
    api<UnraidStatus>("unraid/status", "GET", undefined, controller.signal, {
      notifyErrors: false,
    })
      .then(setUnraid)
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const head = unraidHead(unraid, unraid ? unraid.enabled : value.enabled, t);
  useEffect(() => {
    report?.(head);
  }, [head.tone, head.text, head.long]);
  const edit = (patch: Partial<UnraidConfig>) => change({ ...value, ...patch });
  return (
    <ServiceCard
      id="unraid"
      icon={<HardDrive size={ICON.button} />}
      name={t("Unraid")}
      status={head}
      actions={
        <button
          type="button"
          class="v2-btn"
          disabled={demo || busy}
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
          <span class="v2-btn-icon" aria-hidden="true">
            {busy ? (
              <LoaderCircle class="v2-spin" size={ICON.button} />
            ) : (
              <HardDrive size={ICON.button} />
            )}
          </span>
          {t("Check paths")}
        </button>
      }
      active={{
        label: t("Enable Unraid disk placement"),
        checked: value.enabled,
        disabled: demo,
        change: (enabled) => edit({ enabled }),
      }}
    >
      <ServiceSection title={t("Status")}>
        <ServiceStatus
          kind="unraid"
          values={{
            status: unraid && <StatusValue view={head} />,
            mover: unraid && t(moverKey(unraid.state)),
            disks:
              unraid &&
              t("{arrays} array disks · {pools} pools", {
                arrays: unraid.disks.filter((d) => d.kind === "array").length,
                pools: unraid.disks.filter((d) => d.kind === "pool").length,
              }),
          }}
        />
        <small>
          {t("Inspect disk placement and bring split media folders together.")}
        </small>
      </ServiceSection>
      <ServiceSection title={t("Paths")}>
        <div class="v2-form">
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
            <div class="v2-field" key={key}>
              <label for={"unraid-" + key}>{t(label)}</label>
              <input
                id={"unraid-" + key}
                class="v2-input"
                aria-describedby={"unraid-" + key + "-hint"}
                disabled={demo}
                value={value[key]}
                placeholder={placeholder}
                onInput={(e) => edit({ [key]: e.currentTarget.value })}
              />
              <small id={"unraid-" + key + "-hint"}>{t(help)}</small>
            </div>
          ))}
        </div>
        <label class="v2-ff-check">
          <input
            type="checkbox"
            class="v2-check"
            disabled={demo}
            checked={value.muxSameDisk}
            onChange={(e) => edit({ muxSameDisk: e.currentTarget.checked })}
          />
          {t("Write mux output to the original's disk")}
        </label>
        <label class="v2-ff-check">
          <input
            type="checkbox"
            class="v2-check"
            disabled={demo}
            checked={value.verifyChecksum}
            onChange={(e) => edit({ verifyChecksum: e.currentTarget.checked })}
          />
          {t("Verify copies with checksums (slower)")}
        </label>
      </ServiceSection>
      <ServiceSection title={t("Files & permissions")}>
        <small>
          {t(
            "Default owner for the Files & permissions check. Disk placement copies stay owned by Scopearr's container user.",
          )}
        </small>
        <div class="v2-mode" role="group" aria-labelledby="unraid-owner">
          <span id="unraid-owner">{t("Default owner")}</span>
          <div>
            {(
              [
                ["ownerUid", "Owner UID"],
                ["ownerGid", "Owner GID"],
              ] as const
            ).map(([key, label]) => (
              <div class="v2-field" key={key}>
                <label for={"unraid-" + key}>{t(label)}</label>
                <input
                  id={"unraid-" + key}
                  class="v2-input"
                  type="number"
                  min={0}
                  max={65535}
                  step={1}
                  disabled={demo}
                  value={value[key] ?? defaultUnraidSettings[key]}
                  onInput={(e) =>
                    edit({ [key]: e.currentTarget.valueAsNumber })
                  }
                />
              </div>
            ))}
          </div>
          {status?.processUid !== undefined &&
            status?.processGid !== undefined && (
              <small>
                {t("Scopearr runs as {uid}:{gid}", {
                  uid: status.processUid,
                  gid: status.processGid,
                })}
              </small>
            )}
        </div>
        <div class="v2-mode" role="group" aria-labelledby="unraid-names">
          <span id="unraid-names">{t("Allowed and ignored names")}</span>
          <div>
            {t("{allowed} allowed · {ignored} ignored", {
              allowed: fileCheck.allowed.length,
              ignored: fileCheck.ignore.length,
            })}
            <button
              type="button"
              class="v2-btn v2-btn--sm"
              disabled={demo}
              onClick={() => setNamesOpen(true)}
            >
              <Pencil size={ICON.button} />
              {t("Edit")}
            </button>
          </div>
          <small>{t("Changes apply to the next scan.")}</small>
        </div>
      </ServiceSection>
      {namesOpen && (
        <FileCheckNamesDialog
          options={fileCheck}
          disabled={demo}
          save={(allowed, ignore) =>
            changeFileCheck({ ...fileCheck, allowed, ignore })
          }
          close={() => setNamesOpen(false)}
        />
      )}
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
    </ServiceCard>
  );
}
