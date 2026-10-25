import {
  SortableHeader,
  nextTableSort,
  type TableSort,
} from "./SortableHeader";
import { percent } from "../ui";
import { ICON, Tooltip, SegmentedTabs } from "../ui";
import { placementMessage } from "../placement-messages";
import { useEffect, useRef, useState } from "preact/hooks";
import { Play, Terminal, ArrowLeft, ArrowRight, Download } from "lucide-preact";
import { api } from "../api";
import { t, useI18n } from "../i18n";
import {
  placementCompact,
  placementCheckBlocker,
  placementDiskTone,
  placementDuration,
  placementItemStatus,
  placementStatusLabels,
  placementStatusDescriptions,
  placementStatusShort,
  placementStatusTone,
} from "../placement";
import type {
  PlacementItem,
  PlacementReport,
  PlacementScan,
  UnraidDisk,
  UnraidStatus,
} from "../types";
import { compactBytes as bytes, count } from "../ui";
import { RootScanNotice } from "./RootCoverage";
import { Modal } from "./Modal";
import { DetailRow, PathCheckRow } from "./MuxPathDialog";

export function DiskTag({
  item,
  disk,
  focusable = true,
}: {
  item: Pick<PlacementItem, "disks" | "target"> &
    Partial<Pick<PlacementItem, "scanStatus">>;
  disk: string;
  focusable?: boolean;
}) {
  const tone = placementDiskTone(item, disk);
  const stats = item.disks?.[disk] || { bytes: 0, files: 0, dirs: 0 };
  const content = placementCompact(item) ? (
    <>{t("Located on {disk}", { disk })}</>
  ) : (
    <>
      {disk} · {t(disk === item.target ? "Target disk" : "Source disk")} ·{" "}
      {bytes(stats.bytes)} · {t("{count} files", { count: stats.files })}
      {stats.dirs > 0 && <> · {t("{count} folders", { count: stats.dirs })}</>}
    </>
  );
  const tag = (
    <span
      tabIndex={focusable ? 0 : undefined}
      class={"tag placement-disk-tag" + (tone ? " placement-disk-" + tone : "")}
    >
      {disk}
    </span>
  );
  return focusable ? <Tooltip content={content}>{tag}</Tooltip> : tag;
}
export function PlacementStatusTag({
  item,
}: {
  item: Pick<PlacementItem, "scanStatus" | "jobStatus" | "message"> &
    Partial<Pick<PlacementItem, "check">>;
}) {
  const status = placementItemStatus(item);
  const blocker = placementCheckBlocker(item.check);
  const long = t(
    placementStatusDescriptions[status] ||
      placementStatusLabels[status] ||
      status,
  );
  return (
    <span
      class={
        "tag dot-trigger status-" + (placementStatusTone[status] || "neutral")
      }
      title={
        blocker
          ? t("Last check: {blocker}", { blocker: t(blocker) })
          : item.message
            ? long + " · " + placementMessage(item.message, t)
            : long
      }
    >
      {t(placementStatusShort[status] || status)}
      {blocker && (
        <span
          class="notification-dot"
          aria-label={t("Last check: {blocker}", { blocker: t(blocker) })}
        />
      )}
    </span>
  );
}
export function PlacementSummaryDialog({
  scan,
  counts,
  close,
  filter,
  select,
  busy,
  rootFilter,
  openSettings,
}: {
  rootFilter: (share: string, status: string) => void;
  openSettings: () => void;
  scan: PlacementScan;
  counts?: Record<string, number>;
  close: () => void;
  filter: (target: string) => void;
  select: (target: string) => void;
  busy: boolean;
}) {
  useI18n();
  return (
    <Modal
      wide
      title={t("Scan report")}
      close={close}
      className="placement-summary"
    >
      <dl class="key-values">
        {[
          ["Items checked", count(scan.checked)],
          [
            "Several disks",
            count(counts?.several ?? scan.counts?.several ?? scan.several),
          ],
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
      {scan.shares ? (
        <PlacementSharesReport
          scan={scan}
          rootFilter={rootFilter}
          openSettings={openSettings}
        />
      ) : (
        <>
          <h3 class="card-title">{t("Folders")}</h3>
          {(scan.roots || [])
            .filter((root) => root.pathWarning)
            .map((root) => (
              <p class="notice" key={root.arrPath}>
                {placementMessage(root.pathWarning!, t)}
              </p>
            ))}
          <div class="table-wrap">
            <table class="detail-table stack-mobile">
              <thead>
                <tr>
                  {[
                    "Root folder",
                    "Instances",
                    "Share path",
                    "From Arr",
                    "Scanned",
                    "One disk",
                    "Several disks",
                    "Not found",
                    "Outside",
                    "Errors",
                  ].map((label, i) => (
                    <th scope="col" class={i > 2 ? "number" : undefined}>
                      {t(label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(scan.roots || []).map((root) => (
                  <tr key={root.arrPath}>
                    <td data-label={t("Root folder")}>{root.arrPath}</td>
                    <td data-label={t("Instances")}>
                      {root.instances.join(", ")}
                    </td>
                    <td data-label={t("Share path")}>
                      {root.diskRel || root.share || "—"}
                    </td>
                    {(
                      [
                        ["From Arr", root.items || 0, ""],
                        ["Scanned", root.scanned || 0, ""],
                        ["One disk", root.one_disk || 0, "ok"],
                        [
                          "Several disks",
                          (root.several_disks || 0) +
                            (root.seasons_spread || 0),
                          "several",
                        ],
                        ["Not found", root.not_found || 0, "not_found"],
                        ["Outside", root.outside_share || 0, "outside_share"],
                        ["Errors", root.errors || 0, "errors"],
                      ] as const
                    ).map(([label, n, status]) => (
                      <td class="number" data-label={t(label)}>
                        <button
                          class="text-button"
                          onClick={() => rootFilter(root.share, status)}
                        >
                          {count(n)}
                        </button>
                        {label === "From Arr" && <RootScanNotice root={root} />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <h3 class="card-title">{t("By target disk")}</h3>
      <div class="table-wrap">
        <table class="detail-table placement-summary-table">
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
                <th
                  scope="col"
                  class={
                    [
                      "Items",
                      "Small files",
                      "Media files",
                      "Move size",
                    ].includes(label)
                      ? "number"
                      : undefined
                  }
                >
                  {t(label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(scan.targets || []).map((group) => (
              <tr key={group.target}>
                <td>
                  <button
                    class="text-button"
                    onClick={() => filter(group.target)}
                  >
                    <DiskTag
                      item={{
                        target: group.target,
                        disks: {
                          [group.target]: {
                            bytes: group.moveBytes,
                            files: 0,
                            dirs: 0,
                          },
                        },
                      }}
                      disk={group.target}
                      focusable={false}
                    />
                  </button>
                </td>
                <td class="number">{count(group.items)}</td>
                <td class="number">{count(group.smallFiles)}</td>
                <td class="number">{count(group.mediaFiles)}</td>
                <td class="number">{bytes(group.moveBytes)}</td>
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
      <div class="modal-actions">
        <a class="button" href="/api/placement/export.csv" download>
          <Download size={ICON.label} />
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
  diskRoot,
  close,
  start,
  terminal,
  disabled,
}: {
  item: PlacementItem;
  disks: UnraidDisk[];
  diskRoot: string;
  start: () => void;
  terminal: () => void;
  disabled: boolean;
  close: () => void;
}) {
  useI18n();
  const names = Object.keys(item.disks || {});
  const [disk, setDisk] = useState(names[0] || ""),
    [page, setPage] = useState(1),
    [sort, setSort] = useState<TableSort>(null);
  const files = (item.files || [])
      .filter((f) => f.disk === disk && !f.dir)
      .sort((a, b) => {
        const field = sort?.field || "path",
          x =
            field === "size"
              ? a.size
              : field === "placement"
                ? a.disk === item.target
                  ? "stays"
                  : "moves"
                : a.rel,
          y =
            field === "size"
              ? b.size
              : field === "placement"
                ? b.disk === item.target
                  ? "stays"
                  : "moves"
                : b.rel;
        const cmp =
          typeof x === "number" && typeof y === "number"
            ? x - y
            : String(x).localeCompare(String(y));
        return (
          (sort?.direction === "desc" ? -cmp : cmp) ||
          a.rel.localeCompare(b.rel)
        );
      }),
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
      {item.scanStatus === "not_found" && (
        <>
          <p class="notice">{placementMessage(item.message, t)}</p>
          <h3 class="card-title">{t("Checked paths")}</h3>
          <ul>
            {disks.map((d) => (
              <li key={d.name}>
                <code>
                  {diskRoot}/{d.name}/{item.rel}
                </code>
              </li>
            ))}
          </ul>
        </>
      )}
      {item.scanStatus === "seasons_spread" && (
        <p class="notice">{placementMessage(item.message, t)}</p>
      )}
      <div class="mux-check-list">
        {placementCompact(item) && (
          <DetailRow
            label={t("Disks")}
            value={t("Located on {disk}", { disk: names.join(", ") })}
          />
        )}
        <DetailRow
          label={t("Target")}
          value={item.target ? <DiskTag item={item} disk={item.target} /> : "—"}
        />
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
      {!placementCompact(item) && (
        <>
          <SegmentedTabs
            id="placement-disks"
            label={t("Disks")}
            value={disk}
            items={names.map((name) => ({
              value: name,
              label: name + " · " + bytes(item.disks[name].bytes),
            }))}
            change={(value) => {
              setDisk(value);
              setPage(1);
            }}
          />
          <div
            id={"placement-disks-panel-" + disk}
            role="tabpanel"
            aria-labelledby={"placement-disks-tab-" + disk}
          >
            <div class="table-wrap">
              <table class="detail-table stack-mobile">
                <thead>
                  <tr>
                    {[
                      ["path", "Relative path"],
                      ["size", "Size"],
                      ["placement", "Placement"],
                    ].map(([field, label]) => (
                      <SortableHeader
                        label={t(label)}
                        active={(sort?.field || "path") === field}
                        direction={sort?.direction || "asc"}
                        onSort={() => {
                          setSort(nextTableSort(sort, field));
                          setPage(1);
                        }}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {files.slice((page - 1) * 100, page * 100).map((f) => (
                    <tr>
                      <td
                        data-label={t("Relative path")}
                        class="placement-file-path"
                      >
                        {f.rel}
                      </td>
                      <td data-label={t("Size")} class="number">
                        {bytes(f.size)}
                      </td>
                      <td
                        data-label={t("Placement")}
                        class="placement-file-move"
                      >
                        {item.target ? (
                          <>
                            {t(
                              f.disk === item.target ? "Stays on" : "Moves to",
                            )}{" "}
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
          </div>
          {!files.length && (
            <p class="quiet">
              {t(
                item.scanStatus === "ok"
                  ? "One-disk entries store disk totals only."
                  : "No files on this disk",
              )}
            </p>
          )}
          <div class="pagination">
            <span>{t("{count} files", { count: files.length })}</span>
            <div>
              <button
                class="icon-button"
                disabled={page <= 1}
                aria-label={t("Previous page")}
                onClick={() => setPage(page - 1)}
                title={t("Previous page")}
              >
                <ArrowLeft size={ICON.button} />
              </button>
              {t("Page {page} / {pages}", { page, pages })}
              <button
                class="icon-button"
                disabled={page >= pages}
                aria-label={t("Next page")}
                onClick={() => setPage(page + 1)}
                title={t("Next page")}
              >
                <ArrowRight size={ICON.button} />
              </button>
            </div>
          </div>
        </>
      )}
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
      <div class="modal-actions">
        <button class="button mobile-row-action" onClick={terminal}>
          <Terminal size={ICON.label} />
          {t("Terminal")}
        </button>
        <button class="button" onClick={close}>
          {t("Close")}
        </button>
        <button
          class="button primary mobile-row-action"
          disabled={disabled}
          onClick={start}
        >
          <Play size={ICON.label} />
          {t("Start")}
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
  openFiles,
}: {
  item: PlacementItem;
  service?: UnraidStatus;
  busy: boolean;
  recheck: () => void;
  close: () => void;
  openFiles: (path: string) => void;
}) {
  const { locale } = useI18n();
  const c = item.check,
    state = c?.state || service?.state;
  const [sort, setSort] = useState<TableSort>(null);
  const reasons: Record<string, string> = {
    unreadable: "Not readable",
    not_removable: "Not removable",
    special: "Link or special file",
    owner_changes: "Owner changes",
  };
  const files = (c?.files || []).slice(0, 50);
  if (sort)
    files.sort((a, b) => {
      const value = (f: typeof a) =>
        sort.field === "owner"
          ? `${f.uid}:${f.gid}`
          : sort.field === "permissions"
            ? String(f.mode & 0o777)
            : sort.field === "reason"
              ? t(reasons[f.reason] || f.reason)
              : sort.field === "disk"
                ? f.disk
                : f.rel;
      return (
        value(a).localeCompare(value(b), locale, { numeric: true }) *
        (sort.direction === "asc" ? 1 : -1)
      );
    });
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
        <p class="quiet" title={c?.checkedAt}>
          {c?.checkedAt
            ? t("Last checked: {time}", {
                time: new Date(c.checkedAt).toLocaleString(locale),
              })
            : t("Not checked yet")}
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
              ["readable", "Sources readable"],
              ["removable", "Sources removable"],
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
            ok={!!c && !c.ownerChanges}
            warning={!c || !!c.ownerChanges}
            label={t("Owner unchanged")}
            detail={
              !c
                ? t("Not checked")
                : c.ownerChanges
                  ? t("{count} files will be owned by 99:100 after the move", {
                      count: c.ownerChanges,
                    })
                  : undefined
            }
          />
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
        {!!c?.ownerChanges && (
          <button
            type="button"
            class="text-button"
            onClick={() => {
              close();
              openFiles(item.rel);
            }}
          >
            {t("Check in Files & permissions")}
          </button>
        )}
        {files.length > 0 && (
          <div class="table-wrap">
            <table class="detail-table stack-mobile">
              <thead>
                <tr>
                  {[
                    ["disk", "Disk"],
                    ["file", "File"],
                    ["owner", "Owner"],
                    ["permissions", "Permissions"],
                    ["reason", "Reason"],
                  ].map(([field, label]) => (
                    <SortableHeader
                      label={t(label)}
                      active={sort?.field === field}
                      direction={sort?.direction || "asc"}
                      onSort={() => setSort(nextTableSort(sort, field))}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {files.map((f, n) => (
                  <tr key={n}>
                    <td data-label={t("Disk")}>{f.disk}</td>
                    <td data-label={t("File")}>
                      <code>{f.rel}</code>
                    </td>
                    <td data-label={t("Owner")}>
                      {f.uid}:{f.gid}
                    </td>
                    <td data-label={t("Permissions")}>
                      <code>
                        {(f.mode & 0o777).toString(8).padStart(4, "0")}
                      </code>
                    </td>
                    <td data-label={t("Reason")}>
                      {t(reasons[f.reason] || f.reason)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!!c?.moreFiles && (
          <p class="quiet">{t("… and {count} more", { count: c.moreFiles })}</p>
        )}
        <p class="quiet">
          {t("Check again refreshes the plan before any move.")}
        </p>
        <div class="modal-actions">
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
        {state.running ? ` · ${percent(state.progress)}` : ""}
      </p>
      <div class="modal-actions">
        <button class="button" onClick={close}>
          {t("Close")}
        </button>
      </div>
    </Modal>
  );
}

// Share-first scans report what each share folder contains on the devices.
// Count cells are text buttons that apply list filters; rows are not actions.
function PlacementSharesReport({
  scan,
  rootFilter,
  openSettings,
}: {
  scan: PlacementScan;
  rootFilter: (share: string, status: string) => void;
  openSettings: () => void;
}) {
  const [report, setReport] = useState<PlacementReport>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    api<PlacementReport>(
      "placement/report",
      "GET",
      undefined,
      controller.signal,
      { notifyErrors: false },
    )
      .then((next) => {
        if (!controller.signal.aborted) setReport(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true);
          setReport(undefined);
        }
      });
    return () => controller.abort();
  }, [scan]);
  const liveShares = new Map(
    (report?.shares || []).map((share) => [share.shareDir, share]),
  );
  const unresolved = (scan.rootFolders || []).filter(
    (root) => root.status !== "resolved",
  );
  const roots = (share: string) =>
    (scan.rootFolders || []).filter((root) => root.shareDir === share);
  return (
    <>
      <h3 class="card-title">{t("Shares")}</h3>
      {report?.cacheWarning && <p class="notice">{t(report.cacheWarning)}</p>}
      {unresolved.map((root) => (
        <p class="notice" key={root.arrPath}>
          {t(
            root.status === "disabled"
              ? "Root folder {path} ({instances}) is not scanned."
              : "Root folder {path} ({instances}) has no share folder.",
            { path: root.arrPath, instances: root.instances.join(", ") },
          )}{" "}
          <button type="button" class="text-button" onClick={openSettings}>
            {t("Open in settings")}
          </button>
        </p>
      ))}
      {(scan.shares || [])
        .filter((share) => share.notice || share.deviceErrors.length)
        .map((share) => (
          <p class="notice" key={share.shareDir}>
            {share.notice
              ? t(
                  "No folder was found on any device under /unraid/<disk>/{share}.",
                  { share: share.shareDir },
                )
              : t("Devices could not be read for {share}: {devices}", {
                  share: share.shareDir,
                  devices: share.deviceErrors.join(", "),
                })}
          </p>
        ))}
      {error && (
        <p class="notice" role="alert">
          {t("Could not read placement report")}
        </p>
      )}
      {!report && !error && (
        <p class="muted" aria-live="polite">
          {t("Loading …")}
        </p>
      )}
      {report && (
        <div class="table-wrap">
          <table class="detail-table stack-mobile">
            <thead>
              <tr>
                {(
                  [
                    ["Share folder", "Share folder"],
                    ["Root folders", "Root folders"],
                    ["Folders", "Folders on disks"],
                    ["Several disks", "On several disks"],
                    ["One disk", "On one disk"],
                    ["Empty", "Empty folders"],
                    ["Without Arr", "Without Arr entry"],
                    ["Missing folders", "Arr entries without folder"],
                  ] as const
                ).map(([label, full], i) => (
                  <th
                    scope="col"
                    class={i > 1 ? "number" : undefined}
                    title={t(full)}
                  >
                    {t(label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(scan.shares || []).map((share) => (
                <tr key={share.shareDir}>
                  <td data-label={t("Share folder")}>
                    <strong class="cell-title">{share.shareDir}</strong>
                    <small class="cell-sub">
                      {t("Cache: {value}", {
                        value: t(
                          (
                            {
                              yes: "Yes",
                              prefer: "Prefer",
                              only: "Only",
                              no: "No",
                            } as Record<string, string>
                          )[
                            liveShares.get(share.shareDir)?.cache?.useCache ||
                              ""
                          ] || "unknown",
                        ),
                      })}
                    </small>
                    <small class="cell-sub" title={share.devices.join(", ")}>
                      {t("{count} devices checked", {
                        count: share.devices.length,
                      })}
                    </small>
                  </td>
                  <td data-label={t("Root folders")}>
                    {roots(share.shareDir).map((root) => (
                      <div key={root.arrPath} class="nowrap">
                        {root.arrPath}
                        <small class="cell-sub">
                          {root.instances.join(", ")}
                        </small>
                      </div>
                    ))}
                  </td>
                  {(
                    [
                      [
                        "Folders on disks",
                        liveShares.get(share.shareDir)?.counts.all || 0,
                        "all",
                      ],
                      [
                        "On several disks",
                        liveShares.get(share.shareDir)?.counts.several || 0,
                        "several",
                      ],
                      [
                        "On one disk",
                        liveShares.get(share.shareDir)?.counts.one_disk || 0,
                        "one_disk",
                      ],
                      [
                        "Empty folders",
                        liveShares.get(share.shareDir)?.counts.empty || 0,
                        "empty",
                      ],
                      [
                        "Without Arr entry",
                        liveShares.get(share.shareDir)?.counts.no_arr || 0,
                        "no_arr",
                      ],
                      [
                        "Arr entries without folder",
                        liveShares.get(share.shareDir)?.counts.not_found || 0,
                        "not_found",
                      ],
                    ] as const
                  ).map(([label, n, status]) => (
                    <td class="number" data-label={t(label)}>
                      <button
                        type="button"
                        class="text-button"
                        onClick={() => rootFilter(share.shareDir, status)}
                      >
                        {count(n)}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {report && report.shares.some((share) => share.counts.several > 0) && (
        <>
          <h3 class="card-title">{t("Several disks by result")}</h3>
          <div class="table-wrap">
            <table class="detail-table stack-mobile">
              <thead>
                <tr>
                  <th scope="col">{t("Share folder")}</th>
                  {[
                    ["Split", "Several disks"],
                    ["Empty copies", "Empty copies"],
                    ["Empty", "Empty folders"],
                    ["Mover", "Waiting for mover"],
                    ["Seasons spread", "Seasons spread"],
                    ["Errors", "Errors"],
                  ]
                    .filter(
                      ([label]) =>
                        label !== "Mover" ||
                        report.shares.some(
                          (share) => !!share.counts.waiting_for_mover,
                        ),
                    )
                    .map(([label, title]) => (
                      <th scope="col" class="number" title={t(title)}>
                        {t(label)}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {report.shares
                  .filter((share) => share.counts.several > 0)
                  .map((share) => (
                    <tr key={share.shareDir}>
                      <td data-label={t("Share folder")}>
                        <strong class="cell-title">{share.shareDir}</strong>
                      </td>
                      {[
                        ["Split", "several_split"],
                        ["Empty copies", "several_empty_folders"],
                        ["Empty folders", "several_empty"],
                        ["Mover", "several_waiting_for_mover"],
                        ["Seasons spread", "several_seasons_spread"],
                        ["Errors", "several_errors"],
                      ]
                        .filter(
                          ([label]) =>
                            label !== "Mover" ||
                            report.shares.some(
                              (share) => !!share.counts.waiting_for_mover,
                            ),
                        )
                        .map(([label, status]) => (
                          <td class="number" data-label={t(label)}>
                            <button
                              type="button"
                              class="text-button"
                              onClick={() => rootFilter(share.shareDir, status)}
                            >
                              {count(share.counts[status] || 0)}
                            </button>
                          </td>
                        ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
