import type {
  Connection,
  ServiceInstance,
  ServiceType,
  Settings,
} from "./types";

export const serviceTypes: ServiceType[] = [
  "radarr",
  "sonarr",
  "emby",
  "jellyfin",
];
export function serviceType(id: string): ServiceType | undefined {
  return serviceTypes.find((type) => id === type || id.startsWith(type + "-"));
}
export function instanceLabel(
  connection: Pick<Connection, "name" | "type" | "id">,
): string {
  return (
    connection.name?.trim() ||
    providerLabel(connection.type || serviceType(connection.id || ""))
  );
}
export function providerLabel(type: ServiceType | undefined): string {
  return {
    radarr: "Radarr",
    sonarr: "Sonarr",
    emby: "Emby",
    jellyfin: "Jellyfin",
  }[type || "radarr"];
}
export function instancesOf(
  settings: Settings | null | undefined,
  enabledOnly = false,
): ServiceInstance[] {
  if (!settings) return [];
  const instances =
    settings.instances ??
    serviceTypes.map((type) => ({
      ...settings[type],
      id: type,
      type,
      name: "",
    }));
  return instances.filter((instance) => !enabledOnly || instance.enabled);
}
export function instanceByID(
  settings: Settings | null | undefined,
  id: string,
): ServiceInstance | undefined {
  return instancesOf(settings).find((instance) => instance.id === id);
}
export function isMediaType(type: string | undefined): boolean {
  return type === "emby" || type === "jellyfin";
}
export function updateInstance(
  settings: Settings,
  id: string,
  patch: Partial<Connection>,
): Settings {
  const instances = instancesOf(settings).map((instance) =>
    instance.id === id ? { ...instance, ...patch } : instance,
  );
  const legacy = serviceTypes.includes(id as ServiceType)
    ? { [id]: instances.find((instance) => instance.id === id) }
    : {};
  return { ...settings, ...legacy, instances };
}

export function newServiceInstance(
  type: ServiceType,
  id: string,
  name: string,
): ServiceInstance {
  return {
    id,
    type,
    name,
    enabled: true,
    url: "",
    apiKey: "",
    hasKey: false,
    interval: isMediaType(type) ? 0 : 60,
    sourceIds: "",
  };
}

export function sourceLibraryChoices(
  settings: Settings,
  sourceIds = "",
): ServiceInstance[] {
  const selected = new Set(sourceIds.split(",").filter(Boolean));
  return instancesOf(settings).filter(
    (instance) =>
      !isMediaType(instance.type) &&
      (instance.enabled || selected.has(instance.id)),
  );
}

export function canRemoveServiceInstance(
  settings: Settings,
  instance: ServiceInstance,
): boolean {
  if (instance.enabled) return false;
  const saved = instanceByID(settings, instance.id);
  if (!saved) return true;
  return (
    !saved.enabled &&
    !Object.values(saved.tagSync || {}).some(Boolean) &&
    !Object.values(instance.tagSync || {}).some(Boolean)
  );
}
export function removeServiceInstance(
  settings: Settings,
  id: string,
): Settings {
  const next = {
    ...settings,
    instances: instancesOf(settings).filter((instance) => instance.id !== id),
  };
  // Explicit source selections are intentionally kept. Resolve references before saving.
  if (serviceTypes.includes(id as ServiceType))
    next[id as ServiceType] = {
      enabled: false,
      url: "",
      hasKey: false,
      interval: 0,
    };
  return next;
}

export type ServiceTab = { id: string; label: string };
export function sortedServiceTabs(
  instances: ServiceInstance[],
  mux: boolean,
  locale: string,
): ServiceTab[] {
  return [
    ...instances
      .filter((c) => c.enabled)
      .map((c) => ({ id: c.id, label: instanceLabel(c) })),
    ...(mux ? [{ id: "mux", label: "MKVToolNix" }] : []),
  ].sort(
    (a, b) =>
      a.label.localeCompare(b.label, locale, {
        sensitivity: "base",
        numeric: true,
      }) || a.id.localeCompare(b.id),
  );
}
