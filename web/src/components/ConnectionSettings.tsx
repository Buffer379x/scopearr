import {
  readSessionPreference,
  writeSessionPreference,
} from "../browser-storage";
import type { ComponentChildren } from "preact";
import { count, date, ICON } from "../ui";
import {
  ArrowUpRight,
  Film,
  LoaderCircle,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Tv,
} from "lucide-preact";
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
  Status,
  TagGroups,
} from "../types";
import type { syncSummary } from "../frame-status";
import type { ToolStatusView } from "../tool-status";
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
import {
  serviceHead,
  serviceKind,
  serviceValues,
  toolHead,
  type StatusKey,
} from "../settings-model";
import { useManualSync } from "../hooks/useManualSync";
import { ServiceCard, ServiceSection } from "./settings/ServiceCard";
import { ServiceStatus } from "./settings/ServiceStatus";
import { libraryStatus } from "./settings/LibraryStatus";
import { ExternalTagCheck } from "./ExternalTagStatus";
import { field } from "./settings/Field";
import { check } from "./settings/Check";

// The interval choices of Synchronize and Tag check interval.
const EVERY: Record<number, string> = {
  0: "Manual only",
  5: "Every 5 minutes",
  15: "Every 15 minutes",
  30: "Every 30 minutes",
  60: "Hourly",
  360: "Every 6 hours",
  1440: "Daily",
  [-1]: "With library sync",
};
const options = (values: number[]) =>
  values.map((value) => <option value={value}>{t(EVERY[value])}</option>);

// The service tab follows the route (tab); without a valid one, the tab
// chosen last in this browser tab. Choosing writes both. The library and
// media server cards (docs/STYLEGUIDE.md, Part 1, 10.11) show their status
// first, from the frame's status and sync summary ("—" without them).
export function ConnectionSettings({
  cfg,
  setCfg,
  settings,
  demo,
  hidden,
  tab: routeTab,
  setTab: setRouteTab,
  status,
  summary,
  refresh,
  reviewTags,
}: {
  cfg: Settings;
  setCfg: Dispatch<StateUpdater<Settings>>;
  settings: Settings;
  demo: boolean;
  hidden: boolean;
  tab: string;
  setTab: (tab: string) => void;
  status?: Status;
  summary?: ReturnType<typeof syncSummary>;
  refresh?: () => Promise<void>;
  reviewTags?: (service: string) => void;
}) {
  const { locale } = useI18n();
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const { syncing, sync: manual } = useManualSync(refresh || (async () => {}));
  // The heads the open MKVToolNix, MediaInfo and Unraid cards report (the
  // tools' polled one, Unraid's single read), for their tabs' dots.
  const [heads, setHeads] = useState<Record<string, ToolStatusView>>({});
  const report = (id: string) => (head: ToolStatusView) =>
    setHeads((current) => ({ ...current, [id]: head }));
  // A library's or media server's head tag, from the sync summary.
  const headOf = (id: string) =>
    serviceHead(
      summary?.services.find((row) => row.id === id),
      t,
    );
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
        {field(
          "sync-timezone",
          t("Sync timezone"),
          (a) => (
            <input
              {...a}
              class="v2-input"
              value={cfg.syncTimezone || ""}
              placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone}
              onInput={(e) =>
                setCfg({ ...cfg, syncTimezone: e.currentTarget.value })
              }
            />
          ),
          {
            hint: t(
              "Clock schedules use this IANA timezone. Empty uses UTC; no start time keeps the existing interval schedule.",
            ),
          },
        )}
      </section>
      {/* Each tab carries its dot from the first paint, neutral until its
          state is known, so no tab grows: a library's or media server's
          from the sync summary, a tool's from its card's polled head (its
          check until then), Unraid's from its card's read. */}
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
              (
                heads[tab.id] ??
                (tab.id === "mux" || tab.id === "mediainfo"
                  ? toolHead(tools[tab.id], t)
                  : tab.id === "unraid"
                    ? undefined
                    : headOf(tab.id))
              )?.tone ?? "neutral",
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
          report={report("mux")}
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
          report={report("mediainfo")}
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
          report={report("unraid")}
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
          const saved = instanceByID(settings, service);
          const sync = status?.sync?.[service];
          const tags = status?.tagSync?.[service];
          const head = headOf(service);
          const busy = syncing[service] || sync?.running;
          const fid = "service-" + service + "-";
          const libs = instances.filter(
            (instance) => !isMediaType(instance.type) && instance.enabled,
          );
          const mark = (on: boolean) =>
            setTesting((current) => ({ ...current, [service]: on }));
          // The status values (E9), each one line; "—" until the frame's
          // status is there.
          const values: Partial<Record<StatusKey, ComponentChildren>> = status
            ? libraryStatus(
                serviceValues(
                  { ...saved, id: service, type: kind },
                  status,
                  t,
                  {
                    date,
                    count,
                  },
                ),
                head,
                media,
                tags,
                () => reviewTags?.(service),
              )
            : {};
          return (
            <ServiceCard
              key={service}
              id={service}
              icon={
                kind === "radarr" ? (
                  <Film size={ICON.button} />
                ) : kind === "sonarr" ? (
                  <Tv size={ICON.button} />
                ) : (
                  <Server size={ICON.button} />
                )
              }
              name={instanceLabel(connection)}
              sub={connection.name?.trim() ? providerLabel(kind) : undefined}
              status={head}
              actions={
                <>
                  <button
                    type="button"
                    class="v2-btn"
                    disabled={demo || testing[service]}
                    onClick={async () => {
                      mark(true);
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
                        mark(false);
                      }
                    }}
                  >
                    <span class="v2-btn-icon" aria-hidden="true">
                      {testing[service] ? (
                        <LoaderCircle class="v2-spin" size={ICON.button} />
                      ) : (
                        <ArrowUpRight size={ICON.button} />
                      )}
                    </span>
                    {t("Test connection")}
                  </button>
                  <button
                    type="button"
                    class="v2-btn"
                    disabled={!!(demo || !saved?.enabled || busy)}
                    onClick={() => void manual(service)}
                  >
                    <span class="v2-btn-icon" aria-hidden="true">
                      <RefreshCw
                        size={ICON.button}
                        class={busy ? "v2-spin" : undefined}
                      />
                    </span>
                    {t(media ? "Match now" : "Sync now")}
                  </button>
                </>
              }
              active={{
                label: t("Enable service"),
                checked: connection.enabled,
                disabled: demo,
                change: (enabled) => update(service, { enabled }),
              }}
            >
              <ServiceSection title={t("Status")}>
                <ServiceStatus kind={serviceKind(kind)} values={values} />
              </ServiceSection>
              <ServiceSection title={t("Connection")}>
                {media && (
                  <small>
                    {t(
                      "Adds existing video and audio stream metadata. No scans or media access. Matching requires a unique filename and identical file size.",
                    )}
                  </small>
                )}
                <div class="v2-form">
                  {field(fid + "name", t("Optional service name"), (a) => (
                    <input
                      {...a}
                      class="v2-input"
                      disabled={demo}
                      maxLength={80}
                      value={connection.name}
                      placeholder={providerLabel(kind)}
                      onInput={(e) =>
                        update(service, { name: e.currentTarget.value })
                      }
                    />
                  ))}
                  {field(
                    fid + "url",
                    t("Server address"),
                    (a) => (
                      <input
                        {...a}
                        class="v2-input"
                        type="url"
                        disabled={demo}
                        placeholder={
                          "http://192.168.1.10:" +
                          (kind === "radarr"
                            ? 7878
                            : kind === "sonarr"
                              ? 8989
                              : 8096)
                        }
                        value={connection.url}
                        onInput={(e) =>
                          update(service, { url: e.currentTarget.value })
                        }
                      />
                    ),
                    {
                      hint: t(
                        "URL subpaths are supported, for example /{service}.",
                        {
                          service: kind,
                        },
                      ),
                    },
                  )}
                  {field(
                    fid + "key",
                    t("API key"),
                    (a) => (
                      <input
                        {...a}
                        class="v2-input"
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
                    ),
                    {
                      hint: media
                        ? t(
                            "Create a dedicated API key in the selected media server dashboard.",
                          )
                        : t("In each service under Settings → General."),
                    },
                  )}
                  {media ? (
                    field(
                      fid + "mappings",
                      t("Optional path mappings"),
                      (a) => (
                        <textarea
                          {...a}
                          class="v2-textarea"
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
                      ),
                      {
                        hint: t(
                          "One line per media path: Arr path => media server path. If configured, the full mapped path must also match. Different folder names inside the library prevent enrichment.",
                        ),
                      },
                    )
                  ) : (
                    <div class="v2-form">
                      {field(fid + "interval", t("Synchronize"), (a) => (
                        <select
                          {...a}
                          class="v2-select"
                          disabled={demo}
                          value={connection.interval}
                          onChange={(e) =>
                            update(service, {
                              interval: Number(e.currentTarget.value),
                            })
                          }
                        >
                          {options([0, 15, 30, 60, 360, 1440])}
                        </select>
                      ))}
                      {field(fid + "start", t("Starting at"), (a) => (
                        <input
                          {...a}
                          class="v2-input"
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
                      ))}
                    </div>
                  )}
                </div>
                {check(
                  t("Delete saved API key on save"),
                  !!connection.clearKey,
                  async (checked, input) => {
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
                  },
                  demo,
                )}
                {media && (
                  <small>
                    {t(
                      "Synced with Radarr and Sonarr. An error preserves the last complete cache.",
                    )}
                  </small>
                )}
              </ServiceSection>
              {!media && (
                <ServiceSection title={t("External tags")}>
                  {check(
                    t("Import external tags as custom tags"),
                    !!connection.tagImport,
                    (checked) =>
                      update(service, {
                        tagImport: checked,
                        ...(checked && !connection.tagImport
                          ? { tagImportInterval: 5 }
                          : {}),
                      }),
                  )}
                  <div class="v2-form">
                    {field(fid + "tag-check", t("Tag check interval"), (a) => (
                      <select
                        {...a}
                        class="v2-select"
                        value={connection.tagImportInterval ?? 5}
                        disabled={!connection.tagImport}
                        onChange={(e) =>
                          update(service, {
                            tagImportInterval: Number(e.currentTarget.value),
                          })
                        }
                      >
                        {options([0, 5, 15, 30, -1])}
                      </select>
                    ))}
                  </div>
                  <small>
                    {t(
                      "Local edits are checked immediately. Enable outbound Custom tags below to send them back. Auto-tag rule references protect edits; no file or media server requests are needed for tag checks.",
                    )}
                  </small>
                  <ExternalTagCheck
                    service={service}
                    status={status}
                    disabled={demo || !saved?.enabled || !saved?.tagImport}
                  />
                </ServiceSection>
              )}
              {media && (
                <ServiceSection title={t("Contributing libraries")}>
                  {check(
                    t("All enabled libraries"),
                    !connection.sourceIds,
                    (checked) =>
                      update(service, {
                        sourceIds: checked
                          ? ""
                          : libs.map((instance) => instance.id).join(","),
                      }),
                    demo || !libs.length,
                  )}
                  <div class="v2-form">
                    {sourceLibraryChoices(cfg, connection.sourceIds).map(
                      (instance) =>
                        check(
                          instanceLabel(instance) +
                            (!instance.enabled ? " · " + t("Disabled") : ""),
                          !connection.sourceIds ||
                            connection.sourceIds
                              .split(",")
                              .includes(instance.id),
                          (checked) => {
                            const ids = new Set(
                              (connection.sourceIds || "")
                                .split(",")
                                .filter(Boolean),
                            );
                            if (checked) ids.add(instance.id);
                            else ids.delete(instance.id);
                            update(service, { sourceIds: [...ids].join(",") });
                          },
                          demo ||
                            !connection.sourceIds ||
                            (connection.sourceIds.split(",").length === 1 &&
                              connection.sourceIds === instance.id),
                          instance.id,
                        ),
                    )}
                  </div>
                  <small>
                    {t(
                      "Choose which libraries contribute matching files and tags to this media server.",
                    )}
                  </small>
                </ServiceSection>
              )}
              <ServiceSection
                title={t("Tag synchronization to {service}", {
                  service: instanceLabel(connection),
                })}
              >
                <small>
                  {t(
                    "Disabled by default. When saving changes, choose whether existing tags should be kept or overwritten, and whether disabled groups should be kept or deleted.",
                  )}
                </small>
                <div class="v2-form">
                  {(
                    [
                      "resolution",
                      "codec",
                      "source",
                      "hdr",
                      "bitDepth",
                      "audio",
                      "channels",
                      "language",
                      "custom",
                    ] as const
                  ).map((group) =>
                    check(
                      labels[group],
                      !!connection.tagSync?.[group],
                      (checked) =>
                        update(service, {
                          tagSync: {
                            ...connection.tagSync,
                            [group]: checked,
                          } as TagGroups,
                        }),
                      demo,
                      group,
                    ),
                  )}
                </div>
                <small>
                  {t(
                    media
                      ? "Tags are sent only to matched movies and individual episodes. Multiple source versions contribute their values to the same media server item. Existing metadata is preserved; media server tags are not imported."
                      : "Source includes processing tags such as Remux. Series collect the values of all episode files. Labels use lowercase letters, digits and hyphens.",
                  )}
                </small>
              </ServiceSection>
              {!media && (
                <WebhookSettings
                  service={service}
                  config={connection}
                  changed={(patch) => update(service, patch)}
                  savedEnabled={!!saved?.webhookEnabled}
                  demo={demo}
                />
              )}
            </ServiceCard>
          );
        },
      )}
    </div>
  );
}
