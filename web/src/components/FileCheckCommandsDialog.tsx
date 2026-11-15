import { useRef, useState } from "preact/hooks";
import { Copy, Download } from "lucide-preact";
import { t, useI18n } from "../i18n";
import { ICON } from "../ui";
import { Modal, ModalFoot } from "./dialog/Modal";
import { Terminal } from "./dialog/Terminal";

export function downloadFileCheckScript(text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/x-shellscript;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "scopearr-filecheck.sh";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Terminal commands (Phase 5d, Task 10; E21): a v2 modal (lg). The shown
// script (the first 50 lines of a long one) in a Terminal that starts at its
// top; the foot has, on its left, the script for every match, on its right
// Copy, Download script (.sh) and Close.
export function FileCheckCommandsDialog({
  text,
  hostPaths,
  total,
  downloadAll,
  busy = false,
  close,
}: {
  text: string;
  hostPaths: boolean;
  total: number;
  downloadAll: () => unknown;
  busy?: boolean;
  close: () => void;
}) {
  useI18n();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const lines = text.trimEnd().split("\n");
  const preview = lines.length > 500;
  return (
    <Modal
      id="fileCheckCommands"
      title={t("Terminal commands")}
      close={close}
      foot={
        <ModalFoot wrap>
          <button
            type="button"
            class="v2-btn v2-modal-foot-first"
            disabled={busy || !total}
            onClick={downloadAll}
          >
            <Download size={ICON.label} />
            {t("Download script for all {count} matches", { count: total })}
          </button>
          {text && (
            <>
              <button
                type="button"
                class="v2-btn"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(text);
                    setCopied(true);
                    setCopyFailed(false);
                  } catch {
                    if (preview) {
                      setCopyFailed(true);
                      return;
                    }
                    const range = document.createRange();
                    const pre = box.current?.querySelector("pre");
                    if (pre) range.selectNodeContents(pre);
                    getSelection()?.removeAllRanges();
                    getSelection()?.addRange(range);
                  }
                }}
              >
                <Copy size={ICON.label} />
                {t(copied ? "Copied" : "Copy")}
              </button>
              <button
                type="button"
                class="v2-btn"
                onClick={() => downloadFileCheckScript(text)}
              >
                <Download size={ICON.label} />
                {t("Download script (.sh)")}
              </button>
            </>
          )}
          <button type="button" class="v2-btn" onClick={close}>
            {t("Close")}
          </button>
        </ModalFoot>
      }
    >
      <div class="v2-modal-stack" ref={box}>
        {!text ? (
          <p class="v2-modal-hint">
            {t(
              "No findings selected. The script for all matches covers {count} findings in the current filter.",
              { count: total },
            )}
          </p>
        ) : (
          <>
            <p class="v2-modal-hint">
              {t(
                hostPaths
                  ? "Review these commands and run them in the Unraid terminal. Scopearr does not run them."
                  : "These are container paths. Replace /media with the host path of your media mount before running them.",
              )}
            </p>
            {preview && (
              <p class="v2-notice">
                {t(
                  "Showing the first 50 of {count} lines. Copy or download the complete script.",
                  { count: lines.length },
                )}
              </p>
            )}
            <Terminal label={t("Terminal")} text={text} follow={false}>
              {preview ? lines.slice(0, 50).join("\n") : text}
            </Terminal>
            {copyFailed && (
              <p class="v2-notice v2-notice--error" role="alert">
                {t("Copy failed. Download the complete script instead.")}
              </p>
            )}
            <p class="v2-modal-hint">
              {t(
                "For whole shares use Unraid Tools → Docker Safe New Permissions.",
              )}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
