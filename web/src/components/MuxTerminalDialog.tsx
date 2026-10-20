import { useEffect, useRef, useState } from "preact/hooks";
import type { MuxJob } from "../types";
import { api } from "../api";
import { t } from "../i18n";
import { muxLogClass } from "../mux-spec";
import { notify } from "../notifications";
import { Modal } from "./Modal";
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
  });
  const offset = useRef(0),
    follow = useRef(true),
    pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (["queued", "running"].includes(job.status)) {
      offset.current = 0;
      setText("");
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const result = await api<{
          text: string;
          offset: number;
          running: boolean;
          progress: number;
        }>(`mux/jobs/log?id=${job.id}&offset=${offset.current}`);
        if (!live) return;
        const reset = result.offset < offset.current;
        offset.current = result.offset;
        setText((old) => (reset ? "" : old) + result.text);
        setState(result);
        timer = setTimeout(
          load,
          result.text.length >= 64000
            ? 0
            : result.running || job.status === "queued"
              ? 1000
              : 15000,
        );
      } catch {
        if (live) timer = setTimeout(load, 3000);
      }
    };
    load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [job.id, job.status]);
  useEffect(() => {
    if (follow.current && pre.current)
      pre.current.scrollTop = pre.current.scrollHeight;
  }, [text]);
  return (
    <Modal wide title={t("MKVToolNix log")} close={close}>
      <pre
        class="terminal"
        ref={pre}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        }}
      >
        <span>
          $ mkvmerge … {job.sourceName}
          {"\n\n"}
        </span>
        {text
          ? text.split("\n").map((line) => (
              <span class={muxLogClass(line)}>
                {line}
                {"\n"}
              </span>
            ))
          : t("No output yet.")}
      </pre>
      <p class="quiet" role="status">
        {state.running
          ? t("Running") + " · " + state.progress + " %"
          : t(job.status === "queued" ? "Waiting" : "Finished")}
      </p>
      <div class="row-actions">
        <button
          class="button"
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
        <button class="button" onClick={close}>
          {t("Close")}
        </button>
      </div>
    </Modal>
  );
}
