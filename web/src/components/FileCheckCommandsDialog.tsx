import { useRef, useState } from "preact/hooks";
import { Copy, Download } from "lucide-preact";
import { t, useI18n } from "../i18n";
import { ICON } from "../ui";
import { Modal } from "./Modal";

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

export function FileCheckCommandsDialog({
  text,
  hostPaths,
  close,
}: {
  text: string;
  hostPaths: boolean;
  close: () => void;
}) {
  useI18n();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const pre = useRef<HTMLPreElement>(null);
  const lines = text.trimEnd().split("\n");
  const preview = lines.length > 500;
  return (
    <Modal wide title={t("Terminal commands")} close={close}>
      <p class="quiet">
        {t(
          hostPaths
            ? "Review these commands and run them in the Unraid terminal. Scopearr does not run them."
            : "These are container paths. Replace /media with the host path of your media mount before running them.",
        )}
      </p>
      {preview && (
        <p class="notice">
          {t(
            "Showing the first 50 of {count} lines. Copy or download the complete script.",
            { count: lines.length },
          )}
        </p>
      )}
      <pre class="terminal" ref={pre}>
        {preview ? lines.slice(0, 50).join("\n") : text}
      </pre>
      {copyFailed && (
        <p class="notice" role="alert">
          {t("Copy failed. Download the complete script instead.")}
        </p>
      )}
      <p class="quiet">
        {t("For whole shares use Unraid Tools → Docker Safe New Permissions.")}
      </p>
      <div class="modal-actions">
        <button
          type="button"
          class="button"
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
              if (pre.current) range.selectNodeContents(pre.current);
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
          class="button"
          onClick={() => downloadFileCheckScript(text)}
        >
          <Download size={ICON.label} />
          {t("Download script (.sh)")}
        </button>
        <button type="button" class="button" onClick={close}>
          {t("Close")}
        </button>
      </div>
    </Modal>
  );
}
