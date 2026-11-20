import { Play, Terminal } from "lucide-preact";
import { t, useI18n } from "../i18n";
import {
  fileCheckFixLabel,
  fileCheckKindHelp,
  fileCheckKindLabels,
  fileCheckModeText,
} from "../filecheck";
import { fileCheckStatusView } from "../tool-status";
import type { FileCheckItem, FileCheckSettings } from "../types";
import { compactBytes as bytes, ICON } from "../ui";
import { placementMessage } from "../placement-messages";
import { Modal, ModalFoot } from "./dialog/Modal";
import { KeyValues } from "./settings/KeyValues";
import { StatusTag } from "./tools/StatusTag";

// Details of one finding (Phase 5d, Task 10; E21): a v2 modal (md). The
// path, its kind as a tag and its status, what the kind means, the key
// values and the hints for a manual or failed finding; the foot has
// Terminal command, Close and Fix.
export function FileCheckDetailDialog({
  item,
  options,
  commands,
  close,
  fix,
  disabled,
}: {
  item: FileCheckItem;
  options: FileCheckSettings;
  fix: () => void;
  disabled: boolean;
  commands: () => void;
  close: () => void;
}) {
  useI18n();
  const target = item.dir ? options.dirMode : options.fileMode;
  const rows = [
    { key: "service", label: t("Service"), value: item.instance },
    {
      key: "current",
      label: t("Current permissions"),
      value: `${fileCheckModeText(item.mode, item.dir)} · ${item.uid}:${item.gid}`,
    },
    {
      key: "target",
      label: t("Target permissions"),
      value: `${fileCheckModeText(parseInt(target, 8), item.dir)} · ${options.ownerUid}:${options.ownerGid}`,
    },
    ...(item.dir
      ? []
      : [{ key: "size", label: t("Size"), value: bytes(item.size) }]),
    {
      key: "fix",
      label: t("Fix"),
      value: t(fileCheckFixLabel(item, options)),
    },
    ...(item.note
      ? [
          {
            key: "note",
            label: t("Note"),
            value: placementMessage(item.note, t),
          },
        ]
      : []),
  ];
  return (
    <Modal
      id="fileCheckDetails"
      title={item.title}
      close={close}
      foot={
        <ModalFoot>
          <button type="button" class="v2-btn" onClick={commands}>
            <Terminal size={ICON.label} />
            {t("Terminal command")}
          </button>
          <button type="button" class="v2-btn" onClick={close}>
            {t("Close")}
          </button>
          <button
            type="button"
            class="v2-btn v2-btn--primary"
            disabled={disabled}
            onClick={fix}
          >
            <Play size={ICON.label} />
            {t("Fix")}
          </button>
        </ModalFoot>
      }
    >
      <div class="v2-modal-stack">
        <div class="v2-card--inset v2-path">{item.rel}</div>
        <div class="v2-modal-line">
          <span class="v2-tag">{t(fileCheckKindLabels[item.kind])}</span>
          <StatusTag view={fileCheckStatusView(item, t)} />
        </div>
        <p class="v2-notice">{t(fileCheckKindHelp[item.kind])}</p>
        <KeyValues rows={rows} />
        {item.fix === "manual" && !item.note.includes("cannot assign") && (
          <p class="v2-notice v2-notice--warn">
            {t(
              "Scopearr runs without root and cannot change this item. Use the terminal command.",
            )}
          </p>
        )}
        {item.message && item.fix !== "manual" && (
          <p class="v2-notice">{t(item.message)}</p>
        )}
      </div>
    </Modal>
  );
}
