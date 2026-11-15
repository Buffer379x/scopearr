import { usePolling } from "../hooks/usePolling";
import { useEffect, useRef, useState } from "preact/hooks";
import type { MuxJob } from "../types";
import { api } from "../api";
import { t } from "../i18n";
import { muxLogClass } from "../mux-spec";
import { notify } from "../notifications";
import { percent } from "../ui";
import { Modal, ModalFoot } from "./dialog/Modal";
import { Terminal } from "./dialog/Terminal";
import { ProgressCell } from "./tools/ProgressCell";

// The v2 line class of each 1.7.0 one muxLogClass still returns.
const LINE: Record<string, string> = {
  "terminal-warning": "v2-code-warn",
  "terminal-error": "v2-code-error",
  "terminal-success": "v2-code-ok",
};

// MKVToolNix log (Phase 5d, Task 8; E19): a v2 modal (lg, fixed height) with
// the terminal, which follows new output only at its end, and in the foot a
// status line (the progress and its text) with Copy log and Close.
export function MuxTerminalDialog({
  job,
  close,
}: {
  job: MuxJob;
  close: () => void;
}) {
  const [text, setText] = useState("");
  const [state, setState] = useState({
    running: job.status === "running",
    progress: job.progress,
    message: job.message,
  });
  const offset = useRef(0);
  useEffect(() => {
    if (["queued", "running"].includes(job.status)) {
      offset.current = 0;
      setText("");
    }
  }, [job.id, job.status]);
  usePolling(
    async (signal) => {
      const result = await api<{
        text: string;
        offset: number;
        running: boolean;
        progress: number;
        message: string;
      }>(
        `mux/jobs/log?id=${job.id}&offset=${offset.current}`,
        "GET",
        undefined,
        signal,
      );
      if (signal.aborted) return;
      const reset = result.offset < offset.current;
      offset.current = result.offset;
      setText((old) => (reset ? "" : old) + result.text);
      setState(result);
      return result;
    },
    (result) =>
      result
        ? result.text.length >= 64000
          ? 0
          : result.running || job.status === "queued"
            ? 1000
            : 15000
        : 3000,
    [job.id, job.status],
  );
  const running = state.running,
    waiting = !running && job.status === "queued";
  return (
    <Modal
      id="muxLog"
      title={t("MKVToolNix log")}
      close={close}
      foot={
        <ModalFoot
          lead={
            <span class="v2-modal-status" role="status">
              {(running || waiting) && (
                <ProgressCell
                  status={running ? "running" : "queued"}
                  value={state.progress}
                  label={t("Progress")}
                />
              )}
              {running
                ? t(state.message || job.message || "Running") +
                  " · " +
                  percent(state.progress)
                : t(waiting ? "Waiting" : "Finished")}
            </span>
          }
        >
          <button
            type="button"
            class="v2-btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                notify(t("Log copied"));
              } catch {
                notify(t("Could not copy log"), "error");
              }
            }}
          >
            {t("Copy log")}
          </button>
          <button type="button" class="v2-btn" onClick={close}>
            {t("Close")}
          </button>
        </ModalFoot>
      }
    >
      <Terminal label={t("Terminal")} text={text}>
        <span>
          $ mkvmerge … {job.sourceName}
          {"\n\n"}
        </span>
        {text
          ? text.split("\n").map((line) => (
              <span class={LINE[muxLogClass(line)]}>
                {line}
                {"\n"}
              </span>
            ))
          : t("No output yet.")}
      </Terminal>
    </Modal>
  );
}
