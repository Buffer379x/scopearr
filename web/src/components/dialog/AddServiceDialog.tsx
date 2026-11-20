import { Plus, Trash2 } from "lucide-preact";
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { confirmDeletion, confirmDiscard } from "../../confirmation";
import { t, useI18n } from "../../i18n";
import {
  canRemoveServiceInstance,
  instanceLabel,
  providerLabel,
} from "../../instances";
import type { ServiceInstance, Settings } from "../../types";
import { ICON } from "../../ui";
import { field } from "../settings/Field";
import { Modal, ModalFoot } from "./Modal";

export type AddServiceType =
  "radarr" | "sonarr" | "media" | "mux" | "mediainfo";
export type MediaProvider = "emby" | "jellyfin";

// Add service (Phase 5d, Task 11, E22; moved out of ConnectionSettings): a
// v2 modal (md). The type (sorted by language; MKVToolNix and MediaInfo
// locked while they are there), the media server for Media player and the
// optional name with the type's name as its placeholder; Add service hands
// them to the caller. Below, the disabled services, each with Enable
// service and Remove (locked in the demo and while its tag sync is on,
// with the reason as its title; it asks first). Closing with a name asks
// "Discard unsaved settings changes?".
export function AddServiceDialog({
  instances,
  settings,
  demo,
  hasMux,
  hasMediaInfo,
  add,
  enable,
  remove,
  close,
}: {
  instances: ServiceInstance[];
  settings: Settings;
  demo: boolean;
  hasMux: boolean;
  hasMediaInfo: boolean;
  add(type: AddServiceType, provider: MediaProvider, name: string): void;
  enable(id: string): void;
  remove(id: string): void;
  close(): void;
}): JSX.Element {
  const { locale } = useI18n();
  const [type, setType] = useState<AddServiceType>("radarr");
  const [provider, setProvider] = useState<MediaProvider>("emby");
  const [name, setName] = useState("");
  const order = (a: string, b: string) =>
    a.localeCompare(b, locale, { sensitivity: "base", numeric: true });
  const requestClose = async () => {
    if (!name || (await confirmDiscard(t("Discard unsaved settings changes?"))))
      close();
  };
  const disabled = instances
    .filter((instance) => !instance.enabled)
    .sort(
      (a, b) =>
        order(instanceLabel(a), instanceLabel(b)) || a.id.localeCompare(b.id),
    );
  return (
    <Modal
      id="addService"
      title={t("Add service")}
      close={requestClose}
      foot={
        <ModalFoot>
          <button type="button" class="v2-btn" onClick={requestClose}>
            {t("Cancel")}
          </button>
          <button
            type="button"
            class="v2-btn v2-btn--primary"
            onClick={() => add(type, provider, name)}
          >
            <Plus size={ICON.label} />
            {t("Add service")}
          </button>
        </ModalFoot>
      }
    >
      <div class="v2-modal-stack">
        <div class="v2-modal-form">
          {field("add-service-type", t("Service type"), (a) => (
            <select
              {...a}
              class="v2-select"
              value={type}
              onChange={(e) => setType(e.currentTarget.value as AddServiceType)}
            >
              {[
                { id: "media", label: t("Media player") },
                { id: "mux", label: "MKVToolNix" },
                { id: "mediainfo", label: "MediaInfo" },
                { id: "radarr", label: "Radarr" },
                { id: "sonarr", label: "Sonarr" },
              ]
                .sort((a, b) => order(a.label, b.label))
                .map((option) => (
                  <option
                    key={option.id}
                    value={option.id}
                    disabled={
                      (option.id === "mux" && hasMux) ||
                      (option.id === "mediainfo" && hasMediaInfo)
                    }
                  >
                    {option.label}
                  </option>
                ))}
            </select>
          ))}
          {type === "media" &&
            field("add-service-provider", t("Media server"), (a) => (
              <select
                {...a}
                class="v2-select"
                value={provider}
                onChange={(e) =>
                  setProvider(e.currentTarget.value as MediaProvider)
                }
              >
                <option value="emby">Emby</option>
                <option value="jellyfin">Jellyfin</option>
              </select>
            ))}
          {field("add-service-name", t("Optional service name"), (a) => (
            <input
              {...a}
              class="v2-input"
              maxLength={80}
              value={name}
              placeholder={providerLabel(
                type === "mux" || type === "mediainfo"
                  ? "radarr"
                  : type === "media"
                    ? provider
                    : type,
              )}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          ))}
        </div>
        {!!disabled.length && (
          <section class="v2-modal-sec">
            <h3 class="v2-modal-h">{t("Disabled services")}</h3>
            <ul class="v2-modal-list">
              {disabled.map((instance) => {
                const removable = canRemoveServiceInstance(settings, instance);
                return (
                  <li key={instance.id}>
                    <span class="v2-modal-list-name">
                      {instanceLabel(instance)}
                    </span>
                    <button
                      type="button"
                      class="v2-btn v2-btn--sm"
                      onClick={() => enable(instance.id)}
                    >
                      {t("Enable service")}
                    </button>
                    <button
                      type="button"
                      class="v2-icon-btn v2-icon-btn--sm v2-icon-btn--danger"
                      disabled={demo || !removable}
                      title={t(
                        removable
                          ? "Remove service"
                          : "Disable tag synchronization and the service, then save before removing it.",
                      )}
                      aria-label={t("Remove service: {name}", {
                        name: instanceLabel(instance),
                      })}
                      onClick={async () => {
                        if (
                          await confirmDeletion(
                            t(
                              "Remove {name}? After saving, its local connection and cached data are removed. Nothing is deleted in Radarr, Sonarr or the media server.",
                              { name: instanceLabel(instance) },
                            ),
                          )
                        )
                          remove(instance.id);
                      }}
                    >
                      <Trash2 size={ICON.button} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  );
}
