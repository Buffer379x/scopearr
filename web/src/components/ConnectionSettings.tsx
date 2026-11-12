import {
  readSessionPreference,
  writeSessionPreference,
} from "../browser-storage";
import { ICON } from "../ui";
import { ArrowUpRight, Film, Tv, Plus, Server, Trash2 } from "lucide-preact";
import {
  useEffect,
  useState,
  type Dispatch,
  type StateUpdater,
} from "preact/hooks";
import { api } from "../api";
import { confirmDeletion, confirmDiscard } from "../confirmation";
import { t, useI18n } from "../i18n";
import { notify } from "../notifications";
import type {
  Connection,
  MuxToolStatus,
  Settings,
  ServiceType,
} from "../types";
import { labels } from "../ui";
import { WebhookSettings } from "./WebhookSettings";
import {
  instancesOf,
  sortedServiceTabs,
  instanceByID,
  instanceLabel,
  isMediaType,
  providerLabel,
  updateInstance,
  newServiceInstance,
  sourceLibraryChoices,
  canRemoveServiceInstance,
  removeServiceInstance,
} from "../instances";
import { UnraidSettings } from "./UnraidSettings";
import { MediaInfoSettings } from "./MediaInfoSettings";
import { MuxToolSettings } from "./MuxToolSettings";
import { defaultMuxSettings } from "../mux-spec";
import { Modal } from "./Modal";
import { Segmented } from "./list/Segmented";
import { toolHead } from "../settings-model";

// The service tab follows the route (tab); without a valid one, the tab
// chosen last in this browser tab. Choosing writes both.
export function ConnectionSettings({
  cfg,
  setCfg,
  settings,
  demo,
  hidden,
  tab: routeTab,
  setTab: setRouteTab,
}: {
  cfg: Settings;
  setCfg: Dispatch<StateUpdater<Settings>>;
  settings: Settings;
  demo: boolean;
  hidden: boolean;
  tab: string;
  setTab: (tab: string) => void;
}) {
  const { locale } = useI18n();
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  // The tool checks of MKVToolNix and MediaInfo: whether each has a tab
  // and its tab's dot. Answered checks: tabs may still appear until both.
  const [tools, setTools] = useState<
    Partial<Record<"mux" | "mediainfo", MuxToolStatus>>
  >({});
  const [checks, setChecks] = useState(0);
  useEffect(() => {
    for (const id of ["mediainfo", "mux"] as const)
      api<MuxToolStatus>(id + "/tool")
        .then((value) => setTools((current) => ({ ...current, [id]: value })))
        .catch(() => {})
        .finally(() => setChecks((count) => count + 1));
  }, []);
  const hasMediaInfo = !!cfg.mediaInfo?.enabled || !!tools.mediainfo?.installed;
  const hasMux =
    !!cfg.mux?.enabled || !!tools.mux?.installed || !!cfg.mux?.mappings;
  const instances = instancesOf(cfg);
  const serviceTabs = sortedServiceTabs(instances, hasMux, locale);
  const tabs = serviceTabs.flatMap((tab) =>
    tab.id === "mux" ? [tab, { id: "unraid", label: t("Unraid") }] : [tab],
  );
  if (!hasMux) tabs.push({ id: "unraid", label: t("Unraid") });
  if (hasMediaInfo) tabs.push({ id: "mediainfo", label: "MediaInfo" });
  tabs.sort(
    (a, b) =>
      a.label.localeCompare(b.label, locale, {
        sensitivity: "base",
        numeric: true,
      }) || a.id.localeCompare(b.id),
  );
  const [storedTab, setStoredTab] = useState(
    () =>
      readSessionPreference("scopearr-service-settings") || tabs[0]?.id || "",
  );
  useEffect(() => {
    writeSessionPreference("scopearr-service-settings", storedTab);
  }, [storedTab]);
  const selected = tabs.some((tab) => tab.id === routeTab)
    ? routeTab
    : storedTab;
  const setSelected = (id: string) => {
    setStoredTab(id);
    setRouteTab(id);
  };
  const selectedID = tabs.some((tab) => tab.id === selected)
    ? selected
    : tabs[0]?.id || "";
  // A route tab that names no tab is replaced by the shown one once the tool
  // checks answered; the session key keeps the tab chosen last.
  useEffect(() => {
    if (routeTab && routeTab !== selectedID && checks === 2)
      setRouteTab(selectedID);
  }, [routeTab, selectedID, checks]);
  useEffect(() => {
    document
      .querySelector<HTMLButtonElement>(
        '[role="tab"][aria-controls="service-settings-panel-' +
          selectedID +
          '"]',
      )
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedID]);
  const [adding, setAdding] = useState(false);
  const [addType, setAddType] = useState<
    "radarr" | "sonarr" | "media" | "mux" | "mediainfo"
  >("radarr");
  const [addProvider, setAddProvider] = useState<"emby" | "jellyfin">("emby");
  const [addName, setAddName] = useState("");
  const active = instances.filter((instance) => instance.enabled);
  const selectedInstance = instances.find(
    (instance) => instance.id === selectedID && instance.enabled,
  );
  const update = (service: string, patch: Partial<Connection>) =>
    setCfg((current) => updateInstance(current, service, patch));
  const addInstance = () => {
    if (addType === "mediainfo") {
      setCfg((current) => ({
        ...current,
        mediaInfo: {
          ...(current.mediaInfo || { channel: "stable" }),
          enabled: true,
        },
      }));
      setSelected("mediainfo");
      setAdding(false);
      return;
    }
    if (addType === "mux") {
      setCfg((current) => ({
        ...current,
        mux: { ...(current.mux || defaultMuxSettings()), enabled: true },
      }));
      setSelected("mux");
      setAdding(false);
      return;
    }
    const type: ServiceType = addType === "media" ? addProvider : addType;
    const id =
      type +
      "-" +
      Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    const instance = newServiceInstance(
      type,
      id,
      addName.trim() ||
        providerLabel(type) +
          (instances.some((instance) => instance.type === type)
            ? " " +
              (instances.filter((instance) => instance.type === type).length +
                1)
            : ""),
    );
    setCfg((current) => ({
      ...current,
      instances: [...instancesOf(current), instance],
    }));
    setSelected(id);
    setAdding(false);
    setAddName("");
  };

  return (
    <div class="v2-set" hidden={hidden}>
      <section
        class="v2-card v2-svc-sync"
        aria-labelledby="sync-timezone-title"
      >
        <h2 id="sync-timezone-title">{t("Synchronization")}</h2>
        <div class="v2-field">
          <label for="sync-timezone">{t("Sync timezone")}</label>
          <input
            id="sync-timezone"
            class="v2-input"
            aria-describedby="sync-timezone-hint"
            value={cfg.syncTimezone || ""}
            placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone}
            onInput={(e) =>
              setCfg({ ...cfg, syncTimezone: e.currentTarget.value })
            }
          />
          <small id="sync-timezone-hint">
            {t(
              "Clock schedules use this IANA timezone. Empty uses UTC; no start time keeps the existing interval schedule.",
            )}
          </small>
        </div>
      </section>
      {/* Each tab carries its dot from the first paint, neutral until its
          state is known (the tools' from their checks), so no tab grows. */}
      <div class="v2-svc-bar">
        <Segmented
          label={t("Configured services")}
          kind="tabs"
          idPrefix="service-settings"
          value={selectedID}
          select={setSelected}
          items={tabs.map((tab) => ({
            value: tab.id,
            label: tab.label,
            dot:
              tab.id === "mux" || tab.id === "mediainfo"
                ? toolHead(tools[tab.id], t).tone
                : "neutral",
          }))}
        />
        <button
          type="button"
          class="v2-btn"
          disabled={demo}
          onClick={() => setAdding(true)}
        >
          <Plus size={ICON.button} />
          {t("Add service")}
        </button>
      </div>
      {selectedID === "mux" && (
        <MuxToolSettings
          cfg={cfg}
          demo={demo}
          change={(mux) => setCfg((current) => ({ ...current, mux }))}
        />
      )}
      {selectedID === "mediainfo" && (
        <MediaInfoSettings
          cfg={cfg}
          demo={demo}
          change={(mediaInfo) =>
            setCfg((current) => ({ ...current, mediaInfo }))
          }
          changeMux={(mux) => setCfg((current) => ({ ...current, mux }))}
        />
      )}
      {selectedID === "unraid" && (
        <UnraidSettings
          cfg={cfg}
          demo={demo}
          change={(unraid) => setCfg((current) => ({ ...current, unraid }))}
          changeFileCheck={(fileCheck) =>
            setCfg((current) => ({ ...current, fileCheck }))
          }
        />
      )}
      {!active.length &&
        !hasMux &&
        !hasMediaInfo &&
        selectedID !== "mux" &&
        selectedID !== "unraid" && (
          <p class="v2-notice">
            {t("Add a service to connect your libraries and media servers.")}
          </p>
        )}
      {adding && (
        <Modal
          title={t("Add service")}
          close={async () => {
            if (
              !addName ||
              (await confirmDiscard(t("Discard unsaved settings changes?")))
            )
              setAdding(false);
          }}
        >
          <div class="add-service-fields">
            <label>
              {t("Service type")}
              <select
                value={addType}
                onChange={(e) =>
                  setAddType(e.currentTarget.value as typeof addType)
                }
              >
                {[
                  { id: "media", label: t("Media player") },
                  { id: "mux", label: "MKVToolNix" },
                  { id: "mediainfo", label: "MediaInfo" },
                  { id: "radarr", label: "Radarr" },
                  { id: "sonarr", label: "Sonarr" },
                ]
                  .sort((a, b) =>
                    a.label.localeCompare(b.label, locale, {
                      sensitivity: "base",
                      numeric: true,
                    }),
                  )
                  .map((option) => (
                    <option
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
            </label>
            {addType === "media" && (
              <label>
                {t("Media server")}
                <select
                  value={addProvider}
                  onChange={(e) =>
                    setAddProvider(e.currentTarget.value as typeof addProvider)
                  }
                >
                  <option value="emby">Emby</option>
                  <option value="jellyfin">Jellyfin</option>
                </select>
              </label>
            )}
            <label>
              {t("Optional service name")}
              <input
                maxLength={80}
                value={addName}
                placeholder={providerLabel(
                  addType === "mux" || addType === "mediainfo"
                    ? "radarr"
                    : addType === "media"
                      ? addProvider
                      : addType,
                )}
                onInput={(e) => setAddName(e.currentTarget.value)}
              />
            </label>
            <div class="modal-actions">
              <button type="button" class="primary" onClick={addInstance}>
                <Plus size={ICON.label} />
                {t("Add service")}
              </button>
            </div>
          </div>
          {instances.some((instance) => !instance.enabled) && (
            <section class="disabled-service-list">
              <h3>{t("Disabled services")}</h3>
              {instances
                .filter((instance) => !instance.enabled)
                .sort(
                  (a, b) =>
                    instanceLabel(a).localeCompare(instanceLabel(b), locale, {
                      sensitivity: "base",
                      numeric: true,
                    }) || a.id.localeCompare(b.id),
                )
                .map((instance) => (
                  <div key={instance.id}>
                    <span>{instanceLabel(instance)}</span>
                    <div class="row-actions">
                      <button
                        type="button"
                        class="button"
                        onClick={() => {
                          update(instance.id, { enabled: true });
                          setSelected(instance.id);
                          setAdding(false);
                        }}
                      >
                        {t("Enable service")}
                      </button>
                      <button
                        type="button"
                        class="icon-button danger-button"
                        disabled={
                          demo || !canRemoveServiceInstance(settings, instance)
                        }
                        title={t(
                          canRemoveServiceInstance(settings, instance)
                            ? "Remove service"
                            : "Disable tag synchronization and the service, then save before removing it.",
                        )}
                        aria-label={t("Remove service: {name}", {
                          name: instanceLabel(instance),
                        })}
                        onClick={async () => {
                          if (
                            !(await confirmDeletion(
                              t(
                                "Remove {name}? After saving, its local connection and cached data are removed. Nothing is deleted in Radarr, Sonarr or the media server.",
                                { name: instanceLabel(instance) },
                              ),
                            ))
                          )
                            return;
                          setCfg((current) =>
                            removeServiceInstance(current, instance.id),
                          );
                        }}
                      >
                        <Trash2 size={ICON.button} />
                      </button>
                    </div>
                  </div>
                ))}
            </section>
          )}
        </Modal>
      )}
      {(selectedID !== "mux" && selectedInstance ? [selectedInstance] : []).map(
        (connection) => {
          const service = connection.id;
          const kind = connection.type;
          const media = isMediaType(kind);
          return (
            <section
              class="v2-card connection"
              role="tabpanel"
              id={"service-settings-panel-" + service}
              aria-labelledby={"service-settings-tab-" + service}
              key={service}
            >
              <header class="connection-heading card-heading">
                <h3 class="card-title">
                  {kind === "radarr" ? (
                    <Film size={ICON.button} />
                  ) : kind === "sonarr" ? (
                    <Tv size={ICON.button} />
                  ) : (
                    <Server size={ICON.button} />
                  )}{" "}
                  {instanceLabel(connection)}
                </h3>
                <div class="connection-heading-test card-actions">
                  <button
                    type="button"
                    class="button"
                    disabled={demo || testing[service]}
                    onClick={async () => {
                      setTesting((current) => ({
                        ...current,
                        [service]: true,
                      }));
                      try {
                        const r = await api<{ version: string }>(
                          "test",
                          "POST",
                          {
                            service,
                            type: kind,
                            url: connection.url,
                            apiKey: connection.apiKey || "",
                          },
                        );
                        notify(
                          t("Connected · version {version}", {
                            version: r.version,
                          }),
                        );
                      } catch {
                      } finally {
                        setTesting((current) => ({
                          ...current,
                          [service]: false,
                        }));
                      }
                    }}
                  >
                    {t("Test connection")}
                    <ArrowUpRight size={ICON.label} />
                  </button>
                </div>
              </header>
              {media && (
                <p class="quiet">
                  {t(
                    "Adds existing video and audio stream metadata. No scans or media access. Matching requires a unique filename and identical file size.",
                  )}
                </p>
              )}
              <label class="service-name-field">
                {t("Optional service name")}
                <input
                  disabled={demo}
                  maxLength={80}
                  value={connection.name}
                  placeholder={providerLabel(kind)}
                  onInput={(e) =>
                    update(service, { name: e.currentTarget.value })
                  }
                />
              </label>
              <label class="check-field">
                <input
                  type="checkbox"
                  disabled={demo}
                  checked={connection.enabled}
                  onChange={(e) =>
                    update(service, { enabled: e.currentTarget.checked })
                  }
                />{" "}
                {t("Enable service")}
              </label>
              <div class="connection-grid">
                <label>
                  {t("Server address")}
                  <input
                    type="url"
                    disabled={demo}
                    placeholder={
                      kind === "radarr"
                        ? "http://192.168.1.10:7878"
                        : kind === "sonarr"
                          ? "http://192.168.1.10:8989"
                          : "http://192.168.1.10:8096"
                    }
                    value={connection.url}
                    onInput={(e) =>
                      update(service, { url: e.currentTarget.value })
                    }
                  />
                  <small>
                    {t("URL subpaths are supported, for example /{service}.", {
                      service: kind,
                    })}
                  </small>
                </label>
                <label>
                  {t("API key")}
                  <input
                    type="password"
                    disabled={demo}
                    autoComplete="off"
                    placeholder={
                      connection.hasKey
                        ? t("Saved · leave empty to keep")
                        : t("Enter API key")
                    }
                    value={connection.apiKey || ""}
                    onInput={(e) =>
                      update(service, { apiKey: e.currentTarget.value })
                    }
                  />
                  <small>
                    {media
                      ? t(
                          "Create a dedicated API key in the selected media server dashboard.",
                        )
                      : t("In each service under Settings → General.")}
                  </small>
                </label>
                <label class="check-field">
                  <input
                    type="checkbox"
                    disabled={demo}
                    checked={!!connection.clearKey}
                    onChange={async (e) => {
                      const input = e.currentTarget,
                        checked = input.checked;
                      if (
                        checked &&
                        !(await confirmDeletion(
                          t("Delete the saved API key when saving?"),
                        ))
                      ) {
                        input.checked = false;
                        return;
                      }
                      update(service, {
                        clearKey: checked,
                        ...(checked ? { enabled: false, apiKey: "" } : {}),
                      });
                    }}
                  />
                  {t("Delete saved API key on save")}
                </label>
                {media && (
                  <label class="path-mapping-field">
                    {t("Optional path mappings")}
                    <textarea
                      aria-label={t("Media server path mappings")}
                      disabled={demo}
                      rows={3}
                      value={connection.pathMappings || ""}
                      placeholder="/movies => /media/movies"
                      onInput={(e) =>
                        update(service, {
                          pathMappings: e.currentTarget.value,
                        })
                      }
                    />
                    <small>
                      {t(
                        "One line per media path: Arr path => media server path. If configured, the full mapped path must also match. Different folder names inside the library prevent enrichment.",
                      )}
                    </small>
                  </label>
                )}
                {kind === "radarr" || kind === "sonarr" ? (
                  <div class="sync-clock-grid">
                    <label>
                      {t("Synchronize")}
                      <select
                        disabled={demo}
                        value={connection.interval}
                        onChange={(e) =>
                          update(service, {
                            interval: Number(e.currentTarget.value),
                          })
                        }
                      >
                        {[
                          [0, t("Manual only")],
                          [15, t("Every 15 minutes")],
                          [30, t("Every 30 minutes")],
                          [60, t("Hourly")],
                          [360, t("Every 6 hours")],
                          [1440, t("Daily")],
                        ].map(([value, label]) => (
                          <option value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t("Starting at")}
                      <input
                        type="text"
                        inputMode="text"
                        placeholder="HH:MM"
                        pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                        maxLength={5}
                        autoComplete="off"
                        disabled={demo || connection.interval === 0}
                        value={connection.syncStart || ""}
                        onInput={(e) => {
                          update(service, {
                            syncStart: e.currentTarget.value,
                          });
                          if (!cfg.syncTimezone)
                            setCfg((current) => ({
                              ...current,
                              syncTimezone:
                                Intl.DateTimeFormat().resolvedOptions()
                                  .timeZone,
                            }));
                        }}
                      />
                    </label>
                  </div>
                ) : (
                  <p class="quiet">
                    {t(
                      "Synced with Radarr and Sonarr. An error preserves the last complete cache.",
                    )}
                  </p>
                )}
                <div
                  class={
                    "tag-integration-settings" +
                    (media ? " media-tag-integration" : "")
                  }
                >
                  {!media && (
                    <section class="external-tag-settings">
                      <h4>{t("External tags")}</h4>
                      <label class="check-field">
                        <input
                          type="checkbox"
                          checked={!!connection.tagImport}
                          onChange={(e) =>
                            update(service, {
                              tagImport: e.currentTarget.checked,
                              ...(e.currentTarget.checked &&
                              !connection.tagImport
                                ? { tagImportInterval: 5 }
                                : {}),
                            })
                          }
                        />
                        {t("Import external tags as custom tags")}
                      </label>
                      <label>
                        {t("Tag check interval")}
                        <select
                          value={connection.tagImportInterval ?? 5}
                          disabled={!connection.tagImport}
                          onChange={(e) =>
                            update(service, {
                              tagImportInterval: Number(e.currentTarget.value),
                            })
                          }
                        >
                          {[0, 5, 15, 30, -1].map((v) => (
                            <option value={v}>
                              {t(
                                v === 0
                                  ? "Manual only"
                                  : v === -1
                                    ? "With library sync"
                                    : v === 5
                                      ? "Every 5 minutes"
                                      : v === 15
                                        ? "Every 15 minutes"
                                        : "Every 30 minutes",
                              )}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p class="quiet">
                        {t(
                          "Local edits are checked immediately. Enable outbound Custom tags below to send them back. Auto-tag rule references protect edits; no file or media server requests are needed for tag checks.",
                        )}
                      </p>
                    </section>
                  )}
                  <section class="outbound-tag-settings">
                    <h4>
                      {t("Tag synchronization to {service}", {
                        service: instanceLabel(connection),
                      })}
                    </h4>
                    <p class="quiet">
                      {t(
                        "Disabled by default. When saving changes, choose whether existing tags should be kept or overwritten, and whether disabled groups should be kept or deleted.",
                      )}
                    </p>
                    <div class="tag-group-options">
                      {[
                        "resolution",
                        "codec",
                        "source",
                        "hdr",
                        "bitDepth",
                        "audio",
                        "channels",
                        "language",
                        "custom",
                      ].map((field) => (
                        <label class="check-field">
                          <input
                            type="checkbox"
                            disabled={demo}
                            checked={
                              !!connection.tagSync?.[
                                field as keyof import("../types").TagGroups
                              ]
                            }
                            onChange={(e) =>
                              update(service, {
                                tagSync: {
                                  ...connection.tagSync,
                                  [field]: e.currentTarget.checked,
                                } as import("../types").TagGroups,
                              })
                            }
                          />
                          {labels[field]}
                        </label>
                      ))}
                    </div>
                    <small>
                      {t(
                        media
                          ? "Tags are sent only to matched movies and individual episodes. Multiple source versions contribute their values to the same media server item. Existing metadata is preserved; media server tags are not imported."
                          : "Source includes processing tags such as Remux. Series collect the values of all episode files. Labels use lowercase letters, digits and hyphens.",
                      )}
                    </small>
                  </section>
                </div>
                {media && (
                  <section class="media-source-settings">
                    <h4>{t("Contributing libraries")}</h4>
                    <label class="check-field">
                      <input
                        type="checkbox"
                        disabled={
                          demo ||
                          !instances.some(
                            (instance) =>
                              !isMediaType(instance.type) && instance.enabled,
                          )
                        }
                        checked={!connection.sourceIds}
                        onChange={(e) =>
                          update(service, {
                            sourceIds: e.currentTarget.checked
                              ? ""
                              : instances
                                  .filter(
                                    (instance) =>
                                      !isMediaType(instance.type) &&
                                      instance.enabled,
                                  )
                                  .map((instance) => instance.id)
                                  .join(",") || "",
                          })
                        }
                      />
                      {t("All enabled libraries")}
                    </label>
                    <div class="tag-group-options">
                      {sourceLibraryChoices(cfg, connection.sourceIds).map(
                        (instance) => (
                          <label class="check-field" key={instance.id}>
                            <input
                              type="checkbox"
                              disabled={
                                demo ||
                                !connection.sourceIds ||
                                (connection.sourceIds.split(",").length === 1 &&
                                  connection.sourceIds === instance.id)
                              }
                              checked={
                                !connection.sourceIds ||
                                connection.sourceIds
                                  .split(",")
                                  .includes(instance.id)
                              }
                              onChange={(e) => {
                                const ids = new Set(
                                  (connection.sourceIds || "")
                                    .split(",")
                                    .filter(Boolean),
                                );
                                if (e.currentTarget.checked)
                                  ids.add(instance.id);
                                else ids.delete(instance.id);
                                update(service, {
                                  sourceIds: [...ids].join(","),
                                });
                              }}
                            />
                            {instanceLabel(instance)}
                            {!instance.enabled ? " · " + t("Disabled") : ""}
                          </label>
                        ),
                      )}
                    </div>
                    <small>
                      {t(
                        "Choose which libraries contribute matching files and tags to this media server.",
                      )}
                    </small>
                  </section>
                )}
                {(kind === "radarr" || kind === "sonarr") && (
                  <WebhookSettings
                    service={service}
                    config={connection}
                    changed={(patch) => update(service, patch)}
                    savedEnabled={
                      !!instanceByID(settings, service)?.webhookEnabled
                    }
                    demo={demo}
                  />
                )}
              </div>
            </section>
          );
        },
      )}
    </div>
  );
}
