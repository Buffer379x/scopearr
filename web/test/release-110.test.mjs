import test from "node:test";
import assert from "node:assert/strict";
import {
  instancesOf,
  instanceByID,
  instanceLabel,
  updateInstance,
  serviceType,
  newServiceInstance,
  sourceLibraryChoices,
  canRemoveServiceInstance,
  removeServiceInstance,
} from "../src/instances.ts";
import { entryLink } from "../src/entry-link.ts";
import { mediaEntryChoices } from "../src/media-link.ts";
import { tagTransition } from "../src/tag-policy.ts";
import { canonicalPresetQuery } from "../src/preset-query.ts";
const connection = {
  enabled: true,
  url: "https://example.test/arr",
  hasKey: true,
  interval: 60,
};
const legacy = {
  radarr: { ...connection },
  sonarr: { ...connection },
  emby: { ...connection },
  jellyfin: { ...connection, enabled: false },
};
test("canonical instances preserve identity, including an explicitly empty list", () => {
  assert.equal(instancesOf(legacy, true).length, 3);
  const instances = [
    { ...connection, id: "radarr-4k", type: "radarr", name: "4K movies" },
    { ...connection, id: "radarr-hd", type: "radarr", name: "HD movies" },
  ];
  const settings = { ...legacy, instances };
  assert.equal(instanceByID(settings, "radarr-hd").name, "HD movies");
  assert.equal(instanceByID(settings, "radarr"), undefined);
  assert.deepEqual(instancesOf({ ...legacy, instances: [] }), []);
  assert.deepEqual(instancesOf(null), []);
  assert.equal(serviceType("sonarr-anime"), "sonarr");
  assert.equal(serviceType("sonarrr-bad"), undefined);
  assert.equal(instanceLabel(instances[0]), "4K movies");
});
test("editing one named instance neither changes siblings nor mutates legacy settings", () => {
  const settings = {
    ...legacy,
    instances: [
      { ...connection, id: "radarr", type: "radarr", name: "Movies" },
      { ...connection, id: "radarr-4k", type: "radarr", name: "4K" },
    ],
  };
  const updated = updateInstance(settings, "radarr-4k", { name: "UHD" });
  assert.equal(updated.instances[1].name, "UHD");
  assert.equal(updated.instances[0].name, "Movies");
  assert.equal(settings.instances[1].name, "4K");
  assert.equal(
    updateInstance(settings, "radarr", { url: "https://new.test" }).radarr.url,
    "https://new.test",
  );
});
test("links use the exact instance even when different libraries share numeric IDs", () => {
  assert.equal(
    entryLink(connection, { service: "radarr-4k", mediaId: 20 }),
    "/api/open-entry?service=radarr-4k&mediaId=20",
  );
  assert.equal(
    entryLink(connection, {
      service: "sonarr-anime",
      mediaId: 20,
      titleSlug: "example",
    }),
    "https://example.test/arr/series/example",
  );
  const match = {
    status: "matched",
    link: { itemId: "episode-20", serverId: "server1" },
  };
  const settings = {
    ...legacy,
    instances: [
      { ...connection, id: "emby-home", type: "emby", name: "Home cinema" },
      {
        ...connection,
        id: "jellyfin-other",
        type: "jellyfin",
        name: "Other",
        enabled: false,
      },
    ],
  };
  const choices = mediaEntryChoices(settings, {
    mediaServers: { "emby-home": match, "jellyfin-other": match },
  });
  assert.equal(choices.length, 1);
  assert.equal(choices[0].label, "Home cinema");
  assert.match(choices[0].href, /index.html#!\/item\?id=episode-20/);
});
test("media tag policy checks source changes and retains per-instance preset identity", () => {
  const before = {
    ...connection,
    id: "emby-home",
    type: "emby",
    name: "Home",
    sourceIds: "radarr",
    tagSync: { codec: true },
  };
  const change = tagTransition(before.id, before, {
    ...before,
    sourceIds: "radarr-4k",
  });
  assert.equal(change.needsMode, true);
  assert.equal(change.media, true);
  assert.equal(change.name, "Home");
  assert.notEqual(
    canonicalPresetQuery("instance=radarr-4k&codec=x265"),
    canonicalPresetQuery("instance=radarr-hd&codec=x265"),
  );
});

test("new Arr instances schedule hourly while media instances follow contributing library syncs", () => {
  for (const type of ["radarr", "sonarr", "emby", "jellyfin"]) {
    const instance = newServiceInstance(type, type + "-test", "Example");
    assert.equal(
      instance.interval,
      type === "emby" || type === "jellyfin" ? 0 : 60,
    );
    assert.equal(instance.sourceIds, "");
    assert.equal(instance.enabled, true);
    assert.equal(instance.hasKey, false);
    assert.equal(Object.values(instance.tagSync || {}).some(Boolean), false);
  }
});

test("media source choices hide unused disabled libraries but retain explicit disabled selections", () => {
  const settings = {
    ...legacy,
    instances: [
      {
        ...connection,
        id: "radarr",
        type: "radarr",
        name: "Old movies",
        enabled: false,
      },
      { ...connection, id: "radarr-hd", type: "radarr", name: "Movies" },
      {
        ...connection,
        id: "sonarr",
        type: "sonarr",
        name: "Old TV",
        enabled: false,
      },
      { ...connection, id: "sonarr-tv", type: "sonarr", name: "TV" },
      { ...connection, id: "emby", type: "emby", name: "Media" },
    ],
  };
  assert.deepEqual(
    sourceLibraryChoices(settings).map((instance) => instance.id),
    ["radarr-hd", "sonarr-tv"],
  );
  assert.deepEqual(
    sourceLibraryChoices(settings, "radarr,sonarr-tv").map(
      (instance) => instance.id,
    ),
    ["radarr", "radarr-hd", "sonarr-tv"],
  );
  assert.deepEqual(
    sourceLibraryChoices(settings, "emby").map((instance) => instance.id),
    ["radarr-hd", "sonarr-tv"],
  );
});

test("service removal requires saved disabled state and leaves explicit source references for validation", () => {
  const saved = {
    ...connection,
    id: "radarr-hd",
    type: "radarr",
    name: "HD",
    enabled: false,
  };
  const media = {
    ...connection,
    id: "emby-home",
    type: "emby",
    name: "Home",
    sourceIds: "radarr-hd",
  };
  const settings = { ...legacy, instances: [saved, media] };
  assert.equal(canRemoveServiceInstance(settings, saved), true);
  assert.equal(
    canRemoveServiceInstance(settings, { ...saved, enabled: true }),
    false,
  );
  assert.equal(
    canRemoveServiceInstance(
      { ...settings, instances: [{ ...saved, enabled: true }, media] },
      saved,
    ),
    false,
  );
  assert.equal(
    canRemoveServiceInstance(
      {
        ...settings,
        instances: [{ ...saved, tagSync: { codec: true } }, media],
      },
      saved,
    ),
    false,
  );
  assert.equal(
    canRemoveServiceInstance(settings, { ...saved, tagSync: { codec: true } }),
    false,
  );
  assert.equal(
    canRemoveServiceInstance(settings, {
      ...saved,
      id: "radarr-new",
      tagSync: { codec: true },
    }),
    true,
  );
  const next = removeServiceInstance(settings, saved.id);
  assert.equal(next.instances.length, 1);
  assert.equal(next.instances[0].sourceIds, "radarr-hd");
  assert.equal(settings.instances.length, 2);
});
