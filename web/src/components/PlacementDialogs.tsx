import { placementMessage } from "../placement-messages";
import { useEffect, useRef, useState } from "preact/hooks";
import { ArrowLeft, ArrowRight, Download } from "lucide-preact";
import { api } from "../api";
import { t, useI18n } from "../i18n";
import {
  placementDiskTone,
  placementDuration,
  placementItemStatus,
  placementStatusLabels,
  placementStatusShort,
  placementStatusTone,
} from "../placement";
import type {
  PlacementItem,
  PlacementScan,
  UnraidDisk,
  UnraidStatus,
} from "../types";
import { compactBytes as bytes, count } from "../ui";
import { Modal } from "./Modal";
import { DetailRow, PathCheckRow } from "./MuxPathDialog";

export function DiskTag({
  item,
  disk,
}: {
  item: Pick<PlacementItem, "disks" | "target">;
  disk: string;
}) {
  const tone = placementDiskTone(item, disk);
  return (
    <span
      class={"tag placement-disk-tag" + (tone ? " placement-disk-" + tone : "")}
    >
      {disk}
    </span>
  );
}
export function PlacementStatusTag({
  item,
}: {
  item: Pick<PlacementItem, "scanStatus" | "jobStatus" | "message">;
}) {
  const status = placementItemStatus(item);
  const long = t(placementStatusLabels[status] || status);
  return (
    <span
      class={"tag mux-status-" + (placementStatusTone[status] || "cancelled")}
      title={
        item.message ? long + " · " + placementMessage(item.message, t) : long
      }
    >
      {t(placementStatusShort[status] || status)}
    </span>
  );
}
export function PlacementSummaryDialog({
  scan,
  close,
  filter,
  select,
  busy,
}: {
  scan: PlacementScan;
  close: () => void;
  filter: (target: string) => void;
  select: (target: string) => void;
  busy: boolean;
}) {
  useI18n();
  return (
    <Modal
      wide
      title={t("Scan summary")}
      close={close}
      className="placement-summary"
    >
      <dl class="system-details">
        {[
          ["Items checked", count(scan.checked)],
          ["Several disks", count(scan.several)],
          ["Small files only", count(scan.smallFiles)],
          ["Move size", bytes(scan.moveBytes)],
          [
            "Estimated duration",
            "≈ " + placementDuration(scan.moveBytes / 100000000),
          ],
          ["Cannot move", count(scan.unstartable)],
        ].map(([label, value]) => (
          <div>
            <dt>{t(label)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3 class="card-title">{t("By target disk")}</h3>
      <div class="table-wrap">
        <table class="placement-summary-table">
          <thead>
            <tr>
              {[
                "Target",
                "Items",
                "Small files",
                "Media files",
                "Move size",
                "Sources",
                "Selection",
              ].map((label) => (
                <th scope="col">{t(label)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(scan.targets || []).map((group) => (
              <tr key={group.target} onClick={() => filter(group.target)}>
                <td>
                  <button class="button" onClick={() => filter(group.target)}>
                    {group.target}
                  </button>
                </td>
                <td>{count(group.items)}</td>
                <td>{count(group.smallFiles)}</td>
                <td>{count(group.mediaFiles)}</td>
                <td>{bytes(group.moveBytes)}</td>
                <td>
                  {Object.entries(group.sources)
                    .map(([name, size]) => `${name} ${bytes(size)}`)
                    .join(" · ")}
                </td>
                <td>
                  <button
                    class="button"
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation();
                      select(group.target);
                    }}
                  >
                    {t("Select all")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!scan.targets?.length && (
        <p class="quiet">{t("No moves can be started from this scan.")}</p>
      )}
      <p class="quiet">
        {t(
          "Estimate assumes 100 MB/s. Actual speed depends on the disks and verification.",
        )}
      </p>
      <div class="row-actions">
        <a class="button" href="/api/placement/export.csv" download>
          <Download size={15} />
          {t("Export CSV")}
        </a>
        <button class="button" onClick={close}>
          {t("Close")}
        </button>
      </div>
    </Modal>
  );
}
export function PlacementDetailDialog({
  item,
  disks,
  close,
}: {
  item: PlacementItem;
  disks: UnraidDisk[];
  close: () => void;
}) {
  useI18n();
  const names = Object.keys(item.disks || {});
  const [disk, setDisk] = useState(names[0] || ""),
    [page, setPage] = useState(1);
  const files = (item.files || []).filter((f) => f.disk === disk && !f.dir),
    pages = Math.max(1, Math.ceil(files.length / 100));
  const target = disks.find((d) => d.name === item.target);
  return (
    <Modal
      wide
      title={
        item.season === -1
          ? item.title.replace(/ · Series folder$/, " · " + t("Series folder"))
          : item.title
      }
      close={close}
      className="placement-details"
    >
      <div class="filename-box">
        <code>{item.rel}</code>
      </div>
      <div class="mux-check-list">
        <DetailRow label={t("Target")} value={item.target || "—"} />
        <DetailRow label={t("Move size")} value={bytes(item.moveBytes)} />
        {target && item.jobStatus && item.jobStatus !== "queued" && (
          <DetailRow label={t("Free space")} value={bytes(target.free)} />
        )}
        {target && (!item.jobStatus || item.jobStatus === "queued") && (
          <>
            <DetailRow
              label={t("Target free space before")}
              value={bytes(target.free)}
            />
            <DetailRow
              label={t("Target free space after")}
              value={bytes(Math.max(0, target.free - item.moveBytes))}
            />
          </>
        )}
      </div>
      <div
        class="statistics-scopes placement-detail-disks"
        role="tablist"
        aria-label={t("Disks")}
      >
        {names.map((name) => (
          <button
            role="tab"
            aria-selected={disk === name}
            class={disk === name ? "active" : ""}
            onClick={() => {
              setDisk(name);
              setPage(1);
            }}
          >
            {name} · {bytes(item.disks[name].bytes)}
          </button>
        ))}
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t("Relative path")}</th>
              <th scope="col">{t("Size")}</th>
              <th scope="col">{t("Placement")}</th>
            </tr>
          </thead>
          <tbody>
            {files.slice((page - 1) * 100, page * 100).map((f) => (
              <tr>
                <td class="placement-file-path">{f.rel}</td>
                <td>{bytes(f.size)}</td>
                <td class="placement-file-move">
                  {item.target ? (
                    <>
                      {t(f.disk === item.target ? "Stays on" : "Moves to")}{" "}
                      <DiskTag item={item} disk={item.target} />
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!files.length && <p class="quiet">{t("No files on this disk")}</p>}
      <div class="pagination">
        <span>{t("{count} files", { count: count(files.length) })}</span>
        <div>
          <button
            class="icon-button"
            disabled={page <= 1}
            aria-label={t("Previous page")}
            onClick={() => setPage(page - 1)}
          >
            <ArrowLeft size={16} />
          </button>
          {t("Page {page} / {pages}", { page, pages })}
          <button
            class="icon-button"
            disabled={page >= pages}
            aria-label={t("Next page")}
            onClick={() => setPage(page + 1)}
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
      {item.warnings?.length > 0 && (
        <section>
          <h3>{t("Warnings")}</h3>
          <ul>
            {item.warnings.map((message) => (
              <li>{placementMessage(message, t)}</li>
            ))}
          </ul>
        </section>
      )}
      <div class="row-actions">
        <button class="button" onClick={close}>
          {t("Close")}
        </button>
      </div>
    </Modal>
  );
}
export function PlacementStatusDialog({
  item,
  service,
  busy,
  recheck,
  close,
}: {
  item: PlacementItem;
  service?: UnraidStatus;
  busy: boolean;
  recheck: () => void;
  close: () => void;
}) {
  useI18n();
  const c = item.check,
    state = c?.state || service?.state;
  return (
    <Modal title={t("Status")} close={close} className="mux-status-dialog">
      <div class="settings-section">
        <div class="filename-box">
          <code>{item.rel}</code>
        </div>
        <p class="placement-status-line">
          <PlacementStatusTag item={item} />{" "}
          <span class="quiet">
            {t(
              placementStatusLabels[placementItemStatus(item)] ||
                item.scanStatus,
            )}
          </span>
        </p>
        {item.message && (
          <p class="notice">{placementMessage(item.message, t)}</p>
        )}
        <div class="mux-check-list">
          <PathCheckRow
            ok={c?.reachable ?? !!service?.ready}
            label={t("Unraid reachable")}
          />
          {(
            [
              ["writable", "Target writable"],
              ["freeSpace", "Enough free space"],
              ["unchanged", "Files unchanged since scan"],
              ["noConflict", "No conflicts"],
              ["owner", "Owner 99:100"],
            ] as const
          ).map(([key, label]) => (
            <PathCheckRow
              ok={!!c?.[key]}
              warning={!c}
              label={t(label)}
              detail={!c ? t("Not checked") : undefined}
            />
          ))}
          <PathCheckRow
            ok={!!state?.known && !state.mover && !state.parity}
            warning={!state?.known}
            label={t("Mover / parity state")}
            detail={t(
              state?.mover
                ? "Mover is running"
                : state?.parity
                  ? "Parity operation in progress"
                  : state?.known
                    ? "Idle"
                    : "Mover/parity state unknown",
            )}
          />
        </div>
        <p class="quiet">
          {t("Check again refreshes the plan before any move.")}
        </p>
        <div class="row-actions">
          <button class="button" disabled={busy} onClick={recheck}>
            {t("Check again")}
          </button>
          <button class="button" onClick={close}>
            {t("Close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
export function PlacementLogDialog({
  item,
  close,
}: {
  item: PlacementItem;
  close: () => void;
}) {
  useI18n();
  const [text, setText] = useState(""),
    [state, setState] = useState({
      running: item.jobStatus === "running",
      queued: item.jobStatus === "queued",
      progress: item.progress,
      message: item.message,
    });
  const offset = useRef(0),
    follow = useRef(true),
    pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const load = async () => {
      try {
        const next = await api<{
          text: string;
          offset: number;
          running: boolean;
          queued: boolean;
          progress: number;
          message: string;
        }>(
          `placement/items/${item.id}/log?offset=${offset.current}`,
          "GET",
          undefined,
          controller.signal,
        );
        if (!live) return;
        const reset = next.offset < offset.current;
        offset.current = next.offset;
        setText((old) => ((reset ? "" : old) + next.text).slice(-(256 << 10)));
        setState(next);
        timer = setTimeout(
          load,
          next.text.length >= 64000
            ? 0
            : next.running || next.queued
              ? 1000
              : 10000,
        );
      } catch {
        if (live) timer = setTimeout(load, 10000);
      }
    };
    load();
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [item.id]);
  useEffect(() => {
    if (follow.current && pre.current)
      pre.current.scrollTop = pre.current.scrollHeight;
  }, [text]);
  return (
    <Modal wide title={t("Disk placement log")} close={close}>
      <pre
        class="terminal"
        ref={pre}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        }}
      >
        {text || t("No output yet.")}
      </pre>
      <p class="quiet" role="status">
        {placementMessage(
          state.message ||
            (state.running ? "Moving" : state.queued ? "Waiting" : "Finished"),
          t,
        )}
        {state.running ? ` · ${state.progress} %` : ""}
      </p>
      <div class="row-actions">
        <button class="button" onClick={close}>
          {t("Close")}
        </button>
      </div>
    </Modal>
  );
}
