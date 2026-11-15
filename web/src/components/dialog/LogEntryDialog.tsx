import { Copy } from "lucide-preact";
import type { ComponentChildren, JSX } from "preact";
import {
  eventMessage as formatEventMessage,
  levelLabel,
  levelTag,
  type LogEvent,
} from "../../event-log";
import { t, useI18n } from "../../i18n";
import { count, ICON } from "../../ui";
import { KeyValues } from "../settings/KeyValues";
import { StatusTag } from "../tools/StatusTag";
import { Modal, ModalFoot } from "./Modal";
import { Terminal } from "./Terminal";

const eventMessage = (e: LogEvent) => formatEventMessage(e, t);

// The entry as one line, as Copy puts it on the clipboard (1.7.0).
function eventText(e: LogEvent, source: string, service?: string) {
  return [
    new Date(e.ts).toISOString(),
    e.level.toUpperCase(),
    "[" + source + (service ? "/" + service : "") + "]",
    eventMessage(e),
    e.subject && "· " + e.subject,
    e.repeat > 1 && "×" + e.repeat,
    e.detail && "· " + e.detail,
  ]
    .filter(Boolean)
    .join(" ");
}

// Log entry (Phase 5d, Task 11, E22; moved out of EventLogViewer): a v2
// modal (md). Key values for each field with a value (the time with its
// ISO form below, the level as a StatusTag), the details as a terminal
// that stays at its top with Copy details beside their heading; the foot
// holds Copy (the whole entry as one line) and Close.
export function LogEntryDialog({
  entry,
  serviceName,
  sourceLabel,
  copy,
  close,
}: {
  entry: LogEvent;
  serviceName(id: string): string;
  sourceLabel(value: string): string;
  copy(text: string): void;
  close(): void;
}): JSX.Element {
  useI18n();
  const level = t(levelLabel[entry.level]);
  const rows: { key: string; label: string; value: ComponentChildren }[] = [
    {
      key: "time",
      label: t("Time"),
      value: (
        <>
          <div>{new Date(entry.ts).toLocaleString()}</div>
          <div class="v2-modal-hint">{new Date(entry.ts).toISOString()}</div>
        </>
      ),
    },
    {
      key: "level",
      label: t("Level"),
      value: (
        <StatusTag
          view={{
            tone: levelTag[entry.level].slice(7) as "error" | "warn" | "info",
            text: level,
            long: level,
          }}
        />
      ),
    },
    { key: "source", label: t("Source"), value: sourceLabel(entry.source) },
  ];
  if (entry.instance)
    rows.push({
      key: "service",
      label: t("Service"),
      value: serviceName(entry.instance),
    });
  if (entry.subject)
    rows.push({ key: "subject", label: t("Subject"), value: entry.subject });
  rows.push({
    key: "message",
    label: t("Message"),
    value: eventMessage(entry),
  });
  if (entry.repeat > 1)
    rows.push({
      key: "repeat",
      label: t("Repetitions"),
      value: count(entry.repeat),
    });
  return (
    <Modal
      id="logEntry"
      title={t("Log entry")}
      close={close}
      foot={
        <ModalFoot>
          <button
            type="button"
            class="v2-btn"
            onClick={() =>
              copy(
                eventText(
                  entry,
                  sourceLabel(entry.source),
                  entry.instance ? serviceName(entry.instance) : "",
                ),
              )
            }
          >
            <Copy size={ICON.label} />
            {t("Copy")}
          </button>
          <button type="button" class="v2-btn" onClick={close}>
            {t("Close")}
          </button>
        </ModalFoot>
      }
    >
      <div class="v2-modal-stack">
        <KeyValues rows={rows} />
        {entry.detail && (
          <section class="v2-modal-sec">
            <div class="v2-modal-line">
              <h3 class="v2-modal-h">{t("Details")}</h3>
              <button
                type="button"
                class="v2-icon-btn v2-icon-btn--sm"
                aria-label={t("Copy details")}
                title={t("Copy details")}
                onClick={() => copy(entry.detail)}
              >
                <Copy size={ICON.button} />
              </button>
            </div>
            <Terminal label={t("Details")} text={entry.detail} follow={false}>
              {entry.detail}
            </Terminal>
          </section>
        )}
      </div>
    </Modal>
  );
}
