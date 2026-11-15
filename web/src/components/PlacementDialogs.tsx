import type { ComponentChildren } from "preact";
import { usePolling } from "../hooks/usePolling";
import { nextTableSort, type TableSort } from "./SortableHeader";
import { percent } from "../ui";
import { scanReportTime } from "../scan-report";
import { ICON } from "../ui";
import { placementMessage } from "../placement-messages";
import { useEffect, useRef, useState } from "preact/hooks";
import { Play, Terminal as TerminalIcon } from "lucide-preact";
import { api } from "../api";
import { t, useI18n } from "../i18n";
import {
  placementCompact,
  placementDuration,
  placementItemStatus,
  placementStatusLabels,
} from "../placement";
import { placementStatusView } from "../tool-status";
import type {
  PlacementItem,
  PlacementReport,
  PlacementScan,
  UnraidDisk,
  UnraidStatus,
} from "../types";
import { compactBytes as bytes, count } from "../ui";
import { CheckRow } from "./dialog/CheckRow";
import { Modal, ModalFoot } from "./dialog/Modal";
import { Tabs } from "./dialog/Tabs";
import { TableScroll } from "./dialog/TableScroll";
import { Terminal } from "./dialog/Terminal";
import { asFilmSort, SortHeader } from "./list/SortHeader";
import { itemRange, PageNav } from "./list/PageNav";
import { RootScanNotice } from "./RootCoverage";
import { KeyValues } from "./settings/KeyValues";
import { ProgressCell } from "./tools/ProgressCell";
import { StatusTag } from "./tools/StatusTag";
import { ToolDiskTag } from "./tools/ToolDiskTag";

// The disk tag of a scan report's target (the group's move size as its
// only statistics, as in 1.7.0).
const targetItem = (target: string, moveBytes: number) => ({
  target,
  scanStatus: "split",
  disks: { [target]: { bytes: moveBytes, files: 0, dirs: 0 } },
});

// Scan report (Phase 5d, Task 9; E20): a v2 modal (lg). The numbers are
// key values, the tables sit in their own regions, a scan running behind
// it is a note on top.
export function PlacementSummaryDialog({
  scan,
  scanning = false,
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
  scanning?: boolean;
  counts?: Record<string, number>;
  close: () => void;
  filter: (target: string) => void;
  select: (target: string) => void;
  busy: boolean;
}) {
  const { locale } = useI18n();
  const reportTime = scanReportTime(scan, locale);
  const rows: { key: string; label: string; value: ComponentChildren }[] = [];
  if (reportTime) {
    rows.push({
      key: "scanned",
      label: t("Scanned at"),
      value: <span title={reportTime.iso}>{reportTime.date}</span>,
    });
    if (reportTime.duration)
      rows.push({
        key: "duration",
        label: t("Duration"),
        value: reportTime.duration,
      });
  }
  for (const [key, label, value] of [
    ["checked", "Items checked", count(scan.checked)],
    [
      "several",
      "Several disks",
      count(counts?.several ?? scan.counts?.several ?? scan.several),
    ],
    ["small", "Small files only", count(scan.smallFiles)],
    ["size", "Move size", bytes(scan.moveBytes)],
    [
      "duration-estimate",
      "Estimated duration",
      "≈ " + placementDuration(scan.moveBytes / 100000000),
    ],
    ["unstartable", "Cannot move", count(scan.unstartable)],
  ] as const)
    rows.push({ key, label: t(label), value });
  return (
    <Modal
      id="placementReport"
      title={t("Scan report")}
      close={close}
      foot={
        <ModalFoot>
          <button type="button" class="v2-btn" onClick={close}>
            {t("Close")}
          </button>
        </ModalFoot>
      }
    >
      <div class="v2-modal-stack">
        <KeyValues rows={rows} />
        {scanning && (
          <p class="v2-notice">
            {t("A new scan is running. This report shows the previous scan.")}
          </p>
        )}
        {scan.shares ? (
          <PlacementSharesReport
            scan={scan}
            rootFilter={rootFilter}
            openSettings={openSettings}
          />
        ) : (
          <section class="v2-modal-sec">
            <h3 class="v2-modal-h">{t("Folders")}</h3>
            {(scan.roots || [])
              .filter((root) => root.pathWarning)
              .map((root) => (
                <p class="v2-notice v2-notice--warn" key={root.arrPath}>
                  {placementMessage(root.pathWarning!, t)}
                </p>
              ))}
            <TableScroll label={t("Folders")}>
              <table class="v2-table">
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
                      <th
                        scope="col"
                        class={i > 2 ? "v2-table-num" : undefined}
                        key={label}
                      >
                        {t(label)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(scan.roots || []).map((root) => (
                    <tr key={root.arrPath} class="v2-row">
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
                        <td
                          class="v2-table-num"
                          data-label={t(label)}
                          key={label}
                        >
                          <button
                            type="button"
                            class="v2-text-btn"
                            onClick={() => rootFilter(root.share, status)}
                          >
                            {count(n)}
                          </button>
                          {label === "From Arr" && (
                            <RootScanNotice root={root} />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </section>
        )}
        <section class="v2-modal-sec">
          <h3 class="v2-modal-h">{t("By target disk")}</h3>
          <TableScroll label={t("By target disk")}>
            <table class="v2-table">
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
                      key={label}
                      class={
                        [
                          "Items",
                          "Small files",
                          "Media files",
                          "Move size",
                        ].includes(label)
                          ? "v2-table-num"
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
                  <tr key={group.target} class="v2-row">
                    <td data-label={t("Target")}>
                      <button
                        type="button"
                        class="v2-text-btn"
                        onClick={() => filter(group.target)}
                      >
                        <ToolDiskTag
                          item={targetItem(group.target, group.moveBytes)}
                          disk={group.target}
                        />
                      </button>
                    </td>
                    <td class="v2-table-num" data-label={t("Items")}>
                      {count(group.items)}
                    </td>
                    <td class="v2-table-num" data-label={t("Small files")}>
                      {count(group.smallFiles)}
                    </td>
                    <td class="v2-table-num" data-label={t("Media files")}>
                      {count(group.mediaFiles)}
                    </td>
                    <td class="v2-table-num" data-label={t("Move size")}>
                      {bytes(group.moveBytes)}
                    </td>
                    <td data-label={t("Sources")}>
                      {Object.entries(group.sources)
                        .map(([name, size]) => `${name} ${bytes(size)}`)
                        .join(" · ")}
                    </td>
                    <td data-label={t("Selection")}>
                      <button
                        type="button"
                        class="v2-btn v2-btn--sm"
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
          </TableScroll>
          {!scan.targets?.length && (
            <p class="v2-modal-hint">
              {t("No moves can be started from this scan.")}
            </p>
          )}
          <p class="v2-modal-hint">
            {t(
              "Estimate assumes 100 MB/s. Actual speed depends on the disks and verification.",
            )}
          </p>
        </section>
      </div>
    </Modal>
  );
}

// Details of one entry (Phase 5d, Task 9; E20): a v2 modal (lg, fixed
// height, so paging and sorting never resize it). The path, the notices
// and the key values, then, unless the entry is compact, one tab per disk
// with its files (sortable, 100 to a page); the foot has Terminal, Close
// and Start.
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
  const rows: { key: string; label: string; value: ComponentChildren }[] = [];
  if (placementCompact(item))
    rows.push({
      key: "disks",
      label: t("Disks"),
      value: t("Located on {disk}", { disk: names.join(", ") }),
    });
  rows.push(
    {
      key: "target",
      label: t("Target"),
      value: item.target ? <ToolDiskTag item={item} disk={item.target} /> : "—",
    },
    { key: "size", label: t("Move size"), value: bytes(item.moveBytes) },
  );
  if (target && item.jobStatus && item.jobStatus !== "queued")
    rows.push({
      key: "free",
      label: t("Free space"),
      value: bytes(target.free),
    });
  if (target && (!item.jobStatus || item.jobStatus === "queued"))
    rows.push(
      {
        key: "before",
        label: t("Target free space before"),
        value: bytes(target.free),
      },
      {
        key: "after",
        label: t("Target free space after"),
        value: bytes(Math.max(0, target.free - item.moveBytes)),
      },
    );
  const sorting = asFilmSort(sort, "path");
  const onSort = (field: string) => {
    setSort(nextTableSort(sort, field));
    setPage(1);
  };
  return (
    <Modal
      id="placementDetails"
      title={
        item.season === -1
          ? item.title.replace(/ · Series folder$/, " · " + t("Series folder"))
          : item.title
      }
      close={close}
      foot={
        <ModalFoot>
          <button type="button" class="v2-btn" onClick={terminal}>
            <TerminalIcon size={ICON.label} />
            {t("Terminal")}
          </button>
          <button type="button" class="v2-btn" onClick={close}>
            {t("Close")}
          </button>
          <button
            type="button"
            class="v2-btn v2-btn--primary"
            disabled={disabled}
            onClick={start}
          >
            <Play size={ICON.label} />
            {t("Start")}
          </button>
        </ModalFoot>
      }
    >
      <div class="v2-modal-stack">
        <div class="v2-card--inset v2-path">{item.rel}</div>
        {item.scanStatus === "not_found" && (
          <section class="v2-modal-sec">
            <p class="v2-notice v2-notice--warn">
              {placementMessage(item.message, t)}
            </p>
            <h3 class="v2-modal-h">{t("Checked paths")}</h3>
            <ul class="v2-modal-list">
              {disks.map((d) => (
                <li key={d.name}>
                  <code>
                    {diskRoot}/{d.name}/{item.rel}
                  </code>
                </li>
              ))}
            </ul>
          </section>
        )}
        {item.scanStatus === "seasons_spread" && (
          <p class="v2-notice v2-notice--warn">
            {placementMessage(item.message, t)}
          </p>
        )}
        <KeyValues rows={rows} />
        {!placementCompact(item) && (
          <section class="v2-modal-sec">
            <h3 class="v2-modal-h">{t("Files by disk")}</h3>
            <Tabs
              id="placement-disks"
              label={t("Disks")}
              value={disk}
              items={names.map((name) => ({
                value: name,
                label: (
                  <>
                    {name}
                    <span class="v2-tabs-count">
                      {bytes(item.disks[name].bytes)}
                    </span>
                  </>
                ),
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
              class="v2-modal-panel"
            >
              <TableScroll label={t("Files by disk")}>
                <table class="v2-table">
                  <thead>
                    <tr>
                      <SortHeader
                        label={t("Relative path")}
                        field="path"
                        sort={sorting}
                        onSort={onSort}
                        grow
                      />
                      <SortHeader
                        label={t("Size")}
                        field="size"
                        sort={sorting}
                        onSort={onSort}
                        numeric
                      />
                      <SortHeader
                        label={t("Placement")}
                        field="placement"
                        sort={sorting}
                        onSort={onSort}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {files.slice((page - 1) * 100, page * 100).map((f) => (
                      <tr key={f.rel} class="v2-row">
                        <td data-label={t("Relative path")}>{f.rel}</td>
                        <td class="v2-table-num" data-label={t("Size")}>
                          {bytes(f.size)}
                        </td>
                        <td data-label={t("Placement")}>
                          {item.target ? (
                            <>
                              {t(
                                f.disk === item.target
                                  ? "Stays on"
                                  : "Moves to",
                              )}{" "}
                              <ToolDiskTag item={item} disk={item.target} />
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
              {!files.length && (
                <p class="v2-modal-hint">
                  {t(
                    item.scanStatus === "ok"
                      ? "One-disk entries store disk totals only."
                      : "No files on this disk",
                  )}
                </p>
              )}
              <PageNav
                page={page}
                pages={pages}
                setPage={setPage}
                summary={itemRange(page, 100, files.length)}
              />
            </div>
          </section>
        )}
        {item.warnings?.length > 0 && (
          <section class="v2-modal-sec">
            <h3 class="v2-modal-h">{t("Warnings")}</h3>
            <ul class="v2-modal-list">
              {item.warnings.map((message) => (
                <li key={message}>{placementMessage(message, t)}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  );
}

// Status of one entry (Phase 5d, Task 9; E20): a v2 modal (lg, fixed
// height). The checks stand in fixed rows (a check never made reads "Not
// checked"), then the reasons table (50 rows at most, sortable). "Check in
// Files & permissions" is the foot's first button, so Check again and
// Close keep their places.
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
  const sorting = asFilmSort(sort, "");
  const onSort = (field: string) => setSort(nextTableSort(sort, field));
  return (
    <Modal
      id="placementStatus"
      title={t("Status")}
      close={close}
      foot={
        <ModalFoot>
          {!!c?.ownerChanges && (
            <button
              type="button"
              class="v2-btn"
              onClick={() => {
                close();
                openFiles(item.rel);
              }}
            >
              {t("Check in Files & permissions")}
            </button>
          )}
          <button
            type="button"
            class="v2-btn"
            disabled={busy}
            onClick={recheck}
          >
            {t("Check again")}
          </button>
          <button type="button" class="v2-btn" onClick={close}>
            {t("Close")}
          </button>
        </ModalFoot>
      }
    >
      <div class="v2-modal-stack">
        <div class="v2-card--inset v2-path">{item.rel}</div>
        <div class="v2-modal-line">
          <StatusTag view={placementStatusView(item, t)} />
          <span class="v2-modal-hint">
            {t(
              placementStatusLabels[placementItemStatus(item)] ||
                item.scanStatus,
            )}
          </span>
        </div>
        <p class="v2-modal-hint" title={c?.checkedAt}>
          {c?.checkedAt
            ? t("Last checked: {time}", {
                time: new Date(c.checkedAt).toLocaleString(locale),
              })
            : t("Not checked yet")}
        </p>
        {item.message && (
          <p class="v2-notice">{placementMessage(item.message, t)}</p>
        )}
        <div>
          <CheckRow
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
          ).map(([key, label]) => {
            const pending =
              !c ||
              !c.reachable ||
              (!item.target && (key === "writable" || key === "freeSpace"));
            return (
              <CheckRow
                key={key}
                ok={!pending && !!c?.[key]}
                warning={pending}
                label={t(label)}
                detail={pending ? t("Not checked") : undefined}
              />
            );
          })}
          <CheckRow
            ok={!!c?.reachable && !!c.owner}
            warning={!c?.reachable || !!c.ownerChanges}
            label={t("Owner unchanged")}
            detail={
              !c?.reachable
                ? t("Not checked")
                : c.ownerChanges
                  ? t("{count} files will be owned by 99:100 after the move", {
                      count: c.ownerChanges,
                    })
                  : undefined
            }
          />
          <CheckRow
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
        {files.length > 0 && (
          <TableScroll label={t("Reason")}>
            <table class="v2-table">
              <thead>
                <tr>
                  {[
                    ["disk", "Disk"],
                    ["file", "File"],
                    ["owner", "Owner"],
                    ["permissions", "Permissions"],
                    ["reason", "Reason"],
                  ].map(([field, label]) => (
                    <SortHeader
                      key={field}
                      label={t(label)}
                      field={field}
                      sort={sorting}
                      onSort={onSort}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {files.map((f, n) => (
                  <tr key={n} class="v2-row">
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
          </TableScroll>
        )}
        {!!c?.moreFiles && (
          <p class="v2-modal-hint">
            {t("… and {count} more", { count: c.moreFiles })}
          </p>
        )}
        <p class="v2-modal-hint">
          {t("Check again refreshes the plan before any move.")}
        </p>
      </div>
    </Modal>
  );
}

// The log of a move (Phase 5d, Task 9; E20): a v2 modal (lg, fixed height)
// with the terminal, which follows new output only at its end. Its status
// line (the progress and the message) is the foot's lead. Polling as in
// 1.7.0.
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
  const offset = useRef(0);
  usePolling(
    async (signal) => {
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
        signal,
      );
      if (signal.aborted) return;
      const reset = next.offset < offset.current;
      offset.current = next.offset;
      setText((old) => ((reset ? "" : old) + next.text).slice(-(256 << 10)));
      setState(next);
      return next;
    },
    (next) =>
      next
        ? next.text.length >= 64000
          ? 0
          : next.running || next.queued
            ? 1000
            : 10000
        : 10000,
    [item.id],
  );
  return (
    <Modal
      id="placementLog"
      title={t("Disk placement log")}
      close={close}
      foot={
        <ModalFoot
          lead={
            <span class="v2-modal-status" role="status">
              {(state.running || state.queued) && (
                <ProgressCell
                  status={state.running ? "running" : "queued"}
                  value={state.progress}
                  label={t("Progress")}
                />
              )}
              {placementMessage(
                state.message ||
                  (state.running
                    ? "Moving"
                    : state.queued
                      ? "Waiting"
                      : "Finished"),
                t,
              )}
              {state.running ? ` · ${percent(state.progress)}` : ""}
            </span>
          }
        >
          <button type="button" class="v2-btn" onClick={close}>
            {t("Close")}
          </button>
        </ModalFoot>
      }
    >
      <Terminal label={t("Terminal")} text={text}>
        {text || t("No output yet.")}
      </Terminal>
    </Modal>
  );
}

// Share-first scans report what each share folder contains on the devices.
// Count cells are text buttons that apply list filters; rows are not actions.
export function PlacementSharesReport({
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
  const several = report?.shares.filter((share) => share.counts.several > 0);
  const mover = report?.shares.some(
    (share) => !!share.counts.waiting_for_mover,
  );
  return (
    <>
      <section class="v2-modal-sec">
        <h3 class="v2-modal-h">{t("Shares")}</h3>
        {report?.cacheWarning && (
          <p class="v2-notice v2-notice--warn">{t(report.cacheWarning)}</p>
        )}
        {unresolved.map((root) => (
          <p class="v2-notice v2-notice--warn" key={root.arrPath}>
            {t(
              root.status === "disabled"
                ? "Root folder {path} ({instances}) is not scanned."
                : "Root folder {path} ({instances}) has no share folder.",
              { path: root.arrPath, instances: root.instances.join(", ") },
            )}{" "}
            <button type="button" class="v2-text-btn" onClick={openSettings}>
              {t("Open in settings")}
            </button>
          </p>
        ))}
        {(scan.shares || [])
          .filter((share) => share.notice || share.deviceErrors.length)
          .map((share) => (
            <p class="v2-notice v2-notice--warn" key={share.shareDir}>
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
          <p class="v2-notice v2-notice--error" role="alert">
            {t("Could not read placement report")}
          </p>
        )}
        {!report && !error && (
          <p class="v2-modal-hint" aria-live="polite">
            {t("Loading …")}
          </p>
        )}
        {report && (
          <TableScroll label={t("Shares")}>
            <table class="v2-table">
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
                      class={i > 1 ? "v2-table-num" : undefined}
                      title={t(full)}
                      key={label}
                    >
                      {t(label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(scan.shares || []).map((share) => (
                  <tr key={share.shareDir} class="v2-row">
                    <td data-label={t("Share folder")}>
                      <span class="v2-table-name">{share.shareDir}</span>
                      <span class="v2-table-sub">
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
                      </span>
                      <span
                        class="v2-table-sub"
                        title={share.devices.join(", ")}
                      >
                        {t("{count} devices checked", {
                          count: share.devices.length,
                        })}
                      </span>
                    </td>
                    <td data-label={t("Root folders")}>
                      {roots(share.shareDir).map((root) => (
                        <div key={root.arrPath}>
                          {root.arrPath}
                          <span class="v2-table-sub">
                            {root.instances.join(", ")}
                          </span>
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
                      <td
                        class="v2-table-num"
                        data-label={t(label)}
                        key={label}
                      >
                        <button
                          type="button"
                          class="v2-text-btn"
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
          </TableScroll>
        )}
      </section>
      {report && !!several?.length && (
        <section class="v2-modal-sec">
          <h3 class="v2-modal-h">{t("Several disks by result")}</h3>
          <TableScroll label={t("Several disks by result")}>
            <table class="v2-table">
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
                    .filter(([label]) => label !== "Mover" || mover)
                    .map(([label, title]) => (
                      <th
                        scope="col"
                        class="v2-table-num"
                        title={t(title)}
                        key={label}
                      >
                        {t(label)}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {several.map((share) => (
                  <tr key={share.shareDir} class="v2-row">
                    <td data-label={t("Share folder")}>
                      <span class="v2-table-name">{share.shareDir}</span>
                    </td>
                    {[
                      ["Split", "several_split"],
                      ["Empty copies", "several_empty_folders"],
                      ["Empty folders", "several_empty"],
                      ["Mover", "several_waiting_for_mover"],
                      ["Seasons spread", "several_seasons_spread"],
                      ["Errors", "several_errors"],
                    ]
                      .filter(([label]) => label !== "Mover" || mover)
                      .map(([label, status]) => (
                        <td
                          class="v2-table-num"
                          data-label={t(label)}
                          key={label}
                        >
                          <button
                            type="button"
                            class="v2-text-btn"
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
          </TableScroll>
        </section>
      )}
    </>
  );
}
