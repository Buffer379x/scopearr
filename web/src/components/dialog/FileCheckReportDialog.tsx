import type { ComponentChildren, JSX } from "preact";
import { fileCheckKindLabels, fileCheckKinds } from "../../filecheck";
import { t, useI18n } from "../../i18n";
import { scanReportTime } from "../../scan-report";
import type { FileCheckScan, ScanRoot } from "../../types";
import { compactBytes as bytes, count } from "../../ui";
import { rootPresentation, SkippedRootsNotice } from "../RootCoverage";
import { KeyValues } from "../settings/KeyValues";
import { Modal, ModalFoot } from "./Modal";
import { TableScroll } from "./TableScroll";

// The scan report of Files & permissions (Phase 5d, Task 10; E21), moved
// out of FileCheckPage: a v2 modal (lg). The numbers are key values, the
// skipped roots a notice, the kinds a table in its own region whose kind
// links set the list's filter and close the report; a scan running behind
// it is a note on top.
export function FileCheckReportDialog({
  report,
  scanning,
  roots,
  mappings,
  changed,
  setup,
  filterKind,
  close,
  disabled,
}: {
  report: FileCheckScan;
  scanning: boolean;
  roots: ScanRoot[];
  mappings: string;
  changed: () => void | Promise<void>;
  setup: () => void;
  filterKind: (kind: string) => void;
  close: () => void;
  disabled: boolean;
}): JSX.Element {
  const { locale } = useI18n();
  const reportTime = scanReportTime(report, locale);
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
    ["checked", "Items checked", count(report.checked)],
    ["files", "Files checked", count(report.files)],
    ["findings", "Findings", count(report.findings)],
    ["items", "Affected items", count(report.items)],
    ["bytes", "Data in findings", bytes(report.bytes)],
    ["manual", "Manual fixes", count(report.fixes?.manual || 0)],
  ] as const)
    rows.push({ key, label: t(label), value });
  return (
    <Modal
      id="fileCheckReport"
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
        {scanning && (
          <p class="v2-notice">
            {t("A new scan is running. This report shows the previous scan.")}
          </p>
        )}
        <KeyValues rows={rows} />
        <SkippedRootsNotice
          roots={rootPresentation(roots, mappings)}
          saved={changed}
          setup={setup}
          disabled={disabled}
        />
        <section class="v2-modal-sec">
          <h3 class="v2-modal-h">{t("By kind")}</h3>
          <TableScroll label={t("By kind")}>
            <table class="v2-table">
              <thead>
                <tr>
                  <th scope="col">{t("Kind")}</th>
                  <th scope="col" class="v2-table-num">
                    {t("Findings")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {fileCheckKinds
                  .filter((kind) => report.kinds?.[kind])
                  .map((kind) => (
                    <tr key={kind} class="v2-row">
                      <td data-label={t("Kind")}>
                        <button
                          type="button"
                          class="v2-text-btn"
                          onClick={() => filterKind(kind)}
                        >
                          {t(fileCheckKindLabels[kind])}
                        </button>
                      </td>
                      <td class="v2-table-num" data-label={t("Findings")}>
                        {count(report.kinds[kind])}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </TableScroll>
        </section>
      </div>
    </Modal>
  );
}
