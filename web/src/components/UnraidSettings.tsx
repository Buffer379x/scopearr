import { FileCheckNamesDialog } from "./FileCheckNamesDialog";
import { defaultFileCheckSettings } from "../filecheck";
import { HardDrive, LoaderCircle, Pencil } from "lucide-preact";
import { ICON } from "../ui";
import { useEffect, useRef, useState } from "preact/hooks";
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
import { moverKey, unraidHead } from "../settings-model";
import { UnraidPathCheckDialog } from "./dialog/UnraidPathCheckDialog";
import { UnraidShares } from "./UnraidShares";
import { ServiceCard, ServiceSection } from "./settings/ServiceCard";
import { ServiceStatus, StatusValue } from "./settings/ServiceStatus";
import { field } from "./settings/Field";
import { check } from "./settings/Check";
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
    [checks, setChecks] = useState<UnraidPathChecks>(),
    checkButton = useRef<HTMLButtonElement>(null);
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
          ref={checkButton}
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
          ).map(([key, label, placeholder, help]) =>
            field(
              "unraid-" + key,
              t(label),
              (a) => (
                <input
                  {...a}
                  class="v2-input"
                  disabled={demo}
                  value={value[key]}
                  placeholder={placeholder}
                  onInput={(e) => edit({ [key]: e.currentTarget.value })}
                />
              ),
              { hint: t(help), key },
            ),
          )}
        </div>
        {check(
          t("Write mux output to the original's disk"),
          value.muxSameDisk,
          (muxSameDisk) => edit({ muxSameDisk }),
          demo,
        )}
        {check(
          t("Verify copies with checksums (slower)"),
          value.verifyChecksum,
          (verifyChecksum) => edit({ verifyChecksum }),
          demo,
        )}
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
            ).map(([key, label]) =>
              field(
                "unraid-" + key,
                t(label),
                (a) => (
                  <input
                    {...a}
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
                ),
                { key },
              ),
            )}
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
        <UnraidPathCheckDialog
          checks={checks}
          close={() => setChecks(undefined)}
          returnFocus={() => checkButton.current}
        />
      )}
    </ServiceCard>
  );
}
