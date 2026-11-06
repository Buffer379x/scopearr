import { Play, Terminal } from "lucide-preact";
import { t, useI18n } from "../i18n";
import {
  fileCheckFixLabel,
  fileCheckKindHelp,
  fileCheckKindLabels,
  fileCheckModeText,
  fileCheckStatus,
  fileCheckStatusLabels,
  fileCheckStatusTone,
} from "../filecheck";
import type { FileCheckItem, FileCheckSettings } from "../types";
import { compactBytes as bytes, ICON } from "../ui";
import { placementMessage } from "../placement-messages";
import { Modal } from "./Modal";
import { DetailRow } from "./MuxPathDialog";

export function FileCheckStatusTag({
  item,
}: {
  item: Pick<FileCheckItem, "jobStatus" | "fix" | "message">;
}) {
  const status = fileCheckStatus(item);
  return (
    <span
      class={"tag status-" + (fileCheckStatusTone[status] || "neutral")}
      title={item.message ? t(item.message) : undefined}
    >
      {t(fileCheckStatusLabels[status] || status)}
    </span>
  );
}

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
  return (
    <Modal title={item.title} close={close} className="filecheck-details">
      <div class="filename-box">
        <code>{item.rel}</code>
      </div>
      <p class="placement-status-line">
        <span class="tag">{t(fileCheckKindLabels[item.kind])}</span>{" "}
        <FileCheckStatusTag item={item} />
      </p>
      <div class="notice filecheck-reason">
        {t(fileCheckKindHelp[item.kind])}
      </div>
      <div class="mux-check-list">
        <DetailRow label={t("Service")} value={item.instance} />
        <DetailRow
          label={t("Current permissions")}
          value={`${fileCheckModeText(item.mode, item.dir)} · ${item.uid}:${item.gid}`}
        />
        <DetailRow
          label={t("Target permissions")}
          value={`${fileCheckModeText(parseInt(target, 8), item.dir)} · ${options.ownerUid}:${options.ownerGid}`}
        />
        {!item.dir && <DetailRow label={t("Size")} value={bytes(item.size)} />}
        <DetailRow
          label={t("Fix")}
          value={t(fileCheckFixLabel(item, options))}
        />
        {item.note && (
          <DetailRow label={t("Note")} value={placementMessage(item.note, t)} />
        )}
      </div>
      {item.fix === "manual" && !item.note.includes("cannot assign") && (
        <p class="notice">
          {t(
            "Scopearr runs without root and cannot change this item. Use the terminal command.",
          )}
        </p>
      )}
      {item.message && item.fix !== "manual" && (
        <p class="notice">{t(item.message)}</p>
      )}
      <div class="modal-actions">
        <button class="button" onClick={commands}>
          <Terminal size={ICON.label} />
          {t("Terminal command")}
        </button>
        <button class="button" onClick={close}>
          {t("Close")}
        </button>
        <button
          class="button primary mobile-row-action"
          disabled={disabled}
          onClick={fix}
        >
          <Play size={ICON.label} />
          {t("Fix")}
        </button>
      </div>
    </Modal>
  );
}
